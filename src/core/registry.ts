import semver from 'semver';
import { getNpmRegistryOverride, runNpm } from './npm.js';

export type VersionFetcher = (name: string) => Promise<string[]>;
/** Returns the vulnerable ranges of all known advisories affecting any of the given versions. */
export type AdvisoryRangeFetcher = (name: string, versions: string[]) => Promise<string[]>;

const cache = new Map<string, Promise<string[]>>();
const registryCache = new Map<string, Promise<string>>();

/** Resolves the configured registry URL (cached; call early to overlap with other work). */
export function getRegistry(cwd: string): Promise<string> {
  const override = getNpmRegistryOverride();
  if (override) return Promise.resolve(override);
  let p = registryCache.get(cwd);
  if (!p) {
    p = runNpm(['config', 'get', 'registry'], { cwd, timeoutMs: 30_000 }).then(({ stdout }) => {
      const url = stdout.trim() || 'https://registry.npmjs.org/';
      return url.endsWith('/') ? url : `${url}/`;
    });
    registryCache.set(cwd, p);
  }
  return p;
}

/** Uses the registry bulk advisory endpoint (the one `npm audit` uses). Fails soft by returning []. */
export function createAdvisoryRangeFetcher(cwd: string): AdvisoryRangeFetcher {
  return async (name, versions) => {
    if (versions.length === 0) return [];
    try {
      const registry = await getRegistry(cwd);
      const res = await fetch(`${registry}-/npm/v1/security/advisories/bulk`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [name]: versions }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as Record<string, Array<{ vulnerable_versions?: string }>>;
      return (data[name] ?? []).map((a) => a.vulnerable_versions).filter((r): r is string => !!r);
    } catch {
      return [];
    }
  };
}

/**
 * Fetches all published versions of a package (cached per process).
 * Uses the registry's abbreviated metadata over HTTP, which is much faster than spawning
 * `npm view` per package, and falls back to `npm view` (which handles auth) if that fails.
 */
export function createNpmVersionFetcher(cwd: string): VersionFetcher {
  return (name) => {
    const key = `${cwd}::${name}`;
    let p = cache.get(key);
    if (!p) {
      p = fetchVersionsHttp(cwd, name).then((v) => v ?? fetchVersionsNpm(cwd, name));
      cache.set(key, p);
    }
    return p;
  };
}

async function fetchVersionsHttp(cwd: string, name: string): Promise<string[] | undefined> {
  try {
    const registry = await getRegistry(cwd);
    const res = await fetch(`${registry}${name.replace('/', '%2f')}`, {
      headers: { accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { versions?: Record<string, unknown> };
    return data.versions ? Object.keys(data.versions) : undefined;
  } catch {
    return undefined;
  }
}

async function fetchVersionsNpm(cwd: string, name: string): Promise<string[]> {
  const { stdout } = await runNpm(['view', name, 'versions', '--json'], { cwd, timeoutMs: 60_000 });
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
    return typeof parsed === 'string' ? [parsed] : [];
  } catch {
    return [];
  }
}

/**
 * Picks the lowest published, non-prerelease version that is outside `vulnerableRange`
 * and greater than `current`. Prefers staying on the current major.
 */
export function pickSafeVersion(
  versions: string[],
  vulnerableRange: string,
  current?: string,
): { version: string; isSemVerMajor: boolean } | undefined {
  const candidates = versions
    .filter((v) => semver.valid(v) && !semver.prerelease(v))
    .filter((v) => !semver.satisfies(v, vulnerableRange, { includePrerelease: false }))
    .filter((v) => !current || !semver.valid(current) || semver.gt(v, current))
    .sort(semver.compare);
  if (candidates.length === 0) return undefined;

  if (current && semver.valid(current)) {
    const sameMajor = candidates.find((v) => isSameMajorLine(v, current));
    if (sameMajor) return { version: sameMajor, isSemVerMajor: false };
    return { version: candidates[0]!, isSemVerMajor: true };
  }
  return { version: candidates[0]!, isSemVerMajor: false };
}

/** Same "caret" compatibility line: 1.x.x, 0.2.x, 0.0.3. */
export function isSameMajorLine(a: string, b: string): boolean {
  return semver.satisfies(a, `^${b}`) || semver.satisfies(b, `^${a}`);
}
