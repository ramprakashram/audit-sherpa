import { Text } from 'ink';

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
