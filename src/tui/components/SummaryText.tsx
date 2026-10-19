import { Text } from 'ink';
import type { AuditSummary } from '../../types.js';
import { SEVERITY_COLOR } from './theme.js';

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
