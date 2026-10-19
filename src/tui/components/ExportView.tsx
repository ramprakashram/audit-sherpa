import { Box, Text } from 'ink';

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
