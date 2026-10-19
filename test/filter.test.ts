import { describe, expect, it } from 'vitest';
import { filterVulnerabilities } from '../src/core/filter.js';
import { vuln } from './helpers.js';

const vulns = [
  vuln({ name: 'a', severity: 'critical', isDirect: true, isProd: true }),
  vuln({ name: 'b', severity: 'high', isDirect: false, isProd: true }),
  vuln({ name: 'c', severity: 'moderate', isDirect: true, isProd: false }),
  vuln({ name: 'd', severity: 'low', isDirect: false, isProd: false }),
];
const names = (f: Parameters<typeof filterVulnerabilities>[1]) => filterVulnerabilities(vulns, f).map((v) => v.name);

describe('filterVulnerabilities', () => {
  it('returns everything by default or with severity "all"', () => {
    expect(names({})).toEqual(['a', 'b', 'c', 'd']);
    expect(names({ severity: 'all' })).toEqual(['a', 'b', 'c', 'd']);
  });

  it('filters by production and direct dependencies', () => {
    expect(names({ prodOnly: true })).toEqual(['a', 'b']);
    expect(names({ directOnly: true })).toEqual(['a', 'c']);
    expect(names({ prodOnly: true, directOnly: true })).toEqual(['a']);
  });

  it('treats severity as a minimum unless severityExact is set', () => {
    expect(names({ severity: 'high' })).toEqual(['a', 'b']);
    expect(names({ severity: 'high', severityExact: true })).toEqual(['b']);
    expect(names({ severity: 'low' })).toEqual(['a', 'b', 'c', 'd']);
  });

  it('filters by package name', () => {
    expect(names({ packages: ['c', 'zzz'] })).toEqual(['c']);
  });
});
