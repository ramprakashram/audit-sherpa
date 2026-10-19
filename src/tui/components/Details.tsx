import type React from 'react';
import { Box, Text } from 'ink';
import type { Vulnerability } from '../../types.js';
import { SEVERITY_COLOR } from './theme.js';

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
