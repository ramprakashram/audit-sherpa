import { filterVulnerabilities, SEVERITY_FILTERS } from '../core/filter.js';
import { severityRank } from '../core/parse.js';
import type { AuditResult, SeverityFilter, Vulnerability } from '../types.js';

export type SortKey = 'severity' | 'name' | 'scope';
export const SORT_KEYS: SortKey[] = ['severity', 'name', 'scope'];

export interface Filters {
  prodOnly: boolean;
  directOnly: boolean;
  fixableOnly: boolean;
  severity: SeverityFilter;
  severityExact: boolean;
  search: string;
}

export interface TableState {
  result?: AuditResult;
  filters: Filters;
  sort: SortKey;
  /** Index into the visible (filtered + sorted) list. */
  cursor: number;
  selected: ReadonlySet<string>;
  allowMajor: boolean;
  showDetails: boolean;
}

export type TableAction =
  | { type: 'set-result'; result: AuditResult }
  | { type: 'toggle'; key: 'prodOnly' | 'directOnly' | 'fixableOnly' | 'severityExact' | 'allowMajor' | 'showDetails' }
  | { type: 'cycle-severity' }
  | { type: 'cycle-sort' }
  | { type: 'set-search'; search: string }
  | { type: 'move'; delta: number }
  | { type: 'move-to'; index: number }
  | { type: 'toggle-select' }
  | { type: 'select-all' }
  | { type: 'clear-selection' }
  | { type: 'reset-filters' };

export const DEFAULT_FILTERS: Filters = {
  prodOnly: false,
  directOnly: false,
  fixableOnly: false,
  severity: 'all',
  severityExact: false,
  search: '',
};

export function initialTableState(filters: Partial<Filters> = {}, allowMajor = false): TableState {
  return {
    filters: { ...DEFAULT_FILTERS, ...filters },
    sort: 'severity',
    cursor: 0,
    selected: new Set(),
    allowMajor,
    showDetails: false,
  };
}

const scopeRank = (v: Vulnerability) => Number(v.isDirect) * 2 + Number(v.isProd);
const bySeverity = (a: Vulnerability, b: Vulnerability) => severityRank(b.severity) - severityRank(a.severity);

export function sortVulns(vulns: Vulnerability[], sort: SortKey): Vulnerability[] {
  const out = [...vulns];
  if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'scope') out.sort((a, b) => scopeRank(b) - scopeRank(a) || bySeverity(a, b) || a.name.localeCompare(b.name));
  else out.sort((a, b) => bySeverity(a, b) || Number(b.isDirect) - Number(a.isDirect) || a.name.localeCompare(b.name));
  return out;
}

export function visibleVulns(state: TableState): Vulnerability[] {
  if (!state.result) return [];
  return sortVulns(filterVulnerabilities(state.result.vulnerabilities, state.filters), state.sort);
}

/** Selected vulnerabilities. Selection survives filter changes. */
export function selectedVulns(state: TableState): Vulnerability[] {
  return (state.result?.vulnerabilities ?? []).filter((v) => state.selected.has(v.name));
}

function clamp(state: TableState): TableState {
  const n = visibleVulns(state).length;
  const cursor = Math.max(0, Math.min(state.cursor, n - 1));
  return cursor === state.cursor ? state : { ...state, cursor };
}

export function tableReducer(state: TableState, action: TableAction): TableState {
  switch (action.type) {
    case 'set-result': {
      // drop selections of packages that are no longer vulnerable or fixable
      const fixable = new Set(action.result.vulnerabilities.filter((v) => v.fixAvailable).map((v) => v.name));
      const selected = new Set([...state.selected].filter((n) => fixable.has(n)));
      return clamp({ ...state, result: action.result, selected });
    }
    case 'toggle':
      if (action.key === 'allowMajor' || action.key === 'showDetails') return { ...state, [action.key]: !state[action.key] };
      return clamp({ ...state, filters: { ...state.filters, [action.key]: !state.filters[action.key] } });
    case 'cycle-severity': {
      // all -> critical -> high -> moderate -> low -> info -> all
      const i = SEVERITY_FILTERS.indexOf(state.filters.severity);
      const severity = SEVERITY_FILTERS[(i + 1) % SEVERITY_FILTERS.length]!;
      return clamp({ ...state, filters: { ...state.filters, severity } });
    }
    case 'cycle-sort':
      return { ...state, sort: SORT_KEYS[(SORT_KEYS.indexOf(state.sort) + 1) % SORT_KEYS.length]!, cursor: 0 };
    case 'set-search':
      return clamp({ ...state, cursor: 0, filters: { ...state.filters, search: action.search } });
    case 'reset-filters':
      return clamp({ ...state, filters: { ...DEFAULT_FILTERS } });
    case 'move':
      return clamp({ ...state, cursor: state.cursor + action.delta });
    case 'move-to':
      return clamp({ ...state, cursor: action.index < 0 ? Number.MAX_SAFE_INTEGER : action.index });
    case 'toggle-select': {
      const v = visibleVulns(state)[state.cursor];
      if (!v || !v.fixAvailable) return state;
      const selected = new Set(state.selected);
      if (selected.has(v.name)) selected.delete(v.name);
      else selected.add(v.name);
      return { ...state, selected };
    }
    case 'select-all': {
      const selected = new Set(state.selected);
      for (const v of visibleVulns(state)) if (v.fixAvailable) selected.add(v.name);
      return { ...state, selected };
    }
    case 'clear-selection':
      return { ...state, selected: new Set() };
  }
}

export type FixScope = 'selected' | 'visible' | 'prod' | 'direct';

/** Vulnerabilities targeted by a fix-menu choice (always limited to fixable ones). */
export function fixTargets(state: TableState, scope: FixScope): Vulnerability[] {
  const fixable = (vs: Vulnerability[]) => vs.filter((v) => v.fixAvailable);
  if (scope === 'selected') return fixable(selectedVulns(state));
  const visible = fixable(visibleVulns(state));
  if (scope === 'prod') return visible.filter((v) => v.isProd);
  if (scope === 'direct') return visible.filter((v) => v.isDirect);
  return visible;
}

export function describeFilters(f: Filters): string[] {
  const parts: string[] = [];
  if (f.prodOnly) parts.push('prod only');
  if (f.directOnly) parts.push('direct only');
  if (f.fixableOnly) parts.push('fix available');
  if (f.severity !== 'all') parts.push(`severity ${f.severityExact ? '=' : '≥'} ${f.severity}`);
  if (f.search) parts.push(`search "${f.search}"`);
  return parts;
}
