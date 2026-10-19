#!/usr/bin/env node
import { startMcpServer } from './mcp/server.js';

const cwdFlag = process.argv.indexOf('--cwd');
const cwd = cwdFlag !== -1 ? process.argv[cwdFlag + 1] : undefined;

startMcpServer(cwd).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
