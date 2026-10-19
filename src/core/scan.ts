import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { AuditResult, AuditSummary, RawAuditReport } from '../types.js';
import { parseAuditJson, runAudit } from './audit.js';
import { normalizeReport } from './parse.js';
import { readLockfile, readPackageJson } from './project.js';
import { createAdvisoryRangeFetcher, createNpmVersionFetcher } from './registry.js';

export interface ScanOptions {
  cwd?: string;
  /** Use an existing `npm audit --json` output file instead of running npm audit. */
  inputFile?: string;
  /** Query the registry to resolve fix versions that npm does not report explicitly (default true). */
  resolveVersions?: boolean;
}

/** Runs npm audit and returns a normalized, sorted result. */
export async function scan(opts: ScanOptions = {}): Promise<AuditResult> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  // read package.json first so a wrong directory produces a clear error
  const pkg = await readPackageJson(cwd);
  const raw: RawAuditReport = opts.inputFile
    ? parseAuditJson(await readFile(resolve(cwd, opts.inputFile), 'utf8'))
    : await runAudit(cwd);
  const lock = await readLockfile(cwd);
  return normalizeReport(raw, {
    cwd,
    pkg,
    lock,
    fetchVersions: opts.resolveVersions === false ? undefined : createNpmVersionFetcher(cwd),
    fetchAdvisoryRanges: opts.resolveVersions === false ? undefined : createAdvisoryRangeFetcher(cwd),
  });
}

export function summaryFromRaw(raw: RawAuditReport): AuditSummary {
  const m = raw.metadata.vulnerabilities;
  return {
    total: m.total ?? 0,
    critical: m.critical ?? 0,
    high: m.high ?? 0,
    moderate: m.moderate ?? 0,
    low: m.low ?? 0,
    info: m.info ?? 0,
  };
}
