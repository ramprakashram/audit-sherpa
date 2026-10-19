#!/usr/bin/env node
import { Command, Option } from 'commander';
import { checkbox, confirm, select } from '@inquirer/prompts';
import ora, { type Ora } from 'ora';
import pc from 'picocolors';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { listBackups, restoreBackup } from './core/backup.js';
import { filterVulnerabilities, SEVERITY_FILTERS } from './core/filter.js';
import { applyFixPlan } from './core/fixer.js';
import { buildFixPlan } from './core/fixPlan.js';
import { runNpm } from './core/npm.js';
import { severityRank } from './core/parse.js';
import { readPackageJson } from './core/project.js';
import { scan } from './core/scan.js';
import { toJsonReport, toMarkdownReport } from './report/export.js';
import { colorSeverity, fixVersionLabel, renderPlan, renderSummary, renderVulnTable } from './report/table.js';
import type { AuditResult, FixEvent, Severity, SeverityFilter, VulnFilter, Vulnerability } from './types.js';
import { startMcpServer } from './mcp/server.js';

const version = (() => {
  try {
    return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
})();

interface CommonOpts {
  cwd: string;
  prod?: boolean;
  direct?: boolean;
  severity: SeverityFilter;
  severityExact?: boolean;
  input?: string;
  registry: boolean;
}

interface ListOpts extends CommonOpts {
  details?: boolean;
  json?: string | boolean;
  md?: string | boolean;
  failOn?: Severity;
}

interface FixOpts extends CommonOpts {
  packages?: string[];
  interactive?: boolean;
  allowMajor?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  backup: boolean;
}

const isTTY = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

function addCommonOptions(cmd: Command): Command {
  return cmd
    .option('-C, --cwd <dir>', 'project directory', process.cwd())
    .option('-p, --prod', 'only production dependencies')
    .option('-d, --direct', 'only direct dependencies')
    .addOption(
      new Option('-s, --severity <level>', 'minimum severity to include').choices(SEVERITY_FILTERS).default('all'),
    )
    .option('--severity-exact', 'match --severity exactly instead of "at least"')
    .option('--input <file>', 'read an existing `npm audit --json` report instead of running npm audit')
    .option('--no-registry', 'do not query the registry to verify or resolve fix versions');
}

function toFilter(o: CommonOpts & { packages?: string[] }): VulnFilter {
  return {
    prodOnly: o.prod,
    directOnly: o.direct,
    severity: o.severity,
    severityExact: o.severityExact,
    packages: o.packages,
  };
}

async function runScan(o: CommonOpts, quiet = false): Promise<AuditResult> {
  const spinner = quiet ? undefined : ora({ text: 'Running npm audit…', stream: process.stderr }).start();
  try {
    const result = await scan({ cwd: resolve(o.cwd), inputFile: o.input, resolveVersions: o.registry });
    spinner?.stop();
    return result;
  } catch (err) {
    spinner?.fail('npm audit failed');
    throw err;
  }
}

function describeFilters(o: CommonOpts & { packages?: string[] }): string {
  const parts: string[] = [];
  if (o.prod) parts.push('production only');
  if (o.direct) parts.push('direct only');
  if (o.severity && o.severity !== 'all') parts.push(`severity ${o.severityExact ? '=' : '>='} ${o.severity}`);
  if (o.packages?.length) parts.push(`packages: ${o.packages.join(', ')}`);
  return parts.length ? pc.dim(`Filters: ${parts.join(', ')}`) : '';
}

/* ------------------------------ list ------------------------------ */

async function listCommand(o: ListOpts): Promise<void> {
  const machineOutput = o.json === true || o.md === true;
  const result = await runScan(o, machineOutput);
  const vulns = filterVulnerabilities(result.vulnerabilities, toFilter(o));

  if (o.json === true) process.stdout.write(toJsonReport(result, vulns) + '\n');
  else if (o.md === true) process.stdout.write(toMarkdownReport(result, vulns));
  else {
    console.log(renderSummary(result.summary, vulns.length));
    const f = describeFilters(o);
    if (f) console.log(f);
    if (vulns.length) console.log(renderVulnTable(vulns, { details: o.details }));
    const fixable = vulns.filter((v) => v.fixAvailable).length;
    if (fixable) console.log(pc.dim(`\n${fixable} fixable. Run \`audit-sherpa fix\` to choose what to fix.`));
  }

  if (typeof o.json === 'string') {
    await writeFile(resolve(o.json), toJsonReport(result, vulns) + '\n', 'utf8');
    console.error(pc.green(`JSON report written to ${o.json}`));
  }
  if (typeof o.md === 'string') {
    await writeFile(resolve(o.md), toMarkdownReport(result, vulns), 'utf8');
    console.error(pc.green(`Markdown report written to ${o.md}`));
  }

  if (o.failOn && vulns.some((v) => severityRank(v.severity) >= severityRank(o.failOn!))) process.exitCode = 1;
}

/* ------------------------------ fix ------------------------------ */

type Mode = 'all' | 'prod' | 'direct' | 'pick' | 'cancel';

function choiceLabel(v: Vulnerability): string {
  const tags = [v.isDirect ? 'direct' : 'transitive', v.isProd ? 'prod' : 'dev'];
  const major = v.fix.isSemVerMajor ? pc.yellow(' ⚠ major') : '';
  return `${pc.bold(v.name)} ${colorSeverity(v.severity)} ${pc.dim(`[${tags.join(', ')}]`)} ${v.currentVersions.join(', ') || '?'} → ${fixVersionLabel(v)}${major}`;
}

async function fixCommand(o: FixOpts): Promise<void> {
  const cwd = resolve(o.cwd);
  const result = await runScan(o);
  let vulns = filterVulnerabilities(result.vulnerabilities, toFilter(o));
  const interactive = isTTY() && !o.yes;

  console.log(renderSummary(result.summary, vulns.length));
  const f = describeFilters(o);
  if (f) console.log(f);
  if (vulns.length === 0) return;

  const hasSelector = Boolean(o.prod || o.direct || o.packages?.length);
  if (interactive && (o.interactive || !hasSelector)) {
    console.log(renderVulnTable(vulns));
    const fixable = vulns.filter((v) => v.fixAvailable);
    if (fixable.length === 0) {
      console.log(pc.yellow('None of these vulnerabilities has a fix available.'));
      return;
    }
    const mode = await select<Mode>({
      message: 'What would you like to fix?',
      choices: [
        { name: `All fixable (${fixable.length})`, value: 'all' },
        { name: `Production dependencies only (${fixable.filter((v) => v.isProd).length})`, value: 'prod' },
        { name: `Direct dependencies only (${fixable.filter((v) => v.isDirect).length})`, value: 'direct' },
        { name: 'Let me pick packages…', value: 'pick' },
        { name: 'Cancel', value: 'cancel' },
      ],
    });
    if (mode === 'cancel') return;
    if (mode === 'prod') vulns = fixable.filter((v) => v.isProd);
    else if (mode === 'direct') vulns = fixable.filter((v) => v.isDirect);
    else if (mode === 'all') vulns = fixable;
    else {
      const picked = await checkbox<string>({
        message: 'Select packages to fix (space to toggle, a = all, enter to confirm)',
        choices: fixable.map((v) => ({ name: choiceLabel(v), value: v.name })),
        pageSize: 15,
        required: true,
      });
      vulns = fixable.filter((v) => picked.includes(v.name));
    }
  }

  const pkg = await readPackageJson(cwd);
  let allowMajor = !!o.allowMajor;
  let plan = buildFixPlan(vulns, pkg, { allowMajor, all: result.vulnerabilities });
  const heldBack = plan.skipped.filter((s) => s.requiresMajor);

  if (heldBack.length && interactive) {
    console.log(
      pc.yellow(
        `\n⚠ ${heldBack.length} fix(es) need a semver-major update and MAY INTRODUCE BREAKING CHANGES:\n` +
          heldBack.map((s) => `   - ${s.name}: ${s.reason.replace(/; use --allow-major$/, '')}`).join('\n'),
      ),
    );
    allowMajor = await confirm({ message: 'Include these semver-major updates?', default: false });
    if (allowMajor) plan = buildFixPlan(vulns, pkg, { allowMajor, all: result.vulnerabilities });
  }
  if (allowMajor && plan.actions.some((a) => a.isSemVerMajor)) {
    console.log(pc.yellow('⚠ Semver-major updates are included. Review changelogs and run your tests afterwards.'));
  }

  if (plan.actions.length === 0) {
    console.log(pc.yellow('\nNothing to fix with the current selection.'));
    console.log(renderPlan(plan));
    return;
  }

  console.log(`\n${pc.bold('Fix plan')}${o.dryRun ? pc.dim(' (dry run)') : ''}`);
  console.log(renderPlan(plan));
  if (o.dryRun) {
    console.log(pc.dim('\nCommands:'));
    for (const a of plan.actions) console.log(pc.dim(`  ${a.description}`));
    return;
  }

  if (interactive && !(await confirm({ message: `Apply ${plan.actions.length} fix action(s)?`, default: true }))) return;

  const spinner = ora({ stream: process.stderr });
  const label = (e: { index: number; total: number }) => pc.dim(`[${e.index}/${e.total}]`);
  const onEvent = (e: FixEvent) => {
    switch (e.type) {
      case 'backup':
        console.error(pc.dim(`Backup saved to ${e.dir}`));
        break;
      case 'action-start':
        spinner.start(`${label(e)} ${e.action.description}`);
        break;
      case 'action-output':
        spinner.text = `${label(e)} ${e.action.description} ${pc.dim(`› ${truncate(e.line, 60)}`)}`;
        break;
      case 'action-success':
        spinner.succeed(
          `${label(e)} ${e.action.name}@${e.action.version} ${pc.dim(e.note ? `(${e.note})` : `(${(e.durationMs / 1000).toFixed(1)}s)`)}`,
        );
        break;
      case 'action-failure':
        spinner.fail(`${label(e)} ${e.action.name}@${e.action.version} — reverted`);
        console.error(pc.dim(indent(e.error)));
        break;
      case 'reaudit-start':
        spinner.start('Re-running npm audit…');
        break;
      case 'done':
        if (spinner.isSpinning) spinner.stop();
        break;
    }
  };

  const fixResult = await applyFixPlan(plan, { cwd, backup: o.backup, before: result.summary, onEvent });
  const ok = fixResult.results.filter((r) => r.ok).length;
  const failed = fixResult.results.length - ok;

  console.log(`\n${pc.green(`✓ ${ok} succeeded`)}${failed ? `, ${pc.red(`✗ ${failed} failed`)}` : ''}`);
  if (fixResult.after) {
    console.log(`Vulnerabilities: ${fixResult.before?.total ?? '?'} → ${pc.bold(String(fixResult.after.total))}`);
    console.log(renderSummary(fixResult.after));
  }
  if (fixResult.treeProblems?.length) {
    console.log(pc.yellow(`\n⚠ npm ls reports ${fixResult.treeProblems.length} problem(s) in the dependency tree:`));
    for (const p of fixResult.treeProblems.slice(0, 10)) console.log(pc.yellow(`   - ${p}`));
  }
  if (fixResult.backupDir) console.log(pc.dim('Undo with: audit-sherpa rollback'));
  if (failed) process.exitCode = 1;
}

/* ------------------------------ rollback ------------------------------ */

async function rollbackCommand(o: { cwd: string; install: boolean; list?: boolean }): Promise<void> {
  const cwd = resolve(o.cwd);
  if (o.list) {
    const backups = await listBackups(cwd);
    console.log(backups.length ? backups.join('\n') : 'No backups found.');
    return;
  }
  const dir = await restoreBackup(cwd);
  console.log(pc.green(`Restored package.json and lockfile from ${dir}`));
  if (o.install) {
    const spinner = ora({ text: 'Running npm install…', stream: process.stderr }).start();
    const res = await runNpm(['install'], { cwd, onLine: (l) => (spinner.text = `Running npm install… ${pc.dim(truncate(l, 60))}`) });
    if (res.exitCode === 0) spinner.succeed('node_modules synced');
    else {
      spinner.fail('npm install failed');
      process.exitCode = 1;
    }
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function indent(s: string): string {
  return s
    .split(/\r?\n/)
    .map((l) => `    ${l}`)
    .join('\n');
}

/* ------------------------------ program ------------------------------ */

const program = new Command()
  .name('audit-sherpa')
  .description('List npm audit vulnerabilities in a filterable table and fix them selectively.')
  .version(version);

addCommonOptions(
  program
    .command('list', { isDefault: true })
    .alias('ls')
    .description('show vulnerabilities as a table (default command)'),
)
  .option('--details', 'include advisory titles and links')
  .option('--json [file]', 'output JSON (to stdout, or to a file)')
  .option('--md [file]', 'output Markdown (to stdout, or to a file)')
  .addOption(new Option('--fail-on <level>', 'exit with code 1 if a vulnerability at or above this level is shown').choices(['critical', 'high', 'moderate', 'low', 'info']))
  .action(listCommand);

addCommonOptions(program.command('fix').description('fix vulnerabilities (interactive when run in a terminal)'))
  .option('--packages <names...>', 'only fix these vulnerable packages (space or comma separated)', collectPackages)
  .option('-i, --interactive', 'always show the interactive selector, even with filters')
  .option('--allow-major', 'allow semver-major updates (may introduce breaking changes)')
  .option('--dry-run', 'show the fix plan without changing anything')
  .option('-y, --yes', 'do not prompt; apply all fixes that match the filters')
  .option('--no-backup', 'do not back up package.json / package-lock.json')
  .action(fixCommand);

program
  .command('rollback')
  .description('restore package.json and package-lock.json from the latest backup')
  .option('-C, --cwd <dir>', 'project directory', process.cwd())
  .option('--no-install', 'do not run npm install after restoring')
  .option('--list', 'list available backups')
  .action(rollbackCommand);

program
  .command('mcp')
  .description('start the Model Context Protocol server over stdio (for LLM agents)')
  .option('-C, --cwd <dir>', 'default project directory', process.cwd())
  .action(async (o: { cwd: string }) => startMcpServer(resolve(o.cwd)));

function collectPackages(value: string, previous: string[] = []): string[] {
  return previous.concat(value.split(',').map((s) => s.trim()).filter(Boolean));
}

program.parseAsync(process.argv).catch((err: unknown) => {
  const e = err as Error;
  if (e?.name === 'ExitPromptError') {
    process.exitCode = 130;
    return;
  }
  console.error(pc.red(`✗ ${e?.message ?? String(err)}`));
  process.exitCode = process.exitCode || 2;
});
