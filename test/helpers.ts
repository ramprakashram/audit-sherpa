import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeReport } from '../src/core/parse.js';
import { parseAuditJson } from '../src/core/audit.js';
import type { PackageJson, Lockfile } from '../src/core/project.js';
import type { Vulnerability } from '../src/types.js';

export const FIXTURES = join(import.meta.dirname, 'fixtures');

export function loadExpressApp() {
  const dir = join(FIXTURES, 'express-app');
  const read = (f: string) => readFileSync(join(dir, f), 'utf8');
  return {
    dir,
    raw: parseAuditJson(read('audit.json')),
    pkg: JSON.parse(read('package.json')) as PackageJson,
    lock: JSON.parse(read('package-lock.json')) as Lockfile,
  };
}

/** Fake registry: every package has these versions; no extra advisories. */
export const fakeVersions: Record<string, string[]> = {
  axios: ['0.21.0', '0.21.4', '0.32.0', '0.33.0', '0.34.0', '1.0.0'],
  express: ['4.17.1', '4.20.0', '4.21.2', '4.22.0', '5.0.0'],
  'body-parser': ['1.19.0', '1.20.5', '1.20.6'],
  cookie: ['0.4.0', '0.6.0', '0.7.0'],
  'path-to-regexp': ['0.1.7', '0.1.12', '0.1.13'],
  qs: ['6.7.0', '6.15.3', '6.16.0'],
  send: ['0.17.1', '0.18.0', '0.19.0'],
  'serve-static': ['1.14.1', '1.16.0', '1.16.1'],
};

export async function normalizedExpressApp(extraAdvisories: Record<string, string[]> = {}): Promise<Vulnerability[]> {
  const { raw, pkg, lock } = loadExpressApp();
  const result = await normalizeReport(raw, {
    pkg,
    lock,
    fetchVersions: async (name) => fakeVersions[name] ?? [],
    fetchAdvisoryRanges: async (name) => extraAdvisories[name] ?? [],
  });
  return result.vulnerabilities;
}

export function vuln(partial: Partial<Vulnerability> & { name: string }): Vulnerability {
  return {
    severity: 'high',
    isDirect: false,
    isProd: true,
    currentVersions: ['1.0.0'],
    otherVersions: [],
    range: '<1.0.1',
    vulnerableRange: '<1.0.1',
    fixAvailable: true,
    fix: { kind: 'override', target: partial.name, version: '1.0.1', isSemVerMajor: false },
    via: [],
    effects: [],
    advisories: [],
    nodes: [`node_modules/${partial.name}`],
    ...partial,
  };
}
