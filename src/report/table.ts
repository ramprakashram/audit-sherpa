import Table from 'cli-table3';
import pc from 'picocolors';
import type { AuditSummary, FixPlan, Severity, Vulnerability } from '../types.js';

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
}

export function renderVulnTable(vulns: Vulnerability[], opts: TableOptions = {}): string {
  const head = ['Package', 'Severity', 'Direct', 'Prod', 'Fix Available', 'Current', 'Fix Version', 'Breaking'];
  if (opts.details) head.push('Advisory');
  const table = new Table({
    head: head.map((h) => pc.bold(h)),
    style: { head: [], border: [] },
    wordWrap: true,
    ...(opts.details ? { colWidths: [null, null, null, null, null, null, null, null, 60] } : {}),
  } as Table.TableConstructorOptions);

  for (const v of vulns) {
    const row = [
      pc.bold(v.name),
      colorSeverity(v.severity),
      yesNo(v.isDirect),
      yesNo(v.isProd),
      v.fixAvailable ? pc.green('yes') : pc.red('no'),
      v.currentVersions.join(', ') || '-',
      v.fixAvailable ? fixVersionLabel(v) : '-',
      v.fix.isSemVerMajor ? pc.yellow('⚠ major') : '',
    ];
    if (opts.details) row.push(advisoryLabel(v));
    table.push(row);
  }
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
      head: ['#', 'Action', 'Package', 'Version', 'Fixes', 'Breaking'].map((h) => pc.bold(h)),
      style: { head: [], border: [] },
    });
    plan.actions.forEach((a, i) =>
      table.push([
        String(i + 1),
        a.kind === 'install' ? `install${a.saveType && a.saveType !== 'prod' ? ` (${a.saveType})` : ''}` : 'override',
        a.kind === 'override' ? a.overrideKey ?? a.name : a.name,
        a.version,
        a.fixes.join(', '),
        a.isSemVerMajor ? pc.yellow('⚠ major') : '',
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

function yesNo(b: boolean): string {
  return b ? pc.green('yes') : pc.dim('no');
}
