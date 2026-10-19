import { Box, Text } from 'ink';
import type { FixResult } from '../../types.js';
import { SummaryText } from './SummaryText.js';

export function ResultView({ result, error, ignoreScripts }: { result?: FixResult; error?: string; ignoreScripts?: boolean }) {
  if (error) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
        <Text color="red" bold>✗ Fix failed</Text>
        <Text>{error}</Text>
        <Text dimColor>enter continue · b backups</Text>
      </Box>
    );
  }
  if (!result) return null;
  const ok = result.results.filter((r) => r.ok).length;
  const failed = result.results.length - ok;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={failed ? 'yellow' : 'green'} paddingX={1}>
      <Text bold>
        <Text color="green">✓ {ok} succeeded</Text>
        {failed > 0 && <Text color="red">, ✗ {failed} failed</Text>}
      </Text>
      {result.after && (
        <Text>
          Vulnerabilities: {result.before?.total ?? '?'} → <Text bold>{result.after.total}</Text>{'  '}
          <SummaryText summary={result.after} />
        </Text>
      )}
      {result.results
        .filter((r) => !r.ok)
        .map((r, i) => (
          <Text key={i} color="red" wrap="truncate-end">
            {'  '}✗ {r.action.name}@{r.action.version}: {(r.error ?? '').split(/\r?\n/).find((l) => l.trim())}
          </Text>
        ))}
      {result.treeProblems?.length ? (
        <Box flexDirection="column">
          <Text color="yellow">⚠ npm ls reports {result.treeProblems.length} problem(s) in the dependency tree:</Text>
          {result.treeProblems.slice(0, 8).map((p, i) => (
            <Text key={i} color="yellow" wrap="truncate-end">
              {'   '}- {p}
            </Text>
          ))}
        </Box>
      ) : null}
      {ignoreScripts && ok > 0 && (
        <Text color="yellow">
          Install scripts were skipped. If a package needs them (native addons, binary downloads, git hooks), run `npm rebuild`.
        </Text>
      )}
      {result.backupDir && <Text dimColor>Backup: {result.backupDir}</Text>}
      <Text dimColor>enter continue · b backups / rollback</Text>
    </Box>
  );
}
