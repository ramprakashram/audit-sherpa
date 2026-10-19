import { describe, expect, it } from 'vitest';
import { toJsonReport, toMarkdownReport } from '../src/report/export.js';
import { renderVulnTable } from '../src/report/table.js';
import type { AuditResult } from '../src/types.js';
import { normalizedExpressApp } from './helpers.js';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

async function result(): Promise<AuditResult> {
  const vulnerabilities = await normalizedExpressApp();
  return {
    cwd: '/app',
    vulnerabilities,
    summary: { total: vulnerabilities.length, critical: 2, high: 9, moderate: 0, low: 3, info: 0 },
    dependencies: {},
  };
}

describe('reports', () => {
  it('renders a table with the required columns', async () => {
    const out = strip(renderVulnTable((await result()).vulnerabilities));
    for (const h of ['Package', 'Severity', 'Direct', 'Prod', 'Fix Available', 'Current', 'Fix Version', 'Breaking']) {
      expect(out).toContain(h);
    }
    expect(out).toMatch(/minimist\s+│ critical │ no\s+│ yes\s+│ yes\s+│ 0\.0\.8\s+│ 0\.5\.6 \(via mkdirp\)/);
    expect(out).toMatch(/jsonwebtoken.*9\.0\.3\s+│ ⚠ major/);
  });

  it('exports markdown and JSON', async () => {
    const r = await result();
    const md = toMarkdownReport(r, r.vulnerabilities.slice(0, 1));
    expect(md).toContain('| mkdirp | critical | yes | yes | yes | 0.5.1 | 0.5.6 |  | via minimist |');

    const json = JSON.parse(toJsonReport(r, r.vulnerabilities.slice(0, 2)));
    expect(json.shown).toBe(2);
    expect(json.vulnerabilities[1].name).toBe('minimist');
  });
});
