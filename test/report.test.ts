import { describe, expect, it } from 'vitest';
import { toJsonReport, toMarkdownReport } from '../src/report/export.js';
import { pickerLabels, renderVulnTable } from '../src/report/table.js';
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
    for (const h of ['Package', 'Severity', 'Direct', 'Prod', 'Fix', 'Current', 'Fix Version', 'Via', 'Major']) {
      expect(out).toContain(h);
    }
    // fix target and major marker live in their own columns, one line per row
    expect(out).toMatch(/│ minimist\s+│ critical │ no\s+│ yes\s+│ yes │ 0\.0\.8\s+│ 0\.5\.6\s+│ mkdirp\s+│\s+│/);
    expect(out).toMatch(/│ jsonwebtoken .*│ 9\.0\.3\s+│\s+│ ⚠ yes │/);
  });

  it('truncates cells instead of wrapping in narrow terminals', async () => {
    const vulns = (await result()).vulnerabilities;
    const lines = strip(renderVulnTable(vulns, { width: 80 })).split('\n');
    expect(Math.max(...lines.map((l) => [...l].length))).toBeLessThanOrEqual(80);
    // header + 3 border lines + one line per vulnerability between separators
    expect(lines.filter((l) => l.startsWith('│'))).toHaveLength(vulns.length + 1);
  });

  it('aligns picker labels with the major marker in its own column', async () => {
    const vulns = (await result()).vulnerabilities;
    const labels = pickerLabels(vulns).map(strip);
    const majorIdx = labels.filter((l) => l.endsWith('⚠ major')).map((l) => l.indexOf('⚠'));
    expect(majorIdx.length).toBeGreaterThan(0);
    expect(new Set(majorIdx).size).toBe(1);
    expect(new Set(labels.map((l, i) => l.indexOf(`  ${vulns[i]!.severity}`))).size).toBe(1);
  });

  it('exports markdown and JSON', async () => {
    const r = await result();
    const md = toMarkdownReport(r, r.vulnerabilities.slice(0, 1));
    expect(md).toContain('| Package | Severity | Direct | Prod | Fix | Current | Fix Version | Via | Major | Advisories |');
    expect(md).toContain('| mkdirp | critical | yes | yes | yes | 0.5.1 | 0.5.6 |  |  | via minimist |');

    const json = JSON.parse(toJsonReport(r, r.vulnerabilities.slice(0, 2)));
    expect(json.shown).toBe(2);
    expect(json.vulnerabilities[1].name).toBe('minimist');
  });
});
