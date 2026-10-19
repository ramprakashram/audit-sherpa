import { Box, Text } from 'ink';

export const HELP: Array<[string, string]> = [
  ['↑ ↓  j k', 'move'],
  ['PgUp PgDn  g G', 'page / top / bottom'],
  ['space', 'select / unselect package (fixable only)'],
  ['a / n', 'select all visible fixable / clear selection'],
  ['enter', 'expand advisory details'],
  ['p', 'toggle production-only'],
  ['d', 'toggle direct-only'],
  ['x', 'toggle fix-available only'],
  ['s / S', 'cycle minimum severity / exact severity match'],
  ['/', 'search by package name (esc clears)'],
  ['c', 'clear all filters'],
  ['o', 'cycle sort (severity, name, scope)'],
  ['m', 'allow / hold back semver-major (breaking) updates'],
  ['f', 'fix… (selected, visible, prod, direct)'],
  ['r', 're-run npm audit'],
  ['e', 'export JSON / Markdown'],
  ['b', 'backups & rollback'],
  ['q', 'quit'],
];

export function HelpView() {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>Keyboard shortcuts</Text>
      {HELP.map(([k, d]) => (
        <Text key={k}>
          <Text color="cyan" bold>{k.padEnd(16)}</Text> {d}
        </Text>
      ))}
      <Text dimColor>press any key to close</Text>
    </Box>
  );
}
