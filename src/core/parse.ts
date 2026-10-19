import semver from 'semver';
import type {
  Advisory,
  AuditResult,
  FixInfo,
  RawAuditReport,
  RawVulnerability,
  Severity,
  Vulnerability,
} from '../types.js';
import { getDependencyType, nodePathToName, type Lockfile, type PackageJson } from './project.js';
import { pickSafeVersion, type AdvisoryRangeFetcher, type VersionFetcher } from './registry.js';

export interface NormalizeOptions {
  pkg: PackageJson;
  lock?: Lockfile;
  /** Used to resolve a concrete fix version when npm only reports `fixAvailable: true`. */
  fetchVersions?: VersionFetcher;
  /** Used to make sure a suggested fix version is not affected by other advisories. */
  fetchAdvisoryRanges?: AdvisoryRangeFetcher;
  cwd?: string;
  /** Called after each vulnerability is resolved. */
  onProgress?: (done: number, total: number) => void;
}

export async function normalizeReport(raw: RawAuditReport, opts: NormalizeOptions): Promise<AuditResult> {
  const entries = Object.values(raw.vulnerabilities);
  let done = 0;
  opts.onProgress?.(0, entries.length);
  const vulnerabilities = await mapLimit(entries, 8, async (v) => {
    const r = await normalizeVulnerability(v, opts);
    opts.onProgress?.(++done, entries.length);
    return r;
  });
  vulnerabilities.sort(compareVulns);

  const m = raw.metadata?.vulnerabilities;
  return {
    cwd: opts.cwd ?? process.cwd(),
    vulnerabilities,
    summary: {
      total: m?.total ?? vulnerabilities.length,
      critical: m?.critical ?? 0,
      high: m?.high ?? 0,
      moderate: m?.moderate ?? 0,
      low: m?.low ?? 0,
      info: m?.info ?? 0,
    },
    dependencies: raw.metadata?.dependencies ?? {},
  };
}

async function normalizeVulnerability(raw: RawVulnerability, opts: NormalizeOptions): Promise<Vulnerability> {
  const { pkg, lock } = opts;
  const lockEntries = raw.nodes.map((n) => lock?.packages?.[n]).filter((e) => e !== undefined);

  const currentVersions = unique(lockEntries.map((e) => e.version).filter((v): v is string => !!v)).sort(
    (a, b) => (semver.valid(a) && semver.valid(b) ? semver.compare(a, b) : a.localeCompare(b)),
  );
  // Without lockfile info we cannot prove it is dev-only, so assume production.
  const isProd = lockEntries.length === 0 ? true : lockEntries.some((e) => !e.dev);
  const dependencyType = raw.isDirect ? getDependencyType(pkg, raw.name) : undefined;

  const advisories: Advisory[] = raw.via
    .filter((v): v is Exclude<typeof v, string> => typeof v === 'object' && v !== null)
    .map((a) => ({
      id: a.source,
      title: a.title,
      url: a.url,
      severity: a.severity,
      range: a.range,
      cwe: a.cwe ?? [],
      cvssScore: a.cvss?.score || undefined,
    }));
  const via = unique(raw.via.filter((v): v is string => typeof v === 'string'));

  // Advisory ranges are more reliable than npm's combined `range`, which can be computed from stale metadata.
  // Packages that are only vulnerable through their dependencies have no advisories of their own.
  const vulnerableRange = advisories.length ? advisories.map((a) => a.range).join(' || ') : raw.range;
  const fix =
    raw.fixAvailable === true && advisories.length === 0 && via.length > 0
      ? { kind: 'via' as const, via, isSemVerMajor: false }
      : await resolveFix(raw, currentVersions, vulnerableRange, opts);

  const nodeSet = new Set(raw.nodes);
  const otherVersions = unique(
    Object.entries(lock?.packages ?? {})
      .filter(([path, e]) => path && !nodeSet.has(path) && nodePathToName(path) === raw.name && !e.link && e.version)
      .map(([, e]) => e.version!),
  );

  return {
    name: raw.name,
    severity: raw.severity,
    isDirect: raw.isDirect,
    isProd,
    dependencyType,
    currentVersions,
    otherVersions,
    range: raw.range,
    vulnerableRange,
    fixAvailable: raw.fixAvailable !== false,
    fix,
    via,
    effects: raw.effects ?? [],
    advisories,
    nodes: raw.nodes,
  };
}

async function resolveFix(
  raw: RawVulnerability,
  currentVersions: string[],
  vulnerableRange: string,
  opts: NormalizeOptions,
): Promise<FixInfo> {
  const fa = raw.fixAvailable;
  if (fa === false) return { kind: 'none', isSemVerMajor: false };

  if (typeof fa === 'object') {
    const targetIsDirect = getDependencyType(opts.pkg, fa.name) !== undefined;
    const fix: FixInfo = {
      kind: targetIsDirect ? 'install' : 'override',
      target: fa.name,
      version: fa.version,
      isSemVerMajor: fa.isSemVerMajor,
    };
    if (fa.name !== raw.name) fix.targetCurrentVersion = opts.lock?.packages?.[`node_modules/${fa.name}`]?.version;
    // npm only checks advisories affecting the *installed* version, so its suggestion can still be vulnerable.
    if (fa.name === raw.name && semver.valid(fa.version)) {
      const safe = await findSafeVersion(raw.name, vulnerableRange, currentVersions.at(-1), opts);
      if (safe?.picked && safeSatisfies(fa.version, safe.range)) {
        fix.version = safe.picked.version;
        fix.isSemVerMajor = safe.picked.isSemVerMajor;
      }
    }
    return fix;
  }

  // fixAvailable === true: npm can fix it within existing semver ranges. Resolve a concrete safe version.
  const kind = raw.isDirect && getDependencyType(opts.pkg, raw.name) !== undefined ? 'install' : 'override';
  const picked = (await findSafeVersion(raw.name, vulnerableRange, currentVersions.at(-1), opts))?.picked;
  return { kind, target: raw.name, version: picked?.version, isSemVerMajor: picked?.isSemVerMajor ?? false };
}

/** Finds the lowest version outside every known advisory range (from the report plus the registry). */
async function findSafeVersion(
  name: string,
  reportRange: string,
  current: string | undefined,
  opts: NormalizeOptions,
): Promise<{ picked?: { version: string; isSemVerMajor: boolean }; range: string } | undefined> {
  if (!opts.fetchVersions) return undefined;
  try {
    const versions = await opts.fetchVersions(name);
    let range = reportRange;
    if (opts.fetchAdvisoryRanges) {
      const newer = versions.filter(
        (v) => semver.valid(v) && !semver.prerelease(v) && (!current || !semver.valid(current) || semver.gt(v, current)),
      );
      const extra = await opts.fetchAdvisoryRanges(name, newer);
      if (extra.length) range = [reportRange, ...extra].join(' || ');
    }
    return { picked: pickSafeVersion(versions, range, current), range };
  } catch {
    return undefined;
  }
}

const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

export function severityRank(s: Severity): number {
  return SEVERITY_RANK[s] ?? 0;
}

function compareVulns(a: Vulnerability, b: Vulnerability): number {
  return (
    severityRank(b.severity) - severityRank(a.severity) ||
    Number(b.isDirect) - Number(a.isDirect) ||
    a.name.localeCompare(b.name)
  );
}

function safeSatisfies(version: string, range: string): boolean {
  try {
    return semver.satisfies(version, range);
  } catch {
    return false;
  }
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}
