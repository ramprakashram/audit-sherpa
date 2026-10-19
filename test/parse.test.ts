import { describe, expect, it } from 'vitest';
import { normalizeReport } from '../src/core/parse.js';
import { loadExpressApp, normalizedExpressApp } from './helpers.js';

describe('normalizeReport', () => {
  it('derives direct/prod flags and installed versions from package.json and the lockfile', async () => {
    const vulns = await normalizedExpressApp();
    const get = (n: string) => vulns.find((v) => v.name === n)!;

    expect(get('json5')).toMatchObject({ isDirect: true, isProd: false, dependencyType: 'dev', currentVersions: ['1.0.1'] });
    expect(get('lodash')).toMatchObject({ isDirect: true, isProd: true, dependencyType: 'prod', currentVersions: ['4.17.15'] });
    expect(get('qs')).toMatchObject({ isDirect: false, isProd: true, currentVersions: ['6.7.0'] });
  });

  it('sorts by severity, then direct first', async () => {
    const vulns = await normalizedExpressApp();
    expect(vulns.slice(0, 2).map((v) => v.name)).toEqual(['mkdirp', 'minimist']);
  });

  it('maps a transitive fix to a parent bump when npm reports one', async () => {
    const minimist = (await normalizedExpressApp()).find((v) => v.name === 'minimist')!;
    expect(minimist.fix).toEqual({ kind: 'install', target: 'mkdirp', version: '0.5.6', isSemVerMajor: false });
  });

  it('resolves a concrete safe version for fixAvailable: true (override for transitive deps)', async () => {
    const qs = (await normalizedExpressApp()).find((v) => v.name === 'qs')!;
    expect(qs.fix).toEqual({ kind: 'override', target: 'qs', version: '6.16.0', isSemVerMajor: false });
  });

  it('replaces npm suggestions that are still vulnerable according to other advisories', async () => {
    // npm suggests axios@0.21.4, which is still within the report's own advisory ranges
    const axios = (await normalizedExpressApp({ axios: ['>=0.27.2 <0.34.0'] })).find((v) => v.name === 'axios')!;
    expect(axios.fix).toMatchObject({ kind: 'install', version: '0.34.0', isSemVerMajor: true });
  });

  it('leaves the fix version unresolved when the registry is not queried', async () => {
    const { raw, pkg, lock } = loadExpressApp();
    const { vulnerabilities } = await normalizeReport(raw, { pkg, lock });
    expect(vulnerabilities.find((v) => v.name === 'qs')!.fix.version).toBeUndefined();
    expect(vulnerabilities.find((v) => v.name === 'lodash')!.fix.version).toBe('4.18.1');
  });

  it('marks packages that are only vulnerable through dependencies as kind "via"', async () => {
    const { pkg } = loadExpressApp();
    const raw = {
      auditReportVersion: 2,
      vulnerabilities: {
        parent: { name: 'parent', severity: 'high', isDirect: true, via: ['child'], effects: [], range: '1.0.0', nodes: ['node_modules/parent'], fixAvailable: true },
      },
      metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 }, dependencies: {} },
    } as const;
    const { vulnerabilities } = await normalizeReport(raw as never, { pkg });
    expect(vulnerabilities[0]!.fix).toEqual({ kind: 'via', via: ['child'], isSemVerMajor: false });
  });
});
