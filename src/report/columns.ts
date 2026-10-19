import type { Vulnerability } from '../types.js';

/** Fix version only (no parent/via info). */
export function fixVersionText(v: Vulnerability): string {
  if (!v.fixAvailable || v.fix.kind === 'none') return '-';
  if (v.fix.kind === 'via') return 'via deps';
  return v.fix.version ?? 'unresolved';
}

/** Package the fix is applied through: a parent to bump, or the dependencies to fix. */
export function fixViaText(v: Vulnerability): string {
  if (!v.fixAvailable) return '';
  if (v.fix.kind === 'via') return v.fix.via?.join(', ') ?? '';
  return v.fix.target && v.fix.target !== v.name ? v.fix.target : '';
}

export function isMajorFix(v: Vulnerability): boolean {
  return v.fixAvailable && v.fix.isSemVerMajor;
}

const ANSI = /\x1b\[[0-9;]*m/g;

export function visibleWidth(s: string): number {
  return s.replace(ANSI, '').length;
}

export function truncate(s: string, n: number): string {
  if (n <= 0) return '';
  return s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s;
}

/**
 * Shrinks column widths so their sum fits `max`. Columns listed in `shrinkable` lose width first
 * (widest first) down to `min`; other columns keep their natural width.
 */
export function fitWidths(natural: number[], max: number, shrinkable: number[], min = 6): number[] {
  const widths = [...natural];
  let excess = widths.reduce((a, b) => a + b, 0) - max;
  while (excess > 0) {
    let widest = -1;
    for (const i of shrinkable) {
      if (widths[i]! > min && (widest === -1 || widths[i]! > widths[widest]!)) widest = i;
    }
    if (widest === -1) break;
    widths[widest]!--;
    excess--;
  }
  return widths;
}
