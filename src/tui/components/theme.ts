import type { Severity } from '../../types.js';

export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: 'magenta',
  high: 'red',
  moderate: 'yellow',
  low: 'cyan',
  info: 'gray',
};
