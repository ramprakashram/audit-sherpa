import { Box, Text } from 'ink';
import type { FixAction } from '../../types.js';
import { Elapsed } from './Elapsed.js';
import { Spinner } from './Spinner.js';

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
