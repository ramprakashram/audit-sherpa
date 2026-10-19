export type Severity = 'info' | 'low' | 'moderate' | 'high' | 'critical';

export const SEVERITY_ORDER: Severity[] = ['info', 'low', 'moderate', 'high', 'critical'];

/* ---------- Raw `npm audit --json` (auditReportVersion 2) ---------- */

export interface RawAdvisory {
  source: number;
  name: string;
  dependency: string;
  title: string;
  url: string;
  severity: Severity;
  cwe?: string[];
  cvss?: { score: number; vectorString: string | null };
  range: string;
}

export type RawFixAvailable = boolean | { name: string; version: string; isSemVerMajor: boolean };

export interface RawVulnerability {
  name: string;
  severity: Severity;
  isDirect: boolean;
  via: Array<string | RawAdvisory>;
  effects: string[];
  range: string;
  nodes: string[];
  fixAvailable: RawFixAvailable;
}

export interface RawAuditReport {
  auditReportVersion: number;
  vulnerabilities: Record<string, RawVulnerability>;
  metadata: {
    vulnerabilities: Record<Severity | 'total', number>;
    dependencies: Record<string, number>;
  };
}

/* ---------- Normalized model ---------- */

export interface Advisory {
  id: number;
  title: string;
  url: string;
  severity: Severity;
  range: string;
  cwe: string[];
  cvssScore?: number;
}

export type FixKind =
  /** `npm install <pkg>@<version>` on a direct dependency */
  | 'install'
  /** add an entry to package.json `overrides` (transitive dependency) */
  | 'override'
  /** only vulnerable through its dependencies: fixed by fixing the packages in `via` */
  | 'via'
  /** no automated fix available */
  | 'none';

export interface FixInfo {
  kind: FixKind;
  /** Package that has to change (the vulnerable package itself or a parent to bump). */
  target?: string;
  /** Version to move `target` to. */
  version?: string;
  /** Installed version of `target` when it is a parent package (not the vulnerable package itself). */
  targetCurrentVersion?: string;
  isSemVerMajor: boolean;
  /** For kind `via`: the vulnerable dependencies that need fixing. */
  via?: string[];
}

export type DependencyType = 'prod' | 'dev' | 'optional' | 'peer';

export interface Vulnerability {
  name: string;
  severity: Severity;
  isDirect: boolean;
  /** true when at least one installed instance is part of the production tree */
  isProd: boolean;
  /** For direct dependencies: which package.json section declares it. */
  dependencyType?: DependencyType;
  currentVersions: string[];
  /** Installed versions of the same package that are NOT affected (other copies in the tree). */
  otherVersions: string[];
  /** Vulnerable range reported by npm. */
  range: string;
  /** Range used to decide whether a version is still vulnerable (advisory ranges, or `range`). */
  vulnerableRange: string;
  fixAvailable: boolean;
  fix: FixInfo;
  /** Packages this one is vulnerable through (transitive cause). */
  via: string[];
  /** Packages affected by this vulnerability. */
  effects: string[];
  advisories: Advisory[];
  nodes: string[];
}

export interface AuditSummary {
  total: number;
  critical: number;
  high: number;
  moderate: number;
  low: number;
  info: number;
}

export interface AuditResult {
  cwd: string;
  vulnerabilities: Vulnerability[];
  summary: AuditSummary;
  dependencies: Record<string, number>;
}

/* ---------- Filters / fixes ---------- */

export type SeverityFilter = Severity | 'all';

export interface VulnFilter {
  prodOnly?: boolean;
  directOnly?: boolean;
  /** Only vulnerabilities with a fix available. */
  fixableOnly?: boolean;
  /** Case-insensitive substring match on the package name. */
  search?: string;
  /** Minimum severity (inclusive) unless `severityExact` is set. */
  severity?: SeverityFilter;
  severityExact?: boolean;
  /** Restrict to these package names. */
  packages?: string[];
}

export interface FixAction {
  kind: 'install' | 'override';
  /** Package that will be installed/overridden. */
  name: string;
  version: string;
  /** Currently installed version(s) of `name`. */
  currentVersions?: string[];
  isSemVerMajor: boolean;
  /** For installs: package.json section to save into. */
  saveType?: DependencyType;
  saveExact?: boolean;
  /** For overrides: the key written to package.json `overrides` (the package name). */
  overrideKey?: string;
  /** For overrides: installed versions matching this range still need fixing. */
  vulnerableRange?: string;
  /** Vulnerable packages fixed by this action. */
  fixes: string[];
  /** Human readable command / description. */
  description: string;
}

export interface SkippedFix {
  name: string;
  reason: string;
  /** True when the fix exists but was held back because it is a semver-major (breaking) update. */
  requiresMajor?: boolean;
}

export interface FixPlan {
  actions: FixAction[];
  skipped: SkippedFix[];
}

export type FixEvent =
  | { type: 'backup'; dir: string }
  | { type: 'action-start'; index: number; total: number; action: FixAction }
  | { type: 'action-output'; index: number; total: number; action: FixAction; line: string }
  | { type: 'action-success'; index: number; total: number; action: FixAction; durationMs: number; note?: string }
  | { type: 'action-failure'; index: number; total: number; action: FixAction; error: string; durationMs: number }
  | { type: 'reaudit-start' }
  | { type: 'done'; result: FixResult };

export interface ActionResult {
  action: FixAction;
  ok: boolean;
  error?: string;
  /** e.g. "already resolved by earlier updates" when an action turned out to be unnecessary */
  note?: string;
  durationMs: number;
}

export interface FixResult {
  dryRun: boolean;
  backupDir?: string;
  results: ActionResult[];
  before?: AuditSummary;
  after?: AuditSummary;
  /** Problems reported by `npm ls` after fixing (e.g. invalid peer ranges caused by overrides). */
  treeProblems?: string[];
}
