import semver from 'semver';
import type { FixAction, FixPlan, SkippedFix, Vulnerability } from '../types.js';
import { getDeclaredSpec, getDependencyType, type PackageJson } from './project.js';
import { isSameMajorLine } from './registry.js';

export interface PlanOptions {
  /** Include semver-major (potentially breaking) updates. */
  allowMajor?: boolean;
  /**
   * All vulnerabilities from the report. Needed to fix packages that are only vulnerable through
   * their dependencies (`via`), even when those dependencies were filtered out.
   */
  all?: Vulnerability[];
}

/** Turns vulnerabilities into a de-duplicated list of concrete fix actions. */
export function buildFixPlan(selected: Vulnerability[], pkg: PackageJson, opts: PlanOptions = {}): FixPlan {
  const byName = new Map<string, Vulnerability>();
  for (const v of opts.all ?? []) byName.set(v.name, v);
  for (const v of selected) byName.set(v.name, v);

  // Walk `via` links so that fixing a package also fixes the dependencies it is vulnerable through.
  const entries = new Map<string, { vuln: Vulnerability; origins: Set<string> }>();
  const queue: Array<{ vuln: Vulnerability; origin?: string }> = selected.map((vuln) => ({ vuln }));
  while (queue.length) {
    const { vuln, origin } = queue.shift()!;
    const existing = entries.get(vuln.name);
    if (existing) {
      if (origin && origin !== vuln.name) existing.origins.add(origin);
      continue;
    }
    entries.set(vuln.name, { vuln, origins: new Set(origin ? [origin] : []) });
    for (const dep of vuln.via) {
      const depVuln = byName.get(dep);
      if (depVuln) queue.push({ vuln: depVuln, origin: vuln.name });
    }
  }

  const actions = new Map<string, FixAction>();
  const skipped: SkippedFix[] = [];

  for (const { vuln: v, origins } of entries.values()) {
    const { fix } = v;
    const fixes = [v.name, ...origins];
    if (fix.kind === 'via') continue;
    const currentVersions =
      fix.target === v.name
        ? v.currentVersions
        : byName.get(fix.target ?? '')?.currentVersions ?? (fix.targetCurrentVersion ? [fix.targetCurrentVersion] : []);
    if (fix.kind === 'none' || !fix.target) {
      skipped.push({ name: v.name, reason: 'No fix available' });
      continue;
    }
    if (!fix.version) {
      skipped.push({ name: v.name, reason: 'Could not resolve a non-vulnerable version from the registry' });
      continue;
    }
    if (fix.isSemVerMajor && !opts.allowMajor) {
      skipped.push({
        name: v.name,
        reason: `Fix requires a semver-major update (${fix.target}@${fix.version}); use --allow-major`,
        requiresMajor: true,
      });
      continue;
    }

    if (fix.kind === 'install') {
      const key = `install:${fix.target}`;
      const existing = actions.get(key);
      if (existing) {
        mergeInto(existing, fixes, fix.version, fix.isSemVerMajor, currentVersions);
        continue;
      }
      const spec = getDeclaredSpec(pkg, fix.target);
      actions.set(key, {
        kind: 'install',
        name: fix.target,
        version: fix.version,
        currentVersions: [...currentVersions],
        isSemVerMajor: fix.isSemVerMajor,
        saveType: getDependencyType(pkg, fix.target) ?? 'prod',
        saveExact: !!spec && semver.valid(spec) !== null,
        fixes,
        description: '',
      });
      continue;
    }

    // override (transitive dependency)
    const name = fix.target;
    if (pkg.overrides && typeof pkg.overrides[name] === 'object' && pkg.overrides[name] !== null) {
      skipped.push({ name: v.name, reason: `package.json already has a nested override for "${name}"; update it manually` });
      continue;
    }
    const incompatible = name === v.name ? v.otherVersions.filter((o) => semver.valid(o) && !isSameMajorLine(o, fix.version!)) : [];
    if (incompatible.length) {
      skipped.push({
        name: v.name,
        reason: `other installed versions of ${name} (${incompatible.join(', ')}) would be forced to ${fix.version}; fix the parent package instead`,
      });
      continue;
    }
    const key = `override:${name}`;
    const existing = actions.get(key);
    if (existing) {
      mergeInto(existing, fixes, fix.version, fix.isSemVerMajor, currentVersions);
      existing.vulnerableRange = [existing.vulnerableRange, v.vulnerableRange].filter(Boolean).join(' || ');
      continue;
    }
    actions.set(key, {
      kind: 'override',
      name,
      // a caret range keeps other (compatible) copies of the package from being downgraded
      version: name === v.name && v.otherVersions.length ? `^${fix.version}` : fix.version,
      currentVersions: [...currentVersions],
      isSemVerMajor: fix.isSemVerMajor,
      overrideKey: name,
      vulnerableRange: name === v.name ? v.vulnerableRange : undefined,
      fixes,
      description: '',
    });
  }

  const list = [...actions.values()].sort(
    (a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'install' ? -1 : 1),
  );
  for (const a of list) a.description = describeAction(a);

  // Packages that are only vulnerable through dependencies we could not fix.
  const covered = new Set(list.flatMap((a) => a.fixes));
  for (const { vuln } of entries.values()) {
    if (vuln.fix.kind === 'via' && !covered.has(vuln.name)) {
      skipped.push({ name: vuln.name, reason: `Vulnerable through ${vuln.via.join(', ')}, which cannot be fixed automatically` });
    }
  }
  return { actions: list, skipped };
}

function mergeInto(action: FixAction, fixes: string[], version: string, isMajor: boolean, currentVersions: string[]): void {
  for (const f of fixes) if (!action.fixes.includes(f)) action.fixes.push(f);
  action.currentVersions ??= [];
  for (const c of currentVersions) if (!action.currentVersions.includes(c)) action.currentVersions.push(c);
  const current = semver.coerce(action.version)?.version;
  if (semver.valid(version) && current && semver.gt(version, current)) {
    action.version = action.version.startsWith('^') ? `^${version}` : version;
  }
  action.isSemVerMajor ||= isMajor;
}

export function installArgs(action: FixAction): string[] {
  const args = ['install', `${action.name}@${action.version}`];
  if (action.saveType === 'dev') args.push('--save-dev');
  else if (action.saveType === 'optional') args.push('--save-optional');
  else if (action.saveType === 'peer') args.push('--save-peer');
  if (action.saveExact) args.push('--save-exact');
  return args;
}

export function describeAction(action: FixAction): string {
  if (action.kind === 'install') return `npm ${installArgs(action).join(' ')}`;
  return `overrides["${action.overrideKey ?? action.name}"] = "${action.version}" && npm install`;
}
