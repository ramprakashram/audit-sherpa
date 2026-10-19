import { Box, Text } from 'ink';

export interface MenuOption {
  label: string;
  count: number;
}

export function FixMenu({ options, cursor }: { options: MenuOption[]; cursor: number }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>What would you like to fix?</Text>
      {options.map((o, i) => (
        <Text key={o.label} inverse={i === cursor} dimColor={o.count === 0}>
          {i === cursor ? '▶' : ' '} {i + 1}. {o.label} ({o.count})
        </Text>
      ))}
      <Text dimColor>↑↓/1-4 choose · enter continue · esc back</Text>
    </Box>
  );
}
