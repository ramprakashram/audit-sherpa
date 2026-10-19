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

  const errorOf = (stdout: object, stderr = '') => {
    try {
      parseAuditJson(JSON.stringify(stdout), stderr);
    } catch (e) {
      return e as AuditError;
    }
    throw new Error('expected parseAuditJson to throw');
  };

  it('reports registry HTTP failures where npm leaves the summary empty (real npm 10 output)', () => {
    const stderr = [
      'npm warn audit 405 Method Not Allowed - POST https://reg.example/-/npm/v1/security/audits/quick',
      'npm error audit endpoint returned an error',
      'npm error A complete log of this run can be found in: C:\\npm-cache\\_logs\\debug-0.log',
    ].join('\n');
    const err = errorOf(
      { message: '405 Method Not Allowed - POST https://reg.example/-/npm/v1/security/audits/quick', statusCode: 405, error: { summary: '', detail: '' } },
      stderr,
    );
    expect(err.code).toBe('E405');
    expect(err.message.split('\n')).toEqual([
      'npm audit failed (E405): 405 Method Not Allowed - POST https://reg.example/-/npm/v1/security/audits/quick',
      expect.stringMatching(/^Hint: This registry does not support npm audit.*--registry https:\/\/registry\.npmjs\.org\//),
      'npm log: C:\\npm-cache\\_logs\\debug-0.log',
    ]);
  });

  it('gives auth and network hints, and keeps extra npm stderr lines', () => {
    expect(errorOf({ message: '401 Unauthorized - POST https://x/', statusCode: 401, error: {} }).message).toMatch(/Hint: .*npm login/);
    const dns = errorOf(
      { message: 'request to https://nope.invalid/ failed, reason: getaddrinfo ENOTFOUND nope.invalid', error: { summary: '', detail: '' } },
      'npm error proxy settings may be wrong',
    );
    expect(dns.message).toMatch(/^npm audit failed: request to https:\/\/nope\.invalid\/ failed/);
    expect(dns.message).toContain('npm error proxy settings may be wrong');
    expect(dns.message).toMatch(/Hint: Could not resolve the registry host/);
  });

  it('shows stderr when npm prints nothing on stdout', () => {
    expect(() => parseAuditJson('', 'npm error code EACCES\nnpm error permission denied')).toThrow(/permission denied/);
  });
});
