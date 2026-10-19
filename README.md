# audit-sherpa

> Your guide through `npm audit`. List vulnerabilities in a clean, filterable table and fix exactly what you want: production only, direct only, or hand-picked packages. Includes an MCP server, so AI agents can debug and fix vulnerabilities for you.

```
$ npx audit-sherpa
⛰ audit-sherpa · my-app · 14 vulnerabilities (2 critical, 9 high, 3 low) · scanned 10:24:45 am
p prod ✓  d direct  x fix available ✓  s severity all  / search  o sort severity  m majors held back
showing 12 of 14 · 2 selected · filters: prod only, fix available

      Package        Severity Direct Prod Fix Current Fix Version Via    Major
▶ [x] mkdirp         critical yes    yes  yes 0.5.1   0.5.6
  [ ] minimist       critical no     yes  yes 0.0.8   0.5.6       mkdirp
  [ ] axios          high     yes    yes  yes 0.21.0  0.34.0             ⚠ yes
  [x] lodash         high     yes    yes  yes 4.17.15 4.18.1
  [ ] qs             high     no     yes  yes 6.7.0   6.16.0
  …
──────────────────────────────────────────────────────────────────────────────────
● Prototype Pollution in minimist https://github.com/advisories/GHSA-…
↑↓ move  space select  f fix  p/d/x/s filters  / search  r re-scan  e export  b rollback  ? help  q quit
```

Running `audit-sherpa` starts an interactive terminal session. You browse, filter, select, fix, roll back and re-scan in one place without retyping commands. One-shot subcommands are still available for scripts, CI and AI agents.

## Features

- **Interactive session.** A full-screen terminal UI (like `htop`) that stays open: filter with single keys, multi-select packages, preview the fix plan, watch fixes run live, then roll back or re-scan.
- **Readable report.** Runs `npm audit --json` (auditReportVersion 2) and shows package, severity, direct/transitive, prod/dev, fix availability, current version, fix version, the package that gets bumped (`Via`), and a separate `Major` (breaking-change) column.
- **Filters.** Production only, direct only, fix available, severity (`critical|high|moderate|low|info|all`), package names, and search.
- **Fast startup.** Fix versions are resolved through the registry HTTP API in parallel, with a live "Booting up Audit Sherpa…" progress screen.
- **Selective fixes.** Fix production deps only, direct deps only, everything, or pick packages from an interactive multiselect.
- **Safe fix versions.** Fix versions are checked against *all* known advisories, not only the ones affecting the installed version. npm alone sometimes suggests a version that is still vulnerable.
- **Breaking-change guard.** Semver-major updates are held back unless you confirm, or pass `--allow-major`.
- **Live progress.** A spinner for each fix with streaming npm output, and a before/after vulnerability count.
- **Safety net.** Automatic backup of `package.json` and `package-lock.json`, per-fix revert on failure, a `rollback` command, `--dry-run`, and an `npm ls` health check after fixing.
- **Exports.** JSON and Markdown reports, plus `--fail-on <severity>` for CI.
- **MCP server.** `audit_list`, `audit_fix_plan`, `audit_fix` and `audit_rollback` tools for Claude, Copilot, Cursor and other MCP clients.

## Install

```bash
npm install -g audit-sherpa      # or run ad hoc with: npx audit-sherpa
```

Requires Node.js >= 22.12, npm >= 7, and a `package-lock.json` in the project.

## Usage

### Interactive mode (default)

```bash
audit-sherpa                          # start the interactive session in the current project
audit-sherpa -C ../other-project      # in another project
audit-sherpa --prod --severity high   # start with filters already applied
```

| Key | Action |
| --- | --- |
| `↑` `↓` / `j` `k`, `PgUp` `PgDn`, `g` `G` | Move and scroll |
| `space` | Select or unselect the package (fixable rows only) |
| `a` / `n` | Select all fixable rows in view / clear the selection |
| `p` / `d` / `x` | Toggle production only / direct only / fix available |
| `s` / `S` | Cycle minimum severity / toggle exact severity match |
| `/` | Search by package name (`esc` clears) |
| `c` | Clear all filters |
| `o` | Cycle sort: severity, name, scope |
| `enter` | Show all advisories and details for the current row |
| `f` | Fix: selected packages, everything in view, production only, or direct only. Shows the plan first |
| `m` | Allow or hold back semver-major (potentially breaking) updates |
| `r` | Re-run npm audit |
| `e` | Export the current view to JSON or Markdown |
| `b` | Backups: roll back to any earlier backup |
| `?` | Help |
| `q` | Quit |

The session falls back to the one-shot table when output is not an interactive terminal (pipes, CI), or with `--json`, `--md`, `--fail-on` or `--no-tui`.

### List vulnerabilities (one-shot)

```bash
audit-sherpa list                     # print the table and exit
audit-sherpa list --prod              # production dependencies only
audit-sherpa list --direct            # direct dependencies only
audit-sherpa list --fixable           # only vulnerabilities with a fix available
audit-sherpa --no-tui --severity high # same as `list`; high and critical
audit-sherpa --severity moderate --severity-exact
audit-sherpa --details                # include advisory titles and links
audit-sherpa --json                   # JSON to stdout
audit-sherpa --json report.json --md report.md
audit-sherpa --prod --fail-on high    # exit code 1 for CI if a high/critical prod vuln exists
```

### Fix vulnerabilities

```bash
audit-sherpa fix                      # interactive: choose all / prod / direct / pick packages
audit-sherpa fix --prod -y            # fix all production vulnerabilities without prompts
audit-sherpa fix --direct -y          # fix direct dependencies only
audit-sherpa fix --packages lodash qs # fix specific packages
audit-sherpa fix --severity critical --dry-run
audit-sherpa fix --allow-major -y     # include semver-major (potentially breaking) updates
```

| Option | Description |
| --- | --- |
| `-p, --prod` | Only production dependencies |
| `-d, --direct` | Only direct dependencies |
| `-s, --severity <level>` | Minimum severity: `all` (default), `critical`, `high`, `moderate`, `low`, `info` |
| `--severity-exact` | Match the severity exactly |
| `-F, --fixable` | Only vulnerabilities that have a fix available |
| `--packages <names...>` | Only these vulnerable packages (space or comma separated) |
| `-i, --interactive` | Always show the interactive selector |
| `--allow-major` | Allow semver-major updates. **These may contain breaking changes.** |
| `--dry-run` | Show the fix plan and commands without changing anything |
| `-y, --yes` | No prompts. Semver-major fixes are still skipped unless `--allow-major` is set |
| `--no-backup` | Do not back up `package.json` / lockfile |
| `--no-registry` | Do not query the registry to resolve or verify fix versions |
| `--input <file>` | Use an existing `npm audit --json` output instead of running npm audit |
| `-C, --cwd <dir>` | Project directory |

### Roll back

```bash
audit-sherpa rollback            # restore the latest backup and run npm install
audit-sherpa rollback --list     # list backups
audit-sherpa rollback --no-install
```

Backups are stored in `.audit-sherpa/backups/` inside your project. The last 10 are kept, and the folder ignores itself in git.

## How fixes work

| Situation | Action |
| --- | --- |
| Vulnerable **direct** dependency | `npm install <pkg>@<safe-version>`. The dependency section (`--save-dev`, etc.) and exact pinning are preserved. |
| **Transitive** dependency fixed by bumping a direct parent (from npm's `fixAvailable`) | `npm install <parent>@<version>` |
| Other **transitive** dependencies | Adds `"overrides": { "<pkg>": "<safe-version>" }` to `package.json` and runs `npm install`. |
| Package vulnerable only **through its dependencies** | Fixes those dependencies instead. |

The "safe version" is the lowest published version that is outside every known advisory range. It stays on the current major line when possible. Otherwise the fix is flagged **⚠ major**.

Each fix runs on its own. If one fails, only that change is reverted and the rest continue. An override is skipped when an earlier update has already removed the vulnerable version. It is also skipped when it would force other, unaffected copies of the package onto a different major version.

## MCP server (for AI agents)

`audit-sherpa mcp` (or the `audit-sherpa-mcp` binary) starts a Model Context Protocol server over stdio.

| Tool | Description |
| --- | --- |
| `audit_list` | Normalized vulnerabilities with filters (`prodOnly`, `directOnly`, `fixableOnly`, `severity`, `packages`) |
| `audit_fix_plan` | Preview fix actions without changing anything |
| `audit_fix` | Apply fixes (supports `dryRun`, `allowMajor`). Reports MCP progress notifications |
| `audit_rollback` | Restore the last backup |

Every tool accepts a `cwd` (absolute project path). It defaults to the server's working directory.

**VS Code** (`.vscode/mcp.json`)

```json
{
  "servers": {
    "audit-sherpa": { "type": "stdio", "command": "npx", "args": ["-y", "audit-sherpa", "mcp"] }
  }
}
```

**GitHub Copilot CLI** (`~/.copilot/mcp-config.json`)

```json
{
  "mcpServers": {
    "audit-sherpa": { "type": "local", "command": "npx", "args": ["-y", "audit-sherpa", "mcp"], "tools": ["*"] }
  }
}
```

**Claude Desktop / Cursor**

```json
{
  "mcpServers": {
    "audit-sherpa": { "command": "npx", "args": ["-y", "audit-sherpa", "mcp"] }
  }
}
```

Example prompt: *"Use audit-sherpa to list the high and critical production vulnerabilities in this repo, then fix the direct ones without breaking changes."*

## Programmatic API

```ts
import { scan, filterVulnerabilities, buildFixPlan, applyFixPlan, readPackageJson } from 'audit-sherpa';

const result = await scan({ cwd: process.cwd() });
const prod = filterVulnerabilities(result.vulnerabilities, { prodOnly: true, severity: 'high' });
const plan = buildFixPlan(prod, await readPackageJson(process.cwd()), { all: result.vulnerabilities });
await applyFixPlan(plan, { onEvent: (e) => console.log(e.type) });
```

## Development

```bash
npm install
npm test          # vitest
npm run typecheck
npm run build     # tsup -> dist/
```

## License

MIT
