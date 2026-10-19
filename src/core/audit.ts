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
  EAUDITNOPJSON: 'No package.json found in this directory.',
};

const AUDIT_UNSUPPORTED =
  'This registry does not support npm audit (common with private registries and mirrors such as Artifactory, Nexus or Verdaccio). ' +
  'Point the audit at a registry that does, for example: --registry https://registry.npmjs.org/';

/** Picks a hint from npm's error code, the HTTP status and the error text. */
export function auditErrorHint(code: string | undefined, statusCode: number | undefined, text: string): string | undefined {
  if (code && HINTS[code]) return HINTS[code];
  const t = `${code ?? ''} ${text}`;
  if (statusCode === 401 || /\bE401\b|Unauthorized|unable to authenticate/i.test(t)) {
    return 'The registry requires authentication. Run `npm login --registry <url>` or add an auth token for it to .npmrc.';
  }
  if (statusCode === 403 || /\bE403\b|Forbidden/i.test(t)) return 'The registry denied access. Check your auth token and its permissions.';
  if (code === 'ENOAUDIT' || (statusCode !== undefined && [404, 405, 501].includes(statusCode)) || /\bE(404|405|501)\b/.test(t)) {
    return AUDIT_UNSUPPORTED;
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(t)) return 'Could not resolve the registry host. Check the registry URL, your network, VPN or proxy settings.';
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|ESOCKETTIMEDOUT|socket hang up|network/i.test(t)) {
    return 'Could not connect to the registry. Check your network, VPN or proxy settings (npm config get proxy / https-proxy).';
  }
  if (/CERT|certificate|SSL|TLS/i.test(t)) {
    return 'TLS certificate problem. Behind a corporate proxy, point npm at your CA bundle: npm config set cafile <path-to-ca.pem>.';
  }
  return undefined;
}

/** Useful lines from npm's stderr: drops the generic "audit endpoint returned an error" line and lines already shown. */
function npmOutputLines(stderr: string, alreadyShown: string): { lines: string[]; logFile?: string } {
  let logFile: string | undefined;
  const lines: string[] = [];
  for (const raw of stderr.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const log = /A complete log of this run can be found in:?\s*(.+)$/i.exec(line);
    if (log) {
      logFile = log[1]!.trim();
      continue;
    }
    const text = line.replace(/^npm (error|ERR!|warn|WARN)( audit)?\s*/, '');
    if (!text || /^(audit )?endpoint returned an error$/i.test(text) || alreadyShown.includes(text) || lines.includes(line)) continue;
    lines.push(line);
  }
  return { lines: lines.slice(0, 8), logFile };
}

function formatAuditError(headline: string, opts: { code?: string; statusCode?: number; detail?: string; stderr?: string }): AuditError {
  const { lines, logFile } = npmOutputLines(opts.stderr ?? '', `${headline}\n${opts.detail ?? ''}`);
  const hint = auditErrorHint(opts.code, opts.statusCode, [headline, opts.detail, ...lines].join('\n'));
  const parts = [`npm audit failed${opts.code ? ` (${opts.code})` : ''}: ${headline}`];
  if (opts.detail && opts.detail !== headline) parts.push(opts.detail.trim());
  if (lines.length) parts.push(...lines);
  if (hint) parts.push(`Hint: ${hint}`);
  if (logFile) parts.push(`npm log: ${logFile}`);
  return new AuditError(parts.join('\n'), opts.code);
}

/**
 * Parses and validates the JSON printed by `npm audit --json`.
 * `stderr` (optional) is used to enrich error messages.
 */
export function parseAuditJson(text: string, stderr = ''): RawAuditReport {
  const trimmed = text.trim();
  if (!trimmed) throw formatAuditError('npm audit produced no output.', { stderr });

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
    // npm puts the real reason in different places depending on the failure:
    // error.summary/detail for npm errors, top-level message/statusCode for registry HTTP errors
    const e = obj.error as { code?: string | null; summary?: string; detail?: string };
    const statusCode = typeof obj.statusCode === 'number' ? obj.statusCode : undefined;
    const code = e.code || (typeof obj.code === 'string' && obj.code) || (statusCode ? `E${statusCode}` : undefined);
    const headline = e.summary?.trim() || (typeof obj.message === 'string' && obj.message.trim()) || 'unknown error';
    throw formatAuditError(headline, { code, statusCode, detail: e.detail, stderr });
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
  return parseAuditJson(stdout, stderr);
}
