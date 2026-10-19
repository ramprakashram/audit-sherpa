import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { listBackups, restoreBackup } from '../core/backup.js';
import { applyFixPlan } from '../core/fixer.js';
import { buildFixPlan } from '../core/fixPlan.js';
import { runNpm } from '../core/npm.js';
import { readPackageJson, type PackageJson } from '../core/project.js';
import { scan, type ScanOptions, type ScanProgress } from '../core/scan.js';
import { toJsonReport, toMarkdownReport } from '../report/export.js';
import type { AuditResult, FixEvent, FixPlan, FixResult, Vulnerability } from '../types.js';
import {
  BackupsView,
  BootScreen,
  Details,
  ExportView,
  FixMenu,
  Footer,
  Header,
  HelpView,
  PlanView,
  ProgressView,
  ResultView,
  VulnTable,
  type MenuOption,
  type ProgressItem,
  type ScanStep,
} from './components/index.js';
import { fixTargets, initialTableState, tableReducer, visibleVulns, type Filters, type FixScope } from './state.js';

export interface Services {
  scan: (opts: ScanOptions) => Promise<AuditResult>;
  readPackageJson: (cwd: string) => Promise<PackageJson>;
  buildFixPlan: typeof buildFixPlan;
  applyFixPlan: typeof applyFixPlan;
  listBackups: (cwd: string) => Promise<string[]>;
  restoreBackup: (cwd: string, dir?: string) => Promise<string>;
  npmInstall: (cwd: string, onLine: (line: string) => void) => Promise<number>;
  writeFile: (path: string, content: string) => Promise<void>;
}

export const defaultServices: Services = {
  scan,
  readPackageJson,
  buildFixPlan,
  applyFixPlan,
  listBackups,
  restoreBackup,
  npmInstall: async (cwd, onLine) => (await runNpm(['install'], { cwd, onLine })).exitCode,
  writeFile: (path, content) => writeFile(path, content, 'utf8'),
};

export interface AppProps {
  cwd: string;
  version: string;
  inputFile?: string;
  registry?: boolean;
  backup?: boolean;
  initialFilters?: Partial<Filters>;
  allowMajor?: boolean;
  services?: Services;
  /** Called with the latest scan result when the user quits. */
  onExit?: (result?: AuditResult) => void;
}

type Screen =
  | { name: 'scan'; title: string; steps: ScanStep[]; error?: string }
  | { name: 'table' }
  | { name: 'help' }
  | { name: 'fix-menu'; cursor: number }
  | { name: 'plan'; scope: FixScope; targets: Vulnerability[]; pkg: PackageJson; plan: FixPlan }
  | {
      name: 'progress';
      items: ProgressItem[];
      phase: 'backup' | 'actions' | 'reaudit' | 'rescan';
      line?: string;
      backupDir?: string;
      startedAt: number;
    }
  | { name: 'result'; result?: FixResult; error?: string }
  | { name: 'backups'; list: string[]; cursor: number; confirm: boolean; busy: boolean; line?: string; error?: string }
  | { name: 'export'; format?: 'json' | 'md'; filename: string };

const MENU: Array<{ scope: FixScope; label: string }> = [
  { scope: 'selected', label: 'Selected packages' },
  { scope: 'visible', label: 'All fixable in the current view' },
  { scope: 'prod', label: 'Production dependencies only' },
  { scope: 'direct', label: 'Direct dependencies only' },
];

const isPrintable = (s: string) => s.length > 0 && !/[\x00-\x1f\x7f]/.test(s);

export function App(props: AppProps) {
  const services = props.services ?? defaultServices;
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const [table, dispatch] = useReducer(tableReducer, undefined, () =>
    initialTableState(props.initialFilters, props.allowMajor),
  );
  const [screen, setScreen] = useState<Screen>({ name: 'scan', title: 'Booting up Audit Sherpa…', steps: [] });
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState<{ text: string; color: string }>();
  const [scannedAt, setScannedAt] = useState<Date>();
  const offsetRef = useRef(0);
  const ctrlCRef = useRef(0);
  const resultRef = useRef<AuditResult | undefined>(undefined);
  resultRef.current = table.result;

  const notify = useCallback((text: string, color = 'green') => setToast({ text, color }), []);

  /* ------------------------------ scanning ------------------------------ */

  const runScan = useCallback(
    async (title: string, onDone?: (r: AuditResult) => void) => {
      const steps: ScanStep[] = [];
      const push = (label: string) => {
        const last = steps.at(-1);
        if (last && last.ms === undefined) last.ms = Date.now() - last.startedAt;
        steps.push({ label, startedAt: Date.now() });
      };
      const update = (extra: Partial<Extract<Screen, { name: 'scan' }>> = {}) =>
        setScreen({ name: 'scan', title, steps: steps.map((s) => ({ ...s })), ...extra });
      push(`Reading project ${props.cwd}`);
      update();
      try {
        const result = await services.scan({
          cwd: props.cwd,
          inputFile: props.inputFile,
          resolveVersions: props.registry !== false,
          onProgress: (e: ScanProgress) => {
            if (e.phase === 'audit') push(props.inputFile ? `Reading ${props.inputFile}` : 'Running npm audit');
            else if (e.phase === 'resolve') {
              const label = `Checking fix versions against the registry (${e.done}/${e.total})`;
              const last = steps.at(-1);
              if (last?.label.startsWith('Checking fix versions')) last.label = label;
              else push(label);
            } else {
              const last = steps.at(-1);
              if (last && last.ms === undefined) last.ms = Date.now() - last.startedAt;
            }
            update();
          },
        });
        dispatch({ type: 'set-result', result });
        setScannedAt(new Date());
        if (onDone) onDone(result);
        else setScreen({ name: 'table' });
      } catch (err) {
        update({ error: (err as Error).message });
      }
    },
    [props.cwd, props.inputFile, props.registry, services],
  );

  useEffect(() => {
    void runScan('Booting up Audit Sherpa…');
  }, [runScan]);

  /* ------------------------------ fixing ------------------------------ */

  const openPlan = useCallback(
    async (scope: FixScope, allowMajor = table.allowMajor) => {
      const targets = fixTargets(table, scope);
      if (targets.length === 0) {
        notify(scope === 'selected' ? 'Nothing selected. Use space to select packages.' : 'No fixable vulnerabilities in this scope.', 'yellow');
        setScreen({ name: 'table' });
        return;
      }
      try {
        const pkg = await services.readPackageJson(props.cwd);
        const plan = services.buildFixPlan(targets, pkg, { allowMajor, all: table.result?.vulnerabilities });
        setScreen({ name: 'plan', scope, targets, pkg, plan });
      } catch (err) {
        notify((err as Error).message, 'red');
        setScreen({ name: 'table' });
      }
    },
    [table, services, props.cwd, notify],
  );

  const applyPlan = useCallback(
    async (plan: FixPlan) => {
      let state: Extract<Screen, { name: 'progress' }> = {
        name: 'progress',
        items: plan.actions.map((action) => ({ action, status: 'pending' })),
        phase: 'backup',
        startedAt: Date.now(),
      };
      const set = (patch: Partial<typeof state>) => {
        state = { ...state, ...patch };
        setScreen(state);
      };
      const setItem = (i: number, patch: Partial<ProgressItem>) =>
        set({ items: state.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
      set({});

      const onEvent = (e: FixEvent) => {
        switch (e.type) {
          case 'backup':
            set({ backupDir: e.dir });
            break;
          case 'action-start':
            set({ phase: 'actions', line: undefined });
            setItem(e.index - 1, { status: 'running', startedAt: Date.now() });
            break;
          case 'action-output':
            set({ line: e.line });
            break;
          case 'action-success':
            setItem(e.index - 1, { status: 'ok', ms: e.durationMs, note: e.note });
            break;
          case 'action-failure':
            setItem(e.index - 1, { status: 'failed', ms: e.durationMs, error: e.error });
            break;
          case 'reaudit-start':
            set({ phase: 'reaudit', line: undefined });
            break;
          default:
            break;
        }
      };

      try {
        const result = await services.applyFixPlan(plan, {
          cwd: props.cwd,
          backup: props.backup !== false,
          before: table.result?.summary,
          onEvent,
        });
        set({ phase: 'rescan' });
        dispatch({ type: 'clear-selection' });
        await runScan('Refreshing results…', () => setScreen({ name: 'result', result }));
      } catch (err) {
        setScreen({ name: 'result', error: (err as Error).message });
      }
    },
    [services, props.cwd, props.backup, table.result, runScan],
  );

  /* ------------------------------ backups / export ------------------------------ */

  const openBackups = useCallback(async () => {
    const list = (await services.listBackups(props.cwd)).reverse();
    setScreen({ name: 'backups', list, cursor: 0, confirm: false, busy: false });
  }, [services, props.cwd]);

  const restore = useCallback(
    async (s: Extract<Screen, { name: 'backups' }>) => {
      const dir = s.list[s.cursor];
      if (!dir) return;
      let cur = { ...s, busy: true, confirm: false };
      setScreen(cur);
      try {
        await services.restoreBackup(props.cwd, dir);
        const code = await services.npmInstall(props.cwd, (line) => {
          cur = { ...cur, line };
          setScreen(cur);
        });
        await runScan('Refreshing results…', () => {
          setScreen({ name: 'table' });
          notify(code === 0 ? 'Rollback complete.' : 'Files restored, but npm install failed. Run it manually.', code === 0 ? 'green' : 'yellow');
        });
      } catch (err) {
        setScreen({ ...cur, busy: false, error: (err as Error).message });
      }
    },
    [services, props.cwd, runScan, notify],
  );

  const doExport = useCallback(
    async (format: 'json' | 'md', filename: string) => {
      if (!table.result) return;
      const vulns = visibleVulns(table);
      const content = format === 'json' ? toJsonReport(table.result, vulns) + '\n' : toMarkdownReport(table.result, vulns);
      const path = resolve(props.cwd, filename);
      try {
        await services.writeFile(path, content);
        notify(`Exported ${vulns.length} vulnerabilities to ${path}`);
      } catch (err) {
        notify((err as Error).message, 'red');
      }
      setScreen({ name: 'table' });
    },
    [table, props.cwd, services, notify],
  );

  /* ------------------------------ input ------------------------------ */

  const busy = screen.name === 'progress' || (screen.name === 'backups' && screen.busy) || (screen.name === 'scan' && !screen.error);
  const tableHeight = Math.max(3, rows - (table.showDetails ? 14 : 9));
  const vulns = visibleVulns(table);

  const quit = () => {
    props.onExit?.(resultRef.current);
    exit();
  };

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      const now = Date.now();
      if (!busy || now - ctrlCRef.current < 2000) quit();
      else {
        ctrlCRef.current = now;
        notify('Work in progress. Press Ctrl+C again to force quit.', 'yellow');
      }
      return;
    }
    if (toast) setToast(undefined);

    switch (screen.name) {
      case 'scan':
        if (screen.error) {
          if (input === 'r') void runScan('Booting up Audit Sherpa…');
          else if (input === 'q' || key.escape) quit();
        }
        return;
      case 'help':
        setScreen({ name: 'table' });
        return;
      case 'fix-menu': {
        const pick = (i: number) => void openPlan(MENU[i]!.scope);
        if (key.escape) setScreen({ name: 'table' });
        else if (key.upArrow || input === 'k') setScreen({ ...screen, cursor: (screen.cursor + MENU.length - 1) % MENU.length });
        else if (key.downArrow || input === 'j') setScreen({ ...screen, cursor: (screen.cursor + 1) % MENU.length });
        else if (key.return) pick(screen.cursor);
        else if (/^[1-4]$/.test(input)) pick(Number(input) - 1);
        return;
      }
      case 'plan':
        if (key.escape) setScreen({ name: 'table' });
        else if (input === 'm') {
          const allowMajor = !table.allowMajor;
          dispatch({ type: 'toggle', key: 'allowMajor' });
          const plan = services.buildFixPlan(screen.targets, screen.pkg, { allowMajor, all: table.result?.vulnerabilities });
          setScreen({ ...screen, plan });
        } else if ((input === 'y' || key.return) && screen.plan.actions.length) void applyPlan(screen.plan);
        return;
      case 'progress':
        if (input === 'q') notify('A fix is running. Please wait for it to finish.', 'yellow');
        return;
      case 'result':
        if (input === 'b') void openBackups();
        else if (key.return || key.escape || input === 'q' || input === ' ') setScreen({ name: 'table' });
        return;
      case 'backups':
        if (screen.busy) return;
        if (screen.confirm) {
          if (input === 'y') void restore(screen);
          else setScreen({ ...screen, confirm: false });
        } else if (key.escape || input === 'q') setScreen({ name: 'table' });
        else if (key.upArrow || input === 'k') setScreen({ ...screen, cursor: Math.max(0, screen.cursor - 1) });
        else if (key.downArrow || input === 'j') setScreen({ ...screen, cursor: Math.min(screen.list.length - 1, screen.cursor + 1) });
        else if (key.return && screen.list.length) setScreen({ ...screen, confirm: true, error: undefined });
        return;
      case 'export':
        if (key.escape) setScreen({ name: 'table' });
        else if (!screen.format) {
          if (input === 'j' || input === 'm') {
            const format = input === 'j' ? 'json' : 'md';
            setScreen({ ...screen, format, filename: `audit-report.${format}` });
          }
        } else if (key.return) void doExport(screen.format, screen.filename.trim() || `audit-report.${screen.format}`);
        else if (key.backspace || key.delete) setScreen({ ...screen, filename: screen.filename.slice(0, -1) });
        else if (isPrintable(input)) setScreen({ ...screen, filename: screen.filename + input });
        return;
      case 'table':
        break;
    }

    if (searching) {
      if (key.escape) {
        dispatch({ type: 'set-search', search: '' });
        setSearching(false);
      } else if (key.return) setSearching(false);
      else if (key.backspace || key.delete) dispatch({ type: 'set-search', search: table.filters.search.slice(0, -1) });
      else if (isPrintable(input)) dispatch({ type: 'set-search', search: table.filters.search + input });
      return;
    }

    if (key.upArrow || input === 'k') dispatch({ type: 'move', delta: -1 });
    else if (key.downArrow || input === 'j') dispatch({ type: 'move', delta: 1 });
    else if (key.pageUp) dispatch({ type: 'move', delta: -tableHeight });
    else if (key.pageDown) dispatch({ type: 'move', delta: tableHeight });
    else if (key.home || input === 'g') dispatch({ type: 'move-to', index: 0 });
    else if (key.end || input === 'G') dispatch({ type: 'move-to', index: -1 });
    else if (input === ' ') dispatch({ type: 'toggle-select' });
    else if (input === 'a') dispatch({ type: 'select-all' });
    else if (input === 'n') dispatch({ type: 'clear-selection' });
    else if (key.return) dispatch({ type: 'toggle', key: 'showDetails' });
    else if (input === 'p') dispatch({ type: 'toggle', key: 'prodOnly' });
    else if (input === 'd') dispatch({ type: 'toggle', key: 'directOnly' });
    else if (input === 'x') dispatch({ type: 'toggle', key: 'fixableOnly' });
    else if (input === 's') dispatch({ type: 'cycle-severity' });
    else if (input === 'S') dispatch({ type: 'toggle', key: 'severityExact' });
    else if (input === 'c') dispatch({ type: 'reset-filters' });
    else if (input === 'o') dispatch({ type: 'cycle-sort' });
    else if (input === '/') setSearching(true);
    else if (input === 'm') {
      dispatch({ type: 'toggle', key: 'allowMajor' });
      notify(table.allowMajor ? 'Semver-major updates are held back.' : '⚠ Semver-major updates allowed. They may introduce breaking changes.', table.allowMajor ? 'green' : 'yellow');
    } else if (input === 'f') setScreen({ name: 'fix-menu', cursor: table.selected.size ? 0 : 1 });
    else if (input === 'r') void runScan('Re-running npm audit…');
    else if (input === 'e') setScreen({ name: 'export', filename: '' });
    else if (input === 'b') void openBackups();
    else if (input === '?' || input === 'h') setScreen({ name: 'help' });
    else if (input === 'q' || key.escape) quit();
  });

  /* ------------------------------ render ------------------------------ */

  if (screen.name === 'scan') return <BootScreen title={screen.title} steps={screen.steps} error={screen.error} />;

  // keep the cursor inside the visible window
  let offset = offsetRef.current;
  if (table.cursor < offset) offset = table.cursor;
  if (table.cursor >= offset + tableHeight) offset = table.cursor - tableHeight + 1;
  offset = Math.max(0, Math.min(offset, Math.max(0, vulns.length - tableHeight)));
  offsetRef.current = offset;

  const header = (
    <Header
      version={props.version}
      cwd={props.cwd}
      summary={table.result?.summary}
      scannedAt={scannedAt}
      filters={table.filters}
      sort={table.sort}
      allowMajor={table.allowMajor}
      shown={vulns.length}
      selected={table.selected.size}
      searching={searching}
    />
  );

  let body: React.ReactNode;
  switch (screen.name) {
    case 'help':
      body = <HelpView />;
      break;
    case 'fix-menu': {
      const options: MenuOption[] = MENU.map((m) => ({ label: m.label, count: fixTargets(table, m.scope).length }));
      body = <FixMenu options={options} cursor={screen.cursor} />;
      break;
    }
    case 'plan':
      body = <PlanView plan={screen.plan} allowMajor={table.allowMajor} targets={screen.targets.length} />;
      break;
    case 'progress':
      body = <ProgressView items={screen.items} phase={screen.phase} line={screen.line} backupDir={screen.backupDir} startedAt={screen.startedAt} />;
      break;
    case 'result':
      body = <ResultView result={screen.result} error={screen.error} />;
      break;
    case 'backups':
      body = <BackupsView {...screen} />;
      break;
    case 'export':
      body = <ExportView format={screen.format} filename={screen.filename} />;
      break;
    default:
      body = (
        <>
          <VulnTable vulns={vulns} cursor={table.cursor} offset={offset} height={tableHeight} selected={table.selected} width={columns} />
          <Details vuln={vulns[table.cursor]} expanded={table.showDetails} width={columns} />
        </>
      );
  }

  return (
    <Box flexDirection="column" width={columns}>
      {header}
      <Box flexDirection="column" marginTop={1}>
        {body}
      </Box>
      {toast && <Text color={toast.color}>{toast.text}</Text>}
      {screen.name === 'table' && (
        <Footer
          hints={
            searching
              ? [['type', 'to search'], ['enter', 'done'], ['esc', 'clear']]
              : [
                  ['↑↓', 'move'],
                  ['space', 'select'],
                  ['f', 'fix'],
                  ['p/d/x/s', 'filters'],
                  ['/', 'search'],
                  ['r', 're-scan'],
                  ['e', 'export'],
                  ['b', 'rollback'],
                  ['?', 'help'],
                  ['q', 'quit'],
                ]
          }
        />
      )}
    </Box>
  );
}
