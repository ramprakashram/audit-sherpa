import type { Severity } from '../../types.js';

export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: 'magenta',
  high: 'red',
  moderate: 'yellow',
  low: 'cyan',
  info: 'gray',
};

/** One colour per filter type, used for its key, label/badge and the "filters:" summary. */
export const FILTER_COLORS = {
  prod: 'green',
  direct: 'blueBright',
  fixable: 'magentaBright',
  severity: 'yellow',
  search: 'cyanBright',
  sort: 'white',
  majors: 'red',
} as const;

export type FilterKind = keyof typeof FILTER_COLORS;
