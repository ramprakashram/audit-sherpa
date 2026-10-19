import { Box, Text } from 'ink';
import { fitWidths, fixVersionText, fixViaText, isMajorFix, truncate } from '../../report/columns.js';
import type { Vulnerability } from '../../types.js';
import { SEVERITY_COLOR } from './theme.js';

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
