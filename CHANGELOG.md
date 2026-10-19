# Changelog

## 0.2.0

- **Interactive session is now the default.** Running `audit-sherpa` opens a full-screen terminal UI that stays open. You can browse, filter (single-key toggles, search), multi-select, preview and apply fixes with live progress, roll back to any backup, export and re-scan, all without leaving it. The one-shot table moved to `audit-sherpa list` and is still used automatically for pipes/CI, `--json`, `--md`, `--fail-on` and `--no-tui`.
- **Separate `Major` and `Via` columns** in tables, fix plans, the package picker and Markdown export. Cells are truncated to the terminal width instead of wrapping.
- **New "fix available" filter:** `-F, --fixable` (CLI), `fixableOnly` (MCP), `x` (interactive).
- **Faster startup:** fix versions are fetched from the registry HTTP API in parallel instead of spawning `npm view` per package (falls back to `npm view` for registries that need auth). A "Booting up Audit Sherpa…" progress screen shows each step.

## 0.1.0

- Initial release: `list`, `fix`, `rollback`, and `mcp` commands.
- Filters by production, direct, severity, and package.
- Fix strategies: direct installs, parent bumps, and `overrides` for transitive dependencies.
- Semver-major guard, dry run, backups, per-action revert, and live progress.
- JSON and Markdown export, plus `--fail-on` for CI.
- MCP server with `audit_list`, `audit_fix_plan`, `audit_fix`, and `audit_rollback`.
