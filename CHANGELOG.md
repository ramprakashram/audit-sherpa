# Changelog

## 0.1.0

- Initial release: `list`, `fix`, `rollback`, and `mcp` commands.
- Filters by production, direct, severity, and package.
- Fix strategies: direct installs, parent bumps, and `overrides` for transitive dependencies.
- Semver-major guard, dry run, backups, per-action revert, and live progress.
- JSON and Markdown export, plus `--fail-on` for CI.
- MCP server with `audit_list`, `audit_fix_plan`, `audit_fix`, and `audit_rollback`.
