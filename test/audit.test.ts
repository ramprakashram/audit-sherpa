import { describe, expect, it } from 'vitest';
import { AuditError, parseAuditJson } from '../src/core/audit.js';

describe('parseAuditJson', () => {
  it('accepts an auditReportVersion 2 report', () => {
    const report = parseAuditJson(JSON.stringify({ auditReportVersion: 2, vulnerabilities: {}, metadata: {} }));
    expect(report.auditReportVersion).toBe(2);
  });

  it('ignores warnings printed before the JSON payload', () => {
    const text = 'npm WARN config something\n' + JSON.stringify({ auditReportVersion: 2, vulnerabilities: {}, metadata: {} });
    expect(parseAuditJson(text).vulnerabilities).toEqual({});
  });

  it('rejects npm 6 (v1) reports', () => {
    expect(() => parseAuditJson(JSON.stringify({ advisories: {}, metadata: {} }))).toThrow(/auditReportVersion 2/);
  });

  it('turns npm error payloads into a helpful AuditError', () => {
    const err = (() => {
      try {
        parseAuditJson(JSON.stringify({ error: { code: 'ENOLOCK', summary: 'This command requires an existing lockfile.' } }));
      } catch (e) {
        return e as AuditError;
      }
    })();
    expect(err).toBeInstanceOf(AuditError);
    expect(err?.code).toBe('ENOLOCK');
    expect(err?.message).toMatch(/npm i --package-lock-only/);
  });
});
