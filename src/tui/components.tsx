import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { basename } from 'node:path';
import { fitWidths, fixVersionText, fixViaText, isMajorFix, truncate } from '../report/columns.js';
import type { AuditSummary, FixAction, FixPlan, FixResult, Severity, Vulnerability } from '../types.js';
import { describeFilters, type Filters, type SortKey } from './state.js';

export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: 'magenta',
  high: 'red',
  moderate: 'yellow',
  low: 'cyan',
  info: 'gray',
};

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function Spinner({ color = 'cyan' }: { color?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);
  return <Text color={color}>{FRAMES[i]}</Text>;
}

export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  return <Text dimColor>{((now - since) / 1000).toFixed(1)}s</Text>;
}

/* ------------------------------ boot / scan ------------------------------ */

export interface ScanStep {
  label: string;
  startedAt: number;
  ms?: number;
}

export function BootScreen({ title, steps, error }: { title: string; steps: ScanStep[]; error?: string }) {
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color="cyan">
        ⛰  {title}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {steps.map((s, i) => (
          <Text key={i}>
            {s.ms !== undefined ? <Text color="green">✓</Text> : error && i === steps.length - 1 ? <Text color="red">✗</Text> : <Spinner />}{' '}
            {s.label} {s.ms !== undefined ? <Text dimColor>({(s.ms / 1000).toFixed(1)}s)</Text> : !error && <Elapsed since={s.startedAt} />}
          </Text>
        ))}
      </Box>
      {error && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="red">{error}</Text>
          <Text dimColor>r retry · q quit</Text>
        </Box>
      )}
    </Box>
  );
}

/* ------------------------------ header ------------------------------ */

export function SummaryText({ summary }: { summary: AuditSummary }) {
  if (summary.total === 0) return <Text color="green">No vulnerabilities</Text>;
  const parts = (['critical', 'high', 'moderate', 'low', 'info'] as const).filter((s) => summary[s] > 0);
  return (
    <Text>
      <Text bold>{summary.total}</Text> vulnerabilities (
      {parts.map((s, i) => (
        <Text key={s}>
          {i > 0 && ', '}
          {summary[s]} <Text color={SEVERITY_COLOR[s]}>{s}</Text>
        </Text>
      ))}
      )
    </Text>
  );
}

function Chip({ k, label, on }: { k: string; label: string; on: boolean }) {
  return (
    <Text>
      <Text dimColor>{k}</Text> <Text color={on ? 'green' : undefined} dimColor={!on} bold={on}>{label}{on ? ' ✓' : ''}</Text>
      {'  '}
    </Text>
  );
}

export interface HeaderProps {
  version: string;
  cwd: string;
  summary?: AuditSummary;
  scannedAt?: Date;
  filters: Filters;
  sort: SortKey;
  allowMajor: boolean;
  shown: number;
  selected: number;
  searching: boolean;
}

export function Header(p: HeaderProps) {
  const sev = p.filters.severity === 'all' ? 'all' : `${p.filters.severityExact ? '=' : '≥'}${p.filters.severity}`;
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text bold color="cyan">⛰ audit-sherpa</Text>
        <Text dimColor> v{p.version} · {basename(p.cwd) || p.cwd} · </Text>
        {p.summary && <SummaryText summary={p.summary} />}
        {p.scannedAt && <Text dimColor> · scanned {p.scannedAt.toLocaleTimeString()}</Text>}
      </Text>
      <Text wrap="truncate-end">
        <Chip k="p" label="prod" on={p.filters.prodOnly} />
        <Chip k="d" label="direct" on={p.filters.directOnly} />
        <Chip k="x" label="fix available" on={p.filters.fixableOnly} />
        <Text dimColor>s</Text> <Text color={p.filters.severity !== 'all' ? 'green' : undefined} dimColor={p.filters.severity === 'all'}>severity {sev}</Text>
        {'  '}
        <Text dimColor>/</Text>{' '}
        {p.searching ? (
          <Text color="yellow">
            search: {p.filters.search}
            <Text inverse> </Text>
          </Text>
        ) : (
          <Text color={p.filters.search ? 'green' : undefined} dimColor={!p.filters.search}>
            search{p.filters.search ? ` "${p.filters.search}"` : ''}
          </Text>
        )}
        {'  '}
        <Text dimColor>o sort {p.sort}  </Text>
        <Text dimColor>m</Text>{' '}
        {p.allowMajor ? <Text color="red" bold>majors ALLOWED</Text> : <Text dimColor>majors held back</Text>}
      </Text>
      <Text dimColor wrap="truncate-end">
        showing {p.shown}
        {p.summary ? ` of ${p.summary.total}` : ''}
        {p.selected ? <Text color="cyan"> · {p.selected} selected</Text> : ''}
        {describeFilters(p.filters).length ? ` · filters: ${describeFilters(p.filters).join(', ')}` : ''}
      </Text>
    </Box>
  );
}

/* ------------------------------ table ------------------------------ */

const HEAD = ['', 'Package', 'Severity', 'Direct', 'Prod', 'Fix', 'Current', 'Fix Version', 'Via', 'Major'];
const SHRINKABLE = [1, 6, 7, 8];

function rowText(v: Vulnerability, selected: boolean): string[] {
  return [
    v.fixAvailable ? (selected ? '[x]' : '[ ]') : ' - ',
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

export function computeWidths(rows: string[][], width: number): number[] {
  const natural = HEAD.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)) + 1);
  return fitWidths(natural, width - 2, SHRINKABLE, 5);
}

export function VulnTable(props: {
  vulns: Vulnerability[];
  cursor: number;
  offset: number;
  height: number;
  selected: ReadonlySet<string>;
  width: number;
}) {
  const rows = props.vulns.map((v) => rowText(v, props.selected.has(v.name)));
  const widths = computeWidths(rows, props.width);
  const cell = (s: string, i: number) => truncate(s, widths[i]! - 1).padEnd(widths[i]!);
  const window = props.vulns.slice(props.offset, props.offset + props.height);

  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate-end">
        {'  '}
        {HEAD.map(cell).join('')}
      </Text>
      {props.vulns.length === 0 && <Text dimColor>  No vulnerabilities match the current filters.</Text>}
      {window.map((v, i) => {
        const idx = props.offset + i;
        const r = rows[idx]!;
        const active = idx === props.cursor;
        return (
          <Text key={v.name} inverse={active} wrap="truncate-end">
            {active ? '▶ ' : '  '}
            <Text color={props.selected.has(v.name) ? 'cyan' : undefined} dimColor={!v.fixAvailable}>{cell(r[0]!, 0)}</Text>
            <Text bold>{cell(r[1]!, 1)}</Text>
            <Text color={SEVERITY_COLOR[v.severity]}>{cell(r[2]!, 2)}</Text>
            <Text color={v.isDirect ? 'green' : undefined} dimColor={!v.isDirect}>{cell(r[3]!, 3)}</Text>
            <Text color={v.isProd ? 'green' : undefined} dimColor={!v.isProd}>{cell(r[4]!, 4)}</Text>
            <Text color={v.fixAvailable ? 'green' : 'red'}>{cell(r[5]!, 5)}</Text>
            <Text>{cell(r[6]!, 6)}</Text>
            <Text>{cell(r[7]!, 7)}</Text>
            <Text dimColor>{cell(r[8]!, 8)}</Text>
            <Text color="yellow">{cell(r[9]!, 9)}</Text>
          </Text>
        );
      })}
      {props.vulns.length > props.height && (
        <Text dimColor>
          {'  '}
          {props.offset + 1}-{Math.min(props.offset + props.height, props.vulns.length)} of {props.vulns.length}
        </Text>
      )}
    </Box>
  );
}

export function Details({ vuln, expanded, width }: { vuln?: Vulnerability; expanded: boolean; width: number }) {
  if (!vuln) return null;
  const lines: React.ReactNode[] = [];
  const advisories = expanded ? vuln.advisories : vuln.advisories.slice(0, 1);
  for (const a of advisories) {
    lines.push(
      <Text key={`a${a.id}`} wrap="truncate-end">
        <Text color={SEVERITY_COLOR[a.severity]}>●</Text> {a.title} <Text dimColor>{a.url}</Text>
      </Text>,
    );
  }
  if (!expanded && vuln.advisories.length > 1) lines.push(<Text key="more" dimColor>  +{vuln.advisories.length - 1} more advisories (enter to expand)</Text>);
  if (vuln.via.length) lines.push(<Text key="via" wrap="truncate-end">Vulnerable through: {vuln.via.join(', ')}</Text>);
  if (expanded) {
    lines.push(<Text key="range" wrap="truncate-end">Vulnerable range: <Text dimColor>{vuln.vulnerableRange}</Text></Text>);
    lines.push(<Text key="nodes" wrap="truncate-end">Installed at: <Text dimColor>{vuln.nodes.join(', ')}</Text></Text>);
    if (vuln.effects.length) lines.push(<Text key="eff" wrap="truncate-end">Affects: <Text dimColor>{vuln.effects.join(', ')}</Text></Text>);
  }
  return (
    <Box flexDirection="column" borderStyle="single" borderLeft={false} borderRight={false} borderBottom={false} borderDimColor width={width}>
      {lines}
    </Box>
  );
}

export function Footer({ hints }: { hints: Array<[string, string]> }) {
  return (
    <Text wrap="truncate-end">
      {hints.map(([k, label]) => (
        <Text key={k}>
          <Text color="cyan" bold>{k}</Text> <Text dimColor>{label}</Text>
          {'  '}
        </Text>
      ))}
    </Text>
  );
}

/* ------------------------------ fix menu / plan ------------------------------ */

export interface MenuOption {
  label: string;
  count: number;
}

export function FixMenu({ options, cursor }: { options: MenuOption[]; cursor: number }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>What would you like to fix?</Text>
      {options.map((o, i) => (
        <Text key={o.label} inverse={i === cursor} dimColor={o.count === 0}>
          {i === cursor ? '▶' : ' '} {i + 1}. {o.label} ({o.count})
        </Text>
      ))}
      <Text dimColor>↑↓/1-4 choose · enter continue · esc back</Text>
    </Box>
  );
}

function actionLabel(a: FixAction): string {
  return a.kind === 'install' ? `install${a.saveType && a.saveType !== 'prod' ? ` (${a.saveType})` : ''}` : 'override';
}

export function PlanView({ plan, allowMajor, targets }: { plan: FixPlan; allowMajor: boolean; targets: number }) {
  const heldBack = plan.skipped.filter((s) => s.requiresMajor);
  const other = plan.skipped.filter((s) => !s.requiresMajor);
  const nameW = Math.max(7, ...plan.actions.map((a) => (a.overrideKey ?? a.name).length)) + 2;
  const verW = Math.max(7, ...plan.actions.map((a) => a.version.length)) + 2;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>
        Fix plan <Text dimColor>({plan.actions.length} action(s) for {targets} selected vulnerabilit{targets === 1 ? 'y' : 'ies'})</Text>
      </Text>
      {plan.actions.length > 0 && (
        <Text bold>
          {'#  '}
          {'Action'.padEnd(18)}
          {'Package'.padEnd(nameW)}
          {'Version'.padEnd(verW)}
          {'Major'.padEnd(7)}
          Fixes
        </Text>
      )}
      {plan.actions.map((a, i) => (
        <Box key={i} flexDirection="column">
          <Text wrap="truncate-end">
            {String(i + 1).padEnd(3)}
            {actionLabel(a).padEnd(18)}
            <Text bold>{(a.overrideKey ?? a.name).padEnd(nameW)}</Text>
            {a.version.padEnd(verW)}
            <Text color="yellow">{(a.isSemVerMajor ? '⚠ yes' : '').padEnd(7)}</Text>
            <Text dimColor>{a.fixes.join(', ')}</Text>
          </Text>
          <Text dimColor wrap="truncate-end">   $ {a.description}</Text>
        </Box>
      ))}
      {plan.actions.length === 0 && <Text color="yellow">Nothing to fix with this selection.</Text>}
      {heldBack.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow" bold>
            ⚠ {heldBack.length} fix(es) need a semver-major update and MAY INTRODUCE BREAKING CHANGES (held back):
          </Text>
          {heldBack.map((s) => (
            <Text key={s.name} color="yellow" wrap="truncate-end">
              {'   '}- {s.name}: {s.reason.replace(/; use --allow-major$/, '')}
            </Text>
          ))}
        </Box>
      )}
      {allowMajor && plan.actions.some((a) => a.isSemVerMajor) && (
        <Text color="red" bold>⚠ Semver-major updates are included. Review changelogs and run your tests afterwards.</Text>
      )}
      {other.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Skipped:</Text>
          {other.map((s) => (
            <Text key={s.name} dimColor wrap="truncate-end">
              {'  '}- {s.name}: {s.reason}
            </Text>
          ))}
        </Box>
      )}
      <Box marginTop={1}>
        <Text>
          {plan.actions.length > 0 && (
            <>
              <Text color="cyan" bold>y/enter</Text> <Text dimColor>apply  </Text>
            </>
          )}
          <Text color="cyan" bold>m</Text> <Text dimColor>{allowMajor ? 'hold back majors' : 'include majors (may break)'}  </Text>
          <Text color="cyan" bold>esc</Text> <Text dimColor>back</Text>
        </Text>
      </Box>
    </Box>
  );
}

/* ------------------------------ progress / result ------------------------------ */

export type ItemStatus = 'pending' | 'running' | 'ok' | 'failed';

export interface ProgressItem {
  action: FixAction;
  status: ItemStatus;
  note?: string;
  error?: string;
  ms?: number;
  startedAt?: number;
}

export function ProgressView(props: {
  items: ProgressItem[];
  line?: string;
  phase: 'backup' | 'actions' | 'reaudit' | 'rescan';
  backupDir?: string;
  startedAt: number;
}) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>
        Applying fixes <Elapsed since={props.startedAt} />
      </Text>
      {props.backupDir && <Text dimColor>Backup saved to {props.backupDir}</Text>}
      {props.items.map((it, i) => (
        <Box key={i} flexDirection="column">
          <Text wrap="truncate-end">
            {it.status === 'running' ? <Spinner /> : it.status === 'ok' ? <Text color="green">✓</Text> : it.status === 'failed' ? <Text color="red">✗</Text> : <Text dimColor>·</Text>}{' '}
            <Text dimColor>[{i + 1}/{props.items.length}]</Text>{' '}
            <Text dimColor={it.status === 'pending'}>{it.action.description}</Text>
            {it.status === 'running' && it.startedAt && (
              <Text>
                {' '}
                <Elapsed since={it.startedAt} />
              </Text>
            )}
            {it.ms !== undefined && <Text dimColor> ({it.note ?? `${(it.ms / 1000).toFixed(1)}s`})</Text>}
            {it.status === 'failed' && <Text color="red"> reverted</Text>}
          </Text>
          {it.status === 'running' && props.line && (
            <Text dimColor wrap="truncate-end">
              {'    › '}
              {props.line}
            </Text>
          )}
          {it.status === 'failed' && it.error && (
            <Text color="red" dimColor wrap="truncate-end">
              {'    '}
              {it.error.split(/\r?\n/).find((l) => l.trim()) ?? it.error}
            </Text>
          )}
        </Box>
      ))}
      {props.phase === 'reaudit' && (
        <Text>
          <Spinner /> Checking dependency tree and re-running npm audit…
        </Text>
      )}
      {props.phase === 'rescan' && (
        <Text>
          <Spinner /> Refreshing results…
        </Text>
      )}
      <Text dimColor>Please wait. Changes are backed up and can be rolled back with b.</Text>
    </Box>
  );
}

export function ResultView({ result, error }: { result?: FixResult; error?: string }) {
  if (error) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
        <Text color="red" bold>✗ Fix failed</Text>
        <Text>{error}</Text>
        <Text dimColor>enter continue · b backups</Text>
      </Box>
    );
  }
  if (!result) return null;
  const ok = result.results.filter((r) => r.ok).length;
  const failed = result.results.length - ok;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={failed ? 'yellow' : 'green'} paddingX={1}>
      <Text bold>
        <Text color="green">✓ {ok} succeeded</Text>
        {failed > 0 && <Text color="red">, ✗ {failed} failed</Text>}
      </Text>
      {result.after && (
        <Text>
          Vulnerabilities: {result.before?.total ?? '?'} → <Text bold>{result.after.total}</Text>{'  '}
          <SummaryText summary={result.after} />
        </Text>
      )}
      {result.results
        .filter((r) => !r.ok)
        .map((r, i) => (
          <Text key={i} color="red" wrap="truncate-end">
            {'  '}✗ {r.action.name}@{r.action.version}: {(r.error ?? '').split(/\r?\n/).find((l) => l.trim())}
          </Text>
        ))}
      {result.treeProblems?.length ? (
        <Box flexDirection="column">
          <Text color="yellow">⚠ npm ls reports {result.treeProblems.length} problem(s) in the dependency tree:</Text>
          {result.treeProblems.slice(0, 8).map((p, i) => (
            <Text key={i} color="yellow" wrap="truncate-end">
              {'   '}- {p}
            </Text>
          ))}
        </Box>
      ) : null}
      {result.backupDir && <Text dimColor>Backup: {result.backupDir}</Text>}
      <Text dimColor>enter continue · b backups / rollback</Text>
    </Box>
  );
}

/* ------------------------------ backups / export / help ------------------------------ */

export function BackupsView(props: { list: string[]; cursor: number; confirm: boolean; busy: boolean; line?: string; error?: string }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>Backups <Text dimColor>(newest first)</Text></Text>
      {props.list.length === 0 && <Text dimColor>No backups yet. A backup is created automatically before every fix.</Text>}
      {props.list.map((b, i) => (
        <Text key={b} inverse={i === props.cursor && !props.busy}>
          {i === props.cursor ? '▶' : ' '} {basename(b)}
          {i === 0 ? <Text dimColor> (latest)</Text> : ''}
        </Text>
      ))}
      {props.confirm && !props.busy && (
        <Text color="yellow" bold>
          Restore package.json and lockfile from {basename(props.list[props.cursor] ?? '')} and run npm install? (y/n)
        </Text>
      )}
      {props.busy && (
        <Text wrap="truncate-end">
          <Spinner /> Restoring… <Text dimColor>{props.line}</Text>
        </Text>
      )}
      {props.error && <Text color="red">{props.error}</Text>}
      {!props.busy && !props.confirm && <Text dimColor>↑↓ choose · enter restore · esc back</Text>}
    </Box>
  );
}

export function ExportView({ format, filename }: { format?: 'json' | 'md'; filename: string }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>Export the current view</Text>
      {!format ? (
        <Text>
          Format: <Text color="cyan" bold>j</Text> JSON · <Text color="cyan" bold>m</Text> Markdown · <Text dimColor>esc cancel</Text>
        </Text>
      ) : (
        <>
          <Text>
            File name: <Text color="yellow">{filename}</Text>
            <Text inverse> </Text>
          </Text>
          <Text dimColor>enter save (relative to the project) · esc cancel</Text>
        </>
      )}
    </Box>
  );
}

export const HELP: Array<[string, string]> = [
  ['↑ ↓  j k', 'move'],
  ['PgUp PgDn  g G', 'page / top / bottom'],
  ['space', 'select / unselect package (fixable only)'],
  ['a / n', 'select all visible fixable / clear selection'],
  ['enter', 'expand advisory details'],
  ['p', 'toggle production-only'],
  ['d', 'toggle direct-only'],
  ['x', 'toggle fix-available only'],
  ['s / S', 'cycle minimum severity / exact severity match'],
  ['/', 'search by package name (esc clears)'],
  ['c', 'clear all filters'],
  ['o', 'cycle sort (severity, name, scope)'],
  ['m', 'allow / hold back semver-major (breaking) updates'],
  ['f', 'fix… (selected, visible, prod, direct)'],
  ['r', 're-run npm audit'],
  ['e', 'export JSON / Markdown'],
  ['b', 'backups & rollback'],
  ['q', 'quit'],
];

export function HelpView() {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>Keyboard shortcuts</Text>
      {HELP.map(([k, d]) => (
        <Text key={k}>
          <Text color="cyan" bold>{k.padEnd(16)}</Text> {d}
        </Text>
      ))}
      <Text dimColor>press any key to close</Text>
    </Box>
  );
}
