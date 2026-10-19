import Table from 'cli-table3';
import pc from 'picocolors';
import type { AuditSummary, FixPlan, Severity, Vulnerability } from '../types.js';
import { currentVersionsText, fitWidths, fixVersionText, fixViaText, isMajorFix, truncate } from './columns.js';

const SEVERITY_COLOR: Record<Severity, (s: string) => string> = {
  critical: (s) => pc.bold(pc.magenta(s)),
  high: pc.red,
  moderate: pc.yellow,
  low: pc.cyan,
  info: pc.gray,
};

export function colorSeverity(s: Severity): string {
  return (SEVERITY_COLOR[s] ?? ((x: string) => x))(s);
}

export function fixVersionLabel(v: Vulnerability): string {
  const { fix } = v;
  if (fix.kind === 'none') return '-';
  if (fix.kind === 'via') return `fix ${fix.via?.join(', ')}`;
  if (!fix.version) return 'unresolved';
  return fix.target && fix.target !== v.name ? `${fix.version} (via ${fix.target})` : fix.version;
}

export function advisoryLabel(v: Vulnerability): string {
  if (v.advisories.length > 0) {
    const first = v.advisories[0]!;
    const more = v.advisories.length > 1 ? ` (+${v.advisories.length - 1} more)` : '';
    return `${first.title}${more}\n${pc.dim(first.url)}`;
  }
  return v.via.length ? `vulnerable via ${v.via.join(', ')}` : '';
}

export interface TableOptions {
  details?: boolean;
  /** Maximum table width in characters (defaults to the terminal width). */
  width?: number;
}

const VULN_HEAD = ['Package', 'Severity', 'Direct', 'Prod', 'Fix', 'Current', 'Fix Version', 'Via', 'Major'];
// columns that may be truncated when the terminal is narrow: Package, Current, Fix Version, Via
const SHRINKABLE = [0, 5, 6, 7];

export function vulnRowText(v: Vulnerability): string[] {
  return [
    v.name,
    v.severity,
    v.isDirect ? 'yes' : 'no',
    v.isProd ? 'yes' : 'no',
    v.fixAvailable ? 'yes' : 'no',
    v.currentVersions.join(', ') || '-',
    fixVersionText(v),
    fixViaText(v),
    isMajorFix(v) ? '⚠ yes' : '',
  ];
}

function colorCell(col: number, text: string, v: Vulnerability): string {
  switch (col) {
    case 0:
      return pc.bold(text);
    case 1:
      return (SEVERITY_COLOR[v.severity] ?? ((x: string) => x))(text);
    case 2:
    case 3:
      return v[col === 2 ? 'isDirect' : 'isProd'] ? pc.green(text) : pc.dim(text);
    case 4:
      return v.fixAvailable ? pc.green(text) : pc.red(text);
    case 7:
      return pc.dim(text);
    case 8:
      return pc.yellow(text);
    default:
      return text;
  }
}

export function renderVulnTable(vulns: Vulnerability[], opts: TableOptions = {}): string {
  const maxWidth = opts.width ?? (process.stdout.columns || 120);
  const rows = vulns.map(vulnRowText);
  const head = opts.details ? [...VULN_HEAD, 'Advisory'] : VULN_HEAD;
  const natural = VULN_HEAD.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)) + 2);
  // one border character per column plus the closing border
  const borders = head.length + 1;
  const advisoryMin = 30;
  const budget = maxWidth - borders - (opts.details ? advisoryMin : 0);
  const widths = fitWidths(natural, budget, SHRINKABLE);
  const colWidths: number[] = opts.details
    ? [...widths, Math.max(advisoryMin, maxWidth - borders - widths.reduce((a, b) => a + b, 0))]
    : widths;

  const table = new Table({
    head: head.map((h) => pc.bold(h)),
    style: { head: [], border: [] },
    colWidths,
    wordWrap: Boolean(opts.details),
  });

  vulns.forEach((v, r) => {
    const row = rows[r]!.map((text, c) => colorCell(c, truncate(text, widths[c]! - 2), v));
    if (opts.details) row.push(advisoryLabel(v));
    table.push(row);
  });
  return table.toString();
}

export function renderSummary(summary: AuditSummary, shown?: number): string {
  const parts = (['critical', 'high', 'moderate', 'low', 'info'] as const)
    .filter((s) => summary[s] > 0)
    .map((s) => `${summary[s]} ${colorSeverity(s)}`);
  const base = summary.total === 0 ? pc.green('No vulnerabilities found') : `${pc.bold(String(summary.total))} vulnerabilities (${parts.join(', ')})`;
  return shown !== undefined && shown !== summary.total ? `${base} — showing ${shown} after filters` : base;
}

export function renderPlan(plan: FixPlan): string {
  const lines: string[] = [];
  if (plan.actions.length) {
    const table = new Table({
      head: ['#', 'Action', 'Package', 'Current', 'Upgrade To', 'Fixes', 'Major'].map((h) => pc.bold(h)),
      style: { head: [], border: [] },
    });
    plan.actions.forEach((a, i) =>
      table.push([
        String(i + 1),
        a.kind === 'install' ? `install${a.saveType && a.saveType !== 'prod' ? ` (${a.saveType})` : ''}` : 'override',
        a.kind === 'override' ? a.overrideKey ?? a.name : a.name,
        currentVersionsText(a),
        pc.green(a.version),
        a.fixes.join(', '),
        a.isSemVerMajor ? pc.yellow('⚠ yes') : '',
      ]),
    );
    lines.push(table.toString());
  }
  if (plan.skipped.length) {
    lines.push(pc.dim('Skipped:'));
    for (const s of plan.skipped) lines.push(pc.dim(`  - ${s.name}: ${s.reason}`));
  }
  return lines.join('\n');
}

/** Picker labels aligned in columns: name, severity, scope, current → fix, major. */
export function pickerLabels(vulns: Vulnerability[]): string[] {
  const cols = vulns.map((v) => [
    v.name,
    v.severity,
    `${v.isDirect ? 'direct' : 'transitive'}, ${v.isProd ? 'prod' : 'dev'}`,
    `${v.currentVersions.join(', ') || '?'} → ${fixVersionText(v)}${fixViaText(v) ? ` (${fixViaText(v)})` : ''}`,
  ]);
  const w = [0, 1, 2, 3].map((i) => Math.max(...cols.map((c) => c[i]!.length)));
  return vulns.map((v, r) => {
    const c = cols[r]!;
    return [
      pc.bold(c[0]!.padEnd(w[0]!)),
      colorSeverity(v.severity).replace(v.severity, c[1]!.padEnd(w[1]!)),
      pc.dim(c[2]!.padEnd(w[2]!)),
      c[3]!.padEnd(w[3]!),
      isMajorFix(v) ? pc.yellow('⚠ major') : '',
    ].join('  ').trimEnd();
  });
}
