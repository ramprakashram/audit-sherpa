import { Box, Text } from 'ink';
import { currentVersionsText } from '../../report/columns.js';
import type { FixAction, FixPlan } from '../../types.js';

function actionLabel(a: FixAction): string {
  return a.kind === 'install' ? `install${a.saveType && a.saveType !== 'prod' ? ` (${a.saveType})` : ''}` : 'override';
}

export function PlanView({
  plan,
  allowMajor,
  targets,
  ignoreScripts,
}: {
  plan: FixPlan;
  allowMajor: boolean;
  targets: number;
  ignoreScripts?: boolean;
}) {
  const heldBack = plan.skipped.filter((s) => s.requiresMajor);
  const other = plan.skipped.filter((s) => !s.requiresMajor);
  const nameW = Math.max(7, ...plan.actions.map((a) => (a.overrideKey ?? a.name).length)) + 2;
  const verW = Math.max(12, ...plan.actions.map((a) => a.version.length)) + 2;
  const curW = Math.max(9, ...plan.actions.map((a) => currentVersionsText(a).length)) + 2;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>
        Fix plan <Text dimColor>({plan.actions.length} action(s) for {targets} selected vulnerabilit{targets === 1 ? 'y' : 'ies'})</Text>
      </Text>
      {plan.actions.length > 0 && (
        <Text bold>
          {'#  '}
          {'Action'.padEnd(18)}
          {'Package'.padEnd(nameW)}
          {'Current'.padEnd(curW)}
          {'Upgrade To'.padEnd(verW)}
          {'Major'.padEnd(7)}
          Fixes
        </Text>
      )}
      {plan.actions.map((a, i) => (
        <Box key={i} flexDirection="column">
          <Text wrap="truncate-end">
            {String(i + 1).padEnd(3)}
            {actionLabel(a).padEnd(18)}
            <Text bold>{(a.overrideKey ?? a.name).padEnd(nameW)}</Text>
            <Text dimColor>{currentVersionsText(a).padEnd(curW)}</Text>
            <Text color="green">{a.version.padEnd(verW)}</Text>
            <Text color="yellow">{(a.isSemVerMajor ? '⚠ yes' : '').padEnd(7)}</Text>
            <Text dimColor>{a.fixes.join(', ')}</Text>
          </Text>
          <Text dimColor wrap="truncate-end">   $ {a.description}{ignoreScripts ? ' --ignore-scripts' : ''}</Text>
        </Box>
      ))}
      {plan.actions.length === 0 && <Text color="yellow">Nothing to fix with this selection.</Text>}
      {ignoreScripts && plan.actions.length > 0 && (
        <Text color="yellow">Install scripts will be skipped (--ignore-scripts).</Text>
      )}
      {heldBack.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow" bold>
            ⚠ {heldBack.length} fix(es) need a semver-major update and MAY INTRODUCE BREAKING CHANGES (held back):
          </Text>
          {heldBack.map((s) => (
            <Text key={s.name} color="yellow" wrap="truncate-end">
              {'   '}- {s.name}: {s.reason.replace(/; use --allow-major$/, '')}
            </Text>
          ))}
        </Box>
      )}
      {allowMajor && plan.actions.some((a) => a.isSemVerMajor) && (
        <Text color="red" bold>⚠ Semver-major updates are included. Review changelogs and run your tests afterwards.</Text>
      )}
      {other.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Skipped:</Text>
          {other.map((s) => (
            <Text key={s.name} dimColor wrap="truncate-end">
              {'  '}- {s.name}: {s.reason}
            </Text>
          ))}
        </Box>
      )}
      <Box marginTop={1}>
        <Text>
          {plan.actions.length > 0 && (
            <>
              <Text color="cyan" bold>y/enter</Text> <Text dimColor>apply  </Text>
            </>
          )}
          <Text color="cyan" bold>m</Text> <Text dimColor>{allowMajor ? 'hold back majors' : 'include majors (may break)'}  </Text>
          <Text color="cyan" bold>esc</Text> <Text dimColor>back</Text>
        </Text>
      </Box>
    </Box>
  );
}
