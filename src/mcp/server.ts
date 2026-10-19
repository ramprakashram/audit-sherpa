import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { restoreBackup } from '../core/backup.js';
import { filterVulnerabilities } from '../core/filter.js';
import { applyFixPlan } from '../core/fixer.js';
import { buildFixPlan } from '../core/fixPlan.js';
import { runNpm } from '../core/npm.js';
import { readPackageJson } from '../core/project.js';
import { scan } from '../core/scan.js';
import type { VulnFilter, Vulnerability } from '../types.js';

const pkgVersion = (() => {
  try {
    return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
})();

const filterShape = {
  cwd: z
    .string()
    .optional()
    .describe('Absolute path of the npm project (folder containing package.json). Defaults to the server working directory.'),
  prodOnly: z.boolean().optional().describe('Only production dependencies (exclude dev-only).'),
  directOnly: z.boolean().optional().describe('Only direct dependencies declared in package.json.'),
  severity: z
    .enum(['all', 'critical', 'high', 'moderate', 'low', 'info'])
    .optional()
    .describe('Minimum severity to include (default: all).'),
  severityExact: z.boolean().optional().describe('Match the severity exactly instead of "at least".'),
  packages: z.array(z.string()).optional().describe('Restrict to these vulnerable package names.'),
};

type FilterArgs = { cwd?: string; prodOnly?: boolean; directOnly?: boolean; severity?: VulnFilter['severity']; severityExact?: boolean; packages?: string[] };

function toFilter(a: FilterArgs): VulnFilter {
  return { prodOnly: a.prodOnly, directOnly: a.directOnly, severity: a.severity, severityExact: a.severityExact, packages: a.packages };
}

function compact(v: Vulnerability) {
  return {
    name: v.name,
    severity: v.severity,
    isDirect: v.isDirect,
    isProd: v.isProd,
    dependencyType: v.dependencyType,
    currentVersions: v.currentVersions,
    vulnerableRange: v.range,
    fixAvailable: v.fixAvailable,
    fix: v.fix,
    via: v.via,
    effects: v.effects,
    advisories: v.advisories.map((a) => ({ title: a.title, url: a.url, severity: a.severity, range: a.range })),
  };
}

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
const fail = (err: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }] });

export function createMcpServer(defaultCwd = process.cwd()): McpServer {
  const server = new McpServer({ name: 'audit-sherpa', version: pkgVersion });
  const cwdOf = (a: { cwd?: string }) => resolve(a.cwd ?? defaultCwd);

  server.registerTool(
    'audit_list',
    {
      title: 'List npm audit vulnerabilities',
      description:
        'Runs `npm audit --json` in the project and returns normalized vulnerabilities (direct/prod flags, current version, fix version, semver-major flag, advisories). Supports filters.',
      inputSchema: filterShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const result = await scan({ cwd: cwdOf(args) });
        const vulns = filterVulnerabilities(result.vulnerabilities, toFilter(args));
        return json({ cwd: result.cwd, summary: result.summary, shown: vulns.length, vulnerabilities: vulns.map(compact) });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'audit_fix_plan',
    {
      title: 'Preview npm audit fixes',
      description:
        'Builds the list of fix actions (npm install <pkg>@<version> for direct deps, package.json overrides for transitive deps) for the filtered vulnerabilities WITHOUT changing anything. Semver-major fixes are skipped unless allowMajor is true.',
      inputSchema: { ...filterShape, allowMajor: z.boolean().optional().describe('Include semver-major (potentially breaking) updates.') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      try {
        const cwd = cwdOf(args);
        const result = await scan({ cwd });
        const vulns = filterVulnerabilities(result.vulnerabilities, toFilter(args));
        const plan = buildFixPlan(vulns, await readPackageJson(cwd), { allowMajor: args.allowMajor, all: result.vulnerabilities });
        return json(plan);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'audit_fix',
    {
      title: 'Fix npm audit vulnerabilities',
      description:
        'Applies fixes for the filtered vulnerabilities. Backs up package.json/package-lock.json first (restore with audit_rollback); each failing action is reverted individually. Returns per-action results and before/after vulnerability counts. Semver-major updates may contain breaking changes and are only applied when allowMajor is true.',
      inputSchema: {
        ...filterShape,
        allowMajor: z.boolean().optional().describe('Include semver-major (potentially breaking) updates.'),
        dryRun: z.boolean().optional().describe('Only return what would be done.'),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    async (args, extra) => {
      try {
        const cwd = cwdOf(args);
        const result = await scan({ cwd });
        const vulns = filterVulnerabilities(result.vulnerabilities, toFilter(args));
        const plan = buildFixPlan(vulns, await readPackageJson(cwd), { allowMajor: args.allowMajor, all: result.vulnerabilities });
        const progressToken = extra._meta?.progressToken;
        const n = plan.actions.length;
        const total = n * 2 + 1;

        const fixResult = await applyFixPlan(plan, {
          cwd,
          dryRun: args.dryRun,
          before: result.summary,
          onEvent: (e) => {
            if (progressToken === undefined) return;
            // progress must strictly increase: start = 2i-1, finish = 2i, re-audit = 2n+1
            let progress: number | undefined;
            let message: string | undefined;
            if (e.type === 'action-start') [progress, message] = [e.index * 2 - 1, `[${e.index}/${e.total}] ${e.action.description}`];
            else if (e.type === 'action-success') [progress, message] = [e.index * 2, `✓ ${e.action.name}@${e.action.version}${e.note ? ` (${e.note})` : ''}`];
            else if (e.type === 'action-failure') [progress, message] = [e.index * 2, `✗ ${e.action.name}@${e.action.version}: reverted`];
            else if (e.type === 'reaudit-start') [progress, message] = [total, 'Re-running npm audit'];
            if (progress === undefined) return;
            void extra
              .sendNotification({ method: 'notifications/progress', params: { progressToken, progress, total, message } })
              .catch(() => undefined);
          },
        });
        return json({ ...fixResult, skipped: plan.skipped });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'audit_rollback',
    {
      title: 'Rollback last audit-sherpa fix',
      description: 'Restores package.json and package-lock.json from the latest audit-sherpa backup and runs `npm install`.',
      inputSchema: {
        cwd: filterShape.cwd,
        install: z.boolean().optional().describe('Run `npm install` after restoring (default true).'),
      },
      annotations: { destructiveHint: true },
    },
    async (args) => {
      try {
        const cwd = cwdOf(args);
        const dir = await restoreBackup(cwd);
        let installExitCode: number | undefined;
        if (args.install !== false) installExitCode = (await runNpm(['install'], { cwd })).exitCode;
        return json({ restoredFrom: dir, installExitCode });
      } catch (err) {
        return fail(err);
      }
    },
  );

  return server;
}

export async function startMcpServer(defaultCwd?: string): Promise<void> {
  const server = createMcpServer(defaultCwd);
  await server.connect(new StdioServerTransport());
}
