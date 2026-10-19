import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FixAction, FixEvent, FixPlan } from '../src/types.js';

const runNpm = vi.fn();
vi.mock('../src/core/npm.js', () => ({ runNpm: (...args: unknown[]) => runNpm(...args) }));

const { applyFixPlan } = await import('../src/core/fixer.js');
const { listBackups, restoreBackup } = await import('../src/core/backup.js');

const AUDIT_OK = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 }, dependencies: {} },
});

let cwd: string;
const pkgJson = { name: 'app', dependencies: { lodash: '4.17.15' } };
const lockJson = { lockfileVersion: 3, packages: { '': {}, 'node_modules/qs': { version: '6.7.0' } } };

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'audit-sherpa-'));
  await writeFile(join(cwd, 'package.json'), JSON.stringify(pkgJson, null, 4) + '\n');
  await writeFile(join(cwd, 'package-lock.json'), JSON.stringify(lockJson));
  runNpm.mockReset();
  runNpm.mockImplementation(async (args: string[]) => {
    if (args[0] === 'audit') return { exitCode: 0, stdout: AUDIT_OK, stderr: '' };
    if (args[0] === 'ls') return { exitCode: 0, stdout: '{}', stderr: '' };
    return { exitCode: 0, stdout: '', stderr: '' };
  });
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const install: FixAction = {
  kind: 'install', name: 'lodash', version: '4.18.1', isSemVerMajor: false, saveType: 'prod', saveExact: true,
  fixes: ['lodash'], description: 'npm install lodash@4.18.1 --save-exact',
};
const override: FixAction = {
  kind: 'override', name: 'qs', version: '6.16.0', isSemVerMajor: false, overrideKey: 'qs', vulnerableRange: '<=6.15.3',
  fixes: ['qs'], description: 'overrides["qs"] = "6.16.0" && npm install',
};
const plan = (...actions: FixAction[]): FixPlan => ({ actions, skipped: [] });

describe('applyFixPlan', () => {
  it('does nothing in dry-run mode', async () => {
    const result = await applyFixPlan(plan(install, override), { cwd, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(runNpm).not.toHaveBeenCalled();
    expect(await listBackups(cwd)).toEqual([]);
  });

  it('runs installs, writes overrides (preserving indentation) and re-audits', async () => {
    const events: FixEvent['type'][] = [];
    const result = await applyFixPlan(plan(install, override), { cwd, onEvent: (e) => events.push(e.type) });

    expect(runNpm.mock.calls.map((c) => (c[0] as string[]).join(' '))).toEqual([
      'install lodash@4.18.1 --save-exact',
      'install',
      'ls --all --json',
      'audit --json',
    ]);
    const written = await readFile(join(cwd, 'package.json'), 'utf8');
    expect(JSON.parse(written).overrides).toEqual({ qs: '6.16.0' });
    expect(written).toContain('\n    "overrides"');
    expect(result.results.every((r) => r.ok)).toBe(true);
    expect(result.after?.total).toBe(0);
    expect(events).toEqual([
      'backup', 'action-start', 'action-success', 'action-start', 'action-success', 'reaudit-start', 'done',
    ]);
  });

  it('reverts only the failing action and keeps going', async () => {
    runNpm.mockImplementation(async (args: string[]) => {
      if (args[0] === 'install' && args.length === 1 && !(globalThis as { reverted?: boolean }).reverted) {
        (globalThis as { reverted?: boolean }).reverted = true;
        return { exitCode: 1, stdout: '', stderr: 'npm error ERESOLVE could not resolve' };
      }
      if (args[0] === 'audit') return { exitCode: 0, stdout: AUDIT_OK, stderr: '' };
      if (args[0] === 'ls') return { exitCode: 0, stdout: '{}', stderr: '' };
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const result = await applyFixPlan(plan(override, install), { cwd });
    delete (globalThis as { reverted?: boolean }).reverted;

    expect(result.results.map((r) => r.ok)).toEqual([false, true]);
    expect(result.results[0]!.error).toMatch(/ERESOLVE/);
    expect(JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')).overrides).toBeUndefined();
  });

  it('skips overrides that earlier updates already resolved', async () => {
    await writeFile(join(cwd, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/qs': { version: '6.16.0' } } }));
    const result = await applyFixPlan(plan(override), { cwd, reaudit: false });
    expect(result.results[0]).toMatchObject({ ok: true, note: 'already resolved by earlier updates' });
    expect(runNpm).not.toHaveBeenCalledWith(['install'], expect.anything());
  });

  it('creates a backup that can be restored', async () => {
    const result = await applyFixPlan(plan(override), { cwd, reaudit: false });
    expect(JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')).overrides).toBeDefined();

    expect(await restoreBackup(cwd)).toBe(result.backupDir);
    expect(JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'))).toEqual(pkgJson);
    expect(await readFile(join(cwd, '.audit-sherpa', '.gitignore'), 'utf8')).toBe('*\n');
  });
});
