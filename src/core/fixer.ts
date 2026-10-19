import { resolve } from 'node:path';
import semver from 'semver';
import type { ActionResult, AuditSummary, FixAction, FixEvent, FixPlan, FixResult } from '../types.js';
import { runAudit } from './audit.js';
import { createBackup, restoreSnapshot, takeSnapshot } from './backup.js';
import { installArgs } from './fixPlan.js';
import { runNpm } from './npm.js';
import { nodePathToName, readLockfile, updatePackageJson } from './project.js';
import { summaryFromRaw } from './scan.js';

export interface ApplyOptions {
  cwd?: string;
  dryRun?: boolean;
  /** Create a backup of package.json + lockfile before changing anything (default true). */
  backup?: boolean;
  /** Re-run npm audit after applying fixes to report before/after counts (default true). */
  reaudit?: boolean;
  /** Summary before fixing, echoed back in the result. */
  before?: AuditSummary;
  /** Run `npm install` with lifecycle scripts disabled (`--ignore-scripts`). */
  ignoreScripts?: boolean;
  onEvent?: (event: FixEvent) => void;
}

/** Applies fix actions one by one. A failing action is reverted on its own; the rest continue. */
export async function applyFixPlan(plan: FixPlan, opts: ApplyOptions = {}): Promise<FixResult> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const emit = opts.onEvent ?? (() => {});
  const total = plan.actions.length;
  const result: FixResult = { dryRun: !!opts.dryRun, results: [], before: opts.before };

  if (opts.dryRun || total === 0) {
    result.results = plan.actions.map((action) => ({ action, ok: true, durationMs: 0 }));
    emit({ type: 'done', result });
    return result;
  }

  if (opts.backup !== false) {
    result.backupDir = await createBackup(cwd);
    emit({ type: 'backup', dir: result.backupDir });
  }

  let reverted = false;
  for (const [i, action] of plan.actions.entries()) {
    const index = i + 1;
    emit({ type: 'action-start', index, total, action });
    const started = Date.now();
    const snapshot = await takeSnapshot(cwd);
    const onLine = (line: string) => emit({ type: 'action-output', index, total, action, line });

    let outcome: ActionResult;
    try {
      const note = await runAction(cwd, action, onLine, !!opts.ignoreScripts);
      outcome = { action, ok: true, durationMs: Date.now() - started, note };
      emit({ type: 'action-success', index, total, action, durationMs: outcome.durationMs, note });
    } catch (err) {
      await restoreSnapshot(cwd, snapshot);
      reverted = true;
      outcome = { action, ok: false, error: (err as Error).message, durationMs: Date.now() - started };
      emit({ type: 'action-failure', index, total, action, error: outcome.error!, durationMs: outcome.durationMs });
    }
    result.results.push(outcome);
  }

  // bring node_modules back in line with the restored manifest/lockfile
  if (reverted) await runNpm(['install'], { cwd, ignoreScripts: opts.ignoreScripts }).catch(() => undefined);

  if (result.results.some((r) => r.ok && !r.note)) result.treeProblems = await checkTree(cwd);

  if (opts.reaudit !== false) {
    emit({ type: 'reaudit-start' });
    try {
      result.after = summaryFromRaw(await runAudit(cwd));
    } catch {
      // re-audit is informational only
    }
  }

  emit({ type: 'done', result });
  return result;
}

/** Returns problems reported by `npm ls` (invalid / missing packages), or [] when the tree is healthy. */
export async function checkTree(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await runNpm(['ls', '--all', '--json'], { cwd });
    const data = JSON.parse(stdout) as { problems?: string[] };
    return data.problems ?? [];
  } catch {
    return [];
  }
}

async function runAction(
  cwd: string,
  action: FixAction,
  onLine: (line: string) => void,
  ignoreScripts: boolean,
): Promise<string | undefined> {
  if (action.kind === 'override') {
    if (!(await isStillVulnerable(cwd, action))) return 'already resolved by earlier updates';
    await updatePackageJson(cwd, (pkg) => {
      const overrides = (pkg.overrides ??= {});
      overrides[action.overrideKey ?? action.name] = action.version;
    });
    await npmOrThrow(['install'], cwd, onLine, ignoreScripts);
  } else {
    await npmOrThrow(installArgs(action), cwd, onLine, ignoreScripts);
  }
  return undefined;
}

/** Checks the lockfile for an installed copy of the package that is still in the vulnerable range. */
export async function isStillVulnerable(cwd: string, action: FixAction): Promise<boolean> {
  const range = action.vulnerableRange;
  if (!range) return true;
  const lock = await readLockfile(cwd);
  if (!lock?.packages) return true;
  return Object.entries(lock.packages).some(
    ([path, entry]) =>
      path && nodePathToName(path) === action.name && !!entry.version && satisfiesSafe(entry.version, range),
  );
}

function satisfiesSafe(version: string, range: string): boolean {
  try {
    return semver.satisfies(version, range);
  } catch {
    return true;
  }
}

async function npmOrThrow(args: string[], cwd: string, onLine: (line: string) => void, ignoreScripts: boolean): Promise<void> {
  const res = await runNpm(args, { cwd, onLine, ignoreScripts });
  if (res.exitCode !== 0) {
    const shown = ignoreScripts ? [...args, '--ignore-scripts'] : args;
    const tail = (res.stderr || res.stdout).trim().split(/\r?\n/).slice(-8).join('\n');
    throw new Error(`npm ${shown.join(' ')} failed (exit ${res.exitCode})${tail ? `:\n${tail}` : ''}`);
  }
}
