import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { App, type Services } from '../src/tui/App.js';
import type { AuditResult, FixAction, FixPlan, FixResult, Vulnerability } from '../src/types.js';
import { vuln } from './helpers.js';

const strip = (s = '') => s.replace(/\x1b\[[0-9;]*m/g, '');

const before: AuditResult = {
  cwd: '/app',
  summary: { total: 3, critical: 1, high: 1, moderate: 0, low: 1, info: 0 },
  dependencies: {},
  vulnerabilities: [
    vuln({ name: 'lodash', severity: 'critical', isDirect: true, isProd: true, currentVersions: ['4.17.15'], fix: { kind: 'install', target: 'lodash', version: '4.17.21', isSemVerMajor: false } }),
    vuln({ name: 'axios', severity: 'high', isDirect: true, isProd: false, currentVersions: ['0.21.0'], fix: { kind: 'install', target: 'axios', version: '1.7.4', isSemVerMajor: true } }),
    vuln({ name: 'ms', severity: 'low', isDirect: false, isProd: true, fixAvailable: false, fix: { kind: 'none', isSemVerMajor: false } }),
  ],
};
const after: AuditResult = {
  ...before,
  summary: { total: 2, critical: 0, high: 1, moderate: 0, low: 1, info: 0 },
  vulnerabilities: before.vulnerabilities.slice(1),
};

const action: FixAction = {
  kind: 'install',
  name: 'lodash',
  version: '4.17.21',
  isSemVerMajor: false,
  saveType: 'prod',
  fixes: ['lodash'],
  description: 'npm install lodash@4.17.21',
};
const fixResult: FixResult = { dryRun: false, backupDir: '/app/.audit-sherpa/backup-1', results: [{ action, ok: true, durationMs: 1200 }], before: before.summary, after: after.summary };

function services(): Services & { scan: ReturnType<typeof vi.fn> } {
  const scan = vi.fn(async (opts: Parameters<Services['scan']>[0]) => {
    opts.onProgress?.({ phase: 'audit' });
    return scan.mock.calls.length > 1 ? after : before;
  });
  return {
    scan,
    readPackageJson: async () => ({ dependencies: { lodash: '^4.17.15' } }),
    buildFixPlan: vi.fn((targets: Vulnerability[]): FixPlan => ({
      actions: targets.some((t) => t.name === 'lodash') ? [action] : [],
      skipped: [],
    })),
    applyFixPlan: vi.fn(async (_plan, opts) => {
      opts.onEvent?.({ type: 'backup', dir: fixResult.backupDir! });
      opts.onEvent?.({ type: 'action-start', index: 1, total: 1, action });
      opts.onEvent?.({ type: 'action-success', index: 1, total: 1, action, durationMs: 1200 });
      return fixResult;
    }),
    listBackups: async () => [],
    restoreBackup: async () => '',
    npmInstall: async () => 0,
    writeFile: async () => {},
  } as Services & { scan: ReturnType<typeof vi.fn> };
}

async function waitFor(frame: () => string | undefined, text: string | RegExp) {
  for (let i = 0; i < 100; i++) {
    const f = strip(frame());
    if (typeof text === 'string' ? f.includes(text) : text.test(f)) return f;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Timed out waiting for ${text}. Last frame:\n${strip(frame())}`);
}
const press = async (stdin: { write: (s: string) => void }, ...keys: string[]) => {
  for (const k of keys) {
    stdin.write(k);
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('interactive TUI', () => {
  it('shows the table with a dedicated Major column and filters with p', async () => {
    const { lastFrame, stdin, unmount } = render(<App cwd="/app" version="0.0.0" services={services()} />);
    let f = await waitFor(lastFrame, 'lodash');
    expect(f).toMatch(/Package\s+Severity\s+Direct\s+Prod\s+Fix\s+Current\s+Fix Version\s+Via\s+Major/);
    expect(f).toMatch(/axios .*0\.21\.0\s+1\.7\.4\s+⚠ yes/);

    await press(stdin, 'p');
    f = await waitFor(lastFrame, /showing 2 of 3/);
    expect(f).not.toMatch(/axios\s+high/);
    unmount();
  });

  it('selects a package, previews the plan, applies it with live progress and rescans', async () => {
    const svc = services();
    const { lastFrame, stdin, unmount } = render(<App cwd="/app" version="0.0.0" services={svc} />);
    await waitFor(lastFrame, 'lodash');

    await press(stdin, ' ', 'f');
    await waitFor(lastFrame, 'What would you like to fix?');
    await press(stdin, '\r');
    let f = await waitFor(lastFrame, 'Fix plan');
    expect(f).toContain('npm install lodash@4.17.21');

    await press(stdin, 'y');
    f = await waitFor(lastFrame, '1 succeeded');
    expect(f).toMatch(/Vulnerabilities: 3 → 2/);
    expect(svc.applyFixPlan).toHaveBeenCalledOnce();
    expect(svc.scan).toHaveBeenCalledTimes(2);

    await press(stdin, '\r');
    f = await waitFor(lastFrame, /showing 2 of 2/);
    expect(f).not.toContain('lodash');
    unmount();
  });
});
