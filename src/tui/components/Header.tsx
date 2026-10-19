import { Box, Text } from 'ink';
import { basename } from 'node:path';
import type { AuditSummary } from '../../types.js';
import type { Filters, SortKey } from '../state.js';
import { SummaryText } from './SummaryText.js';
import { FILTER_COLORS, type FilterKind } from './theme.js';

/** A legend entry: the key in the filter's colour, then the label as a solid badge when active or dimmed when not. */
function Chip({ k, kind, label, on }: { k: string; kind: FilterKind; label: string; on: boolean }) {
  const color = FILTER_COLORS[kind];
  return (
    <Text>
      <Text color={color} bold>{k}</Text>{' '}
      {on ? (
        <Text backgroundColor={color} color="black" bold>
          {` ${label} ✓ `}
        </Text>
      ) : (
        <Text color={color} dimColor>
          {label}
        </Text>
      )}
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
  /** Custom registry from --registry, shown in the title bar. */
  registryUrl?: string;
}

function activeFilters(f: Filters): Array<[FilterKind, string]> {
  const parts: Array<[FilterKind, string]> = [];
  if (f.prodOnly) parts.push(['prod', 'prod only']);
  if (f.directOnly) parts.push(['direct', 'direct only']);
  if (f.fixableOnly) parts.push(['fixable', 'fix available']);
  if (f.severity !== 'all') parts.push(['severity', `severity ${f.severityExact ? '=' : '≥'} ${f.severity}`]);
  if (f.search) parts.push(['search', `search "${f.search}"`]);
  return parts;
}

export function Header(p: HeaderProps) {
  const f = p.filters;
  const sev = f.severity === 'all' ? 'all' : `${f.severityExact ? '=' : '≥'}${f.severity}`;
  const active = activeFilters(f);
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text bold color="cyan">⛰ audit-sherpa</Text>
        <Text dimColor> v{p.version} · {basename(p.cwd) || p.cwd} · </Text>
        {p.summary && <SummaryText summary={p.summary} />}
        {p.scannedAt && <Text dimColor> · scanned {p.scannedAt.toLocaleTimeString()}</Text>}
        {p.registryUrl && <Text dimColor> · registry {p.registryUrl}</Text>}
      </Text>
      <Text wrap="truncate-end">
        <Chip k="p" kind="prod" label="prod" on={f.prodOnly} />
        <Chip k="d" kind="direct" label="direct" on={f.directOnly} />
        <Chip k="x" kind="fixable" label="fix available" on={f.fixableOnly} />
        <Chip k="s" kind="severity" label={`severity ${sev}`} on={f.severity !== 'all'} />
        {p.searching ? (
          <Text>
            <Text color={FILTER_COLORS.search} bold>/</Text>{' '}
            <Text color={FILTER_COLORS.search}>
              search: {f.search}
              <Text inverse> </Text>
            </Text>
            {'  '}
          </Text>
        ) : (
          <Chip k="/" kind="search" label={f.search ? `search "${f.search}"` : 'search'} on={!!f.search} />
        )}
        <Text color={FILTER_COLORS.sort} bold>o</Text> <Text dimColor>sort {p.sort}  </Text>
        <Text color={FILTER_COLORS.majors} bold>m</Text>{' '}
        {p.allowMajor ? (
          <Text backgroundColor={FILTER_COLORS.majors} color="white" bold>
            {' majors ALLOWED '}
          </Text>
        ) : (
          <Text dimColor>majors held back</Text>
        )}
      </Text>
      <Text wrap="truncate-end">
        <Text dimColor>
          showing {p.shown}
          {p.summary ? ` of ${p.summary.total}` : ''}
        </Text>
        {p.selected ? <Text color="cyan"> · {p.selected} selected</Text> : ''}
        {active.length > 0 && <Text dimColor> · filters: </Text>}
        {active.map(([kind, label], i) => (
          <Text key={kind}>
            {i > 0 && <Text dimColor>, </Text>}
            <Text color={FILTER_COLORS[kind]}>{label}</Text>
          </Text>
        ))}
      </Text>
    </Box>
  );
}
