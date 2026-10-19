import { runNpm } from './npm.js';
import type { RawAuditReport } from '../types.js';

export class AuditError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AuditError';
  }
}

const HINTS: Record<string, string> = {
  ENOLOCK: 'No package-lock.json found. Run `npm install` (or `npm i --package-lock-only`) first.',
  ENOAUDIT: 'The registry does not support audits, or it could not be reached.',
  EAUDITNOPJSON: 'No package.json found in this directory.',
  ENOTFOUND: 'Could not reach the npm registry. Check your network or proxy settings.',
};

/** Parses and validates the JSON printed by `npm audit --json`. */
export function parseAuditJson(text: string): RawAuditReport {
  const trimmed = text.trim();
  if (!trimmed) throw new AuditError('npm audit produced no output.');

  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    // npm sometimes prints warnings before the JSON payload
    const start = trimmed.indexOf('{');
    try {
      data = JSON.parse(trimmed.slice(start));
    } catch {
      throw new AuditError('Could not parse npm audit output as JSON.');
    }
  }

  const obj = data as Record<string, unknown>;
  if (obj.error && typeof obj.error === 'object') {
    const e = obj.error as { code?: string; summary?: string; detail?: string };
    const hint = e.code ? HINTS[e.code] : undefined;
    throw new AuditError(
      [e.summary || 'npm audit failed', hint ?? e.detail].filter(Boolean).join('\n'),
      e.code,
    );
  }

  if (obj.auditReportVersion !== 2) {
    const isV1 = 'advisories' in obj;
    throw new AuditError(
      isV1
        ? 'Unsupported audit report (v1, npm 6). audit-sherpa requires auditReportVersion 2 (npm >= 7).'
        : `Unsupported auditReportVersion: ${String(obj.auditReportVersion)}. Only version 2 is supported.`,
      'EUNSUPPORTED',
    );
  }

  if (!obj.vulnerabilities || typeof obj.vulnerabilities !== 'object') {
    throw new AuditError('Malformed audit report: missing "vulnerabilities".');
  }
  return data as RawAuditReport;
}

/** Runs `npm audit --json` in `cwd`. A non-zero exit code is expected when vulnerabilities exist. */
export async function runAudit(cwd: string): Promise<RawAuditReport> {
  const { stdout, stderr } = await runNpm(['audit', '--json'], { cwd });
  if (!stdout.trim()) {
    throw new AuditError(`npm audit failed:\n${stderr.trim() || 'no output'}`);
  }
  return parseAuditJson(stdout);
}
