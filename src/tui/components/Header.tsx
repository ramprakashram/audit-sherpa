import { Box, Text } from 'ink';
import { basename } from 'node:path';
import type { AuditSummary } from '../../types.js';
import { describeFilters, type Filters, type SortKey } from '../state.js';
import { SummaryText } from './SummaryText.js';

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
