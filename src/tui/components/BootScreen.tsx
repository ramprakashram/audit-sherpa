import { Box, Text } from 'ink';
import { Elapsed } from './Elapsed.js';
import { Spinner } from './Spinner.js';

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
