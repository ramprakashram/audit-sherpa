import { describe, expect, it } from 'vitest';
import { fixTargets, initialTableState, tableReducer, visibleVulns, type TableAction, type TableState } from '../src/tui/state.js';
import type { AuditResult } from '../src/types.js';
import { vuln } from './helpers.js';

const result: AuditResult = {
  cwd: '/app',
  summary: { total: 4, critical: 1, high: 1, moderate: 1, low: 1, info: 0 },
  dependencies: {},
  vulnerabilities: [
    vuln({ name: 'a', severity: 'low', isDirect: true, isProd: true }),
    vuln({ name: 'b', severity: 'critical', isDirect: false, isProd: true }),
    vuln({ name: 'c', severity: 'high', isDirect: true, isProd: false, fixAvailable: false, fix: { kind: 'none', isSemVerMajor: false } }),
    vuln({ name: 'd', severity: 'moderate', isDirect: false, isProd: false }),
  ],
};

const run = (...actions: TableAction[]): TableState =>
  actions.reduce(tableReducer, tableReducer(initialTableState(), { type: 'set-result', result }));
const names = (s: TableState) => visibleVulns(s).map((v) => v.name);

describe('tableReducer', () => {
  it('sorts by severity by default and cycles sort keys', () => {
    expect(names(run())).toEqual(['b', 'c', 'd', 'a']);
    expect(names(run({ type: 'cycle-sort' }))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('toggles filters, including fixable-only and search', () => {
    expect(names(run({ type: 'toggle', key: 'prodOnly' }))).toEqual(['b', 'a']);
    expect(names(run({ type: 'toggle', key: 'directOnly' }))).toEqual(['c', 'a']);
    expect(names(run({ type: 'toggle', key: 'fixableOnly' }))).toEqual(['b', 'd', 'a']);
    expect(names(run({ type: 'set-search', search: 'D' }))).toEqual(['d']);
    expect(names(run({ type: 'toggle', key: 'prodOnly' }, { type: 'reset-filters' }))).toHaveLength(4);
  });

  it('cycles minimum severity and supports exact matching', () => {
    const high = run({ type: 'cycle-severity' }, { type: 'cycle-severity' });
    expect(high.filters.severity).toBe('high');
    expect(names(high)).toEqual(['b', 'c']);
    expect(names(tableReducer(high, { type: 'toggle', key: 'severityExact' }))).toEqual(['c']);
  });

  it('clamps the cursor when filters shrink the list', () => {
    const s = run({ type: 'move-to', index: -1 }, { type: 'toggle', key: 'prodOnly' });
    expect(s.cursor).toBe(1);
    expect(run({ type: 'move', delta: -5 }).cursor).toBe(0);
  });

  it('only selects fixable rows and keeps selection across filters', () => {
    const s = run({ type: 'move', delta: 1 }, { type: 'toggle-select' });
    expect(s.selected.size).toBe(0); // "c" has no fix
    const all = run({ type: 'select-all' });
    expect([...all.selected].sort()).toEqual(['a', 'b', 'd']);
    const filtered = tableReducer(all, { type: 'toggle', key: 'prodOnly' });
    expect(fixTargets(filtered, 'selected').map((v) => v.name).sort()).toEqual(['a', 'b', 'd']);
    expect(tableReducer(all, { type: 'clear-selection' }).selected.size).toBe(0);
  });

  it('computes fix targets per scope', () => {
    const s = run();
    expect(fixTargets(s, 'visible').map((v) => v.name)).toEqual(['b', 'd', 'a']);
    expect(fixTargets(s, 'prod').map((v) => v.name)).toEqual(['b', 'a']);
    expect(fixTargets(s, 'direct').map((v) => v.name)).toEqual(['a']);
  });

  it('drops selections that are no longer vulnerable after a rescan', () => {
    const s = tableReducer(run({ type: 'select-all' }), {
      type: 'set-result',
      result: { ...result, vulnerabilities: result.vulnerabilities.filter((v) => v.name !== 'b') },
    });
    expect([...s.selected].sort()).toEqual(['a', 'd']);
  });

  it('toggles allow-major', () => {
    expect(run({ type: 'toggle', key: 'allowMajor' }).allowMajor).toBe(true);
  });
});
