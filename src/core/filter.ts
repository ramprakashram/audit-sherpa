import type { Severity, SeverityFilter, VulnFilter, Vulnerability } from '../types.js';
import { severityRank } from './parse.js';

export const SEVERITY_FILTERS: SeverityFilter[] = ['all', 'critical', 'high', 'moderate', 'low', 'info'];

export function isSeverityFilter(value: string): value is SeverityFilter {
  return (SEVERITY_FILTERS as string[]).includes(value);
}

export function filterVulnerabilities(vulns: Vulnerability[], filter: VulnFilter = {}): Vulnerability[] {
  const pkgSet = filter.packages?.length ? new Set(filter.packages) : undefined;
  return vulns.filter((v) => {
    if (filter.prodOnly && !v.isProd) return false;
    if (filter.directOnly && !v.isDirect) return false;
    if (pkgSet && !pkgSet.has(v.name)) return false;
    if (filter.severity && filter.severity !== 'all') {
      const want = severityRank(filter.severity as Severity);
      const have = severityRank(v.severity);
      if (filter.severityExact ? have !== want : have < want) return false;
    }
    return true;
  });
}
