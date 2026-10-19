import { Box, Text } from 'ink';
import { basename } from 'node:path';
import { Spinner } from './Spinner.js';

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
