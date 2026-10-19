# audit-sherpa

> Your guide through `npm audit`. List vulnerabilities in a clean, filterable table and fix exactly what you want: production only, direct only, or hand-picked packages. Includes an MCP server, so AI agents can debug and fix vulnerabilities for you.

```
$ npx audit-sherpa
14 vulnerabilities (2 critical, 9 high, 3 low)
┌──────────────┬──────────┬────────┬──────┬───────────────┬─────────┬────────────────────┬──────────┐
│ Package      │ Severity │ Direct │ Prod │ Fix Available │ Current │ Fix Version        │ Breaking │
├──────────────┼──────────┼────────┼──────┼───────────────┼─────────┼────────────────────┼──────────┤
│ mkdirp       │ critical │ yes    │ yes  │ yes           │ 0.5.1   │ 0.5.6              │          │
│ minimist     │ critical │ no     │ yes  │ yes           │ 0.0.8   │ 0.5.6 (via mkdirp) │          │
│ axios        │ high     │ yes    │ yes  │ yes           │ 0.21.0  │ 0.34.0             │ ⚠ major  │
│ json5        │ high     │ yes    │ no   │ yes           │ 1.0.1   │ 1.0.2              │          │
│ qs           │ high     │ no     │ yes  │ yes           │ 6.7.0   │ 6.16.0             │          │
│ …            │          │        │      │               │         │                    │          │
└──────────────┴──────────┴────────┴──────┴───────────────┴─────────┴────────────────────┴──────────┘
```

## Features

- **Readable report.** Runs `npm audit --json` (auditReportVersion 2) and shows package, severity, direct/transitive, prod/dev, fix availability, current version, fix version and breaking-change flag.
- **Filters.** `--prod`, `--direct`, `--severity critical|high|moderate|low|info|all`, `--packages`.
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

### List vulnerabilities

```bash
audit-sherpa                          # same as `audit-sherpa list`
audit-sherpa --prod                   # production dependencies only
audit-sherpa --direct                 # direct dependencies only
audit-sherpa --severity high          # high and critical
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
| `audit_list` | Normalized vulnerabilities with filters (`prodOnly`, `directOnly`, `severity`, `packages`) |
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
