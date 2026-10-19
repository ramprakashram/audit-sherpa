import { describe, expect, it } from 'vitest';
import { buildFixPlan } from '../src/core/fixPlan.js';
import { loadExpressApp, normalizedExpressApp, vuln } from './helpers.js';

describe('buildFixPlan', () => {
  it('de-duplicates actions and records every vulnerability they fix', async () => {
    const { pkg } = loadExpressApp();
    const vulns = (await normalizedExpressApp()).filter((v) => ['mkdirp', 'minimist'].includes(v.name));
    const plan = buildFixPlan(vulns, pkg);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({ kind: 'install', name: 'mkdirp', version: '0.5.6', fixes: ['mkdirp', 'minimist'] });
    expect(plan.actions[0]!.currentVersions).toEqual(['0.5.1']);
  });

  it('records the installed version of the parent for a parent bump', async () => {
    const { pkg } = loadExpressApp();
    const minimist = (await normalizedExpressApp()).filter((v) => v.name === 'minimist');
    expect(buildFixPlan(minimist, pkg).actions[0]).toMatchObject({ name: 'mkdirp', currentVersions: ['0.5.1'], version: '0.5.6' });
  });

  it('keeps the dependency section and exact pinning of direct dependencies', async () => {
    const { pkg } = loadExpressApp();
    const json5 = (await normalizedExpressApp()).filter((v) => v.name === 'json5');
    expect(buildFixPlan(json5, pkg).actions[0]!.description).toBe('npm install json5@1.0.2 --save-dev --save-exact');
  });

  it('holds back semver-major fixes unless allowMajor is set', async () => {
    const { pkg } = loadExpressApp();
    const jwt = (await normalizedExpressApp()).filter((v) => v.name === 'jsonwebtoken');

    const blocked = buildFixPlan(jwt, pkg);
    expect(blocked.actions).toHaveLength(0);
    expect(blocked.skipped[0]).toMatchObject({ name: 'jsonwebtoken', requiresMajor: true });

    const allowed = buildFixPlan(jwt, pkg, { allowMajor: true });
    expect(allowed.actions[0]).toMatchObject({ name: 'jsonwebtoken', version: '9.0.3', isSemVerMajor: true });
  });

  it('also fixes the dependencies a selected package is vulnerable through', async () => {
    const { pkg } = loadExpressApp();
    const all = await normalizedExpressApp();
    const plan = buildFixPlan(
      all.filter((v) => v.name === 'express'),
      pkg,
      { all },
    );
    const overrides = plan.actions.filter((a) => a.kind === 'override').map((a) => a.name);
    expect(plan.actions[0]).toMatchObject({ kind: 'install', name: 'express' });
    expect(overrides).toEqual(['body-parser', 'path-to-regexp', 'qs', 'serve-static']);
    expect(plan.actions.find((a) => a.name === 'qs')!.fixes).toEqual(['qs', 'express', 'body-parser']);
    // cookie and send need 0.x minor bumps (semver-major)
    expect(plan.skipped.filter((s) => s.requiresMajor).map((s) => s.name).sort()).toEqual(['cookie', 'send']);
  });

  it('turns via-only vulnerabilities into fixes for their dependencies', () => {
    const child = vuln({ name: 'child' });
    const parent = vuln({ name: 'parent', isDirect: true, via: ['child'], fix: { kind: 'via', via: ['child'], isSemVerMajor: false } });
    const plan = buildFixPlan([parent], {}, { all: [parent, child] });
    expect(plan.actions).toEqual([expect.objectContaining({ kind: 'override', name: 'child', fixes: ['child', 'parent'] })]);
    expect(plan.skipped).toEqual([]);
  });

  it('uses a caret override when compatible copies are installed and skips incompatible ones', () => {
    const compatible = vuln({ name: 'x', otherVersions: ['1.5.0'] });
    expect(buildFixPlan([compatible], {}).actions[0]).toMatchObject({ overrideKey: 'x', version: '^1.0.1' });

    const incompatible = vuln({ name: 'y', otherVersions: ['3.0.0'] });
    const plan = buildFixPlan([incompatible], {});
    expect(plan.actions).toHaveLength(0);
    expect(plan.skipped[0]!.reason).toMatch(/other installed versions of y \(3\.0\.0\)/);
  });

  it('does not clobber an existing nested override', () => {
    const plan = buildFixPlan([vuln({ name: 'z' })], { overrides: { z: { '.': '1.0.0' } } });
    expect(plan.actions).toHaveLength(0);
    expect(plan.skipped[0]!.reason).toMatch(/nested override/);
  });

  it('reports packages without a fix', () => {
    const plan = buildFixPlan([vuln({ name: 'n', fixAvailable: false, fix: { kind: 'none', isSemVerMajor: false } })], {});
    expect(plan.skipped).toEqual([{ name: 'n', reason: 'No fix available' }]);
  });
});
