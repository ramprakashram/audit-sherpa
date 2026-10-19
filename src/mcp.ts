#!/usr/bin/env node
import { setNpmRegistry } from './core/npm.js';
import { startMcpServer } from './mcp/server.js';

/** Supports `--name value` and `--name=value`. */
function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(name);
  if (i !== -1) return argv[i + 1];
  return argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
}

try {
  setNpmRegistry(arg('--registry'));
} catch (err) {
  console.error((err as Error).message);
  process.exit(2);
}

startMcpServer(arg('--cwd')).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
