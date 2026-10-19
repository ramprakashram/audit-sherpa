import React from 'react';
import { render } from 'ink';
import pc from 'picocolors';
import type { AuditResult } from '../types.js';
import { App, type AppProps } from './App.js';
import { renderSummary } from '../report/table.js';

export type StartTuiOptions = Omit<AppProps, 'onExit'>;

export function canUseTui(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && typeof process.stdin.setRawMode === 'function');
}

/** Starts the interactive full-screen session and resolves when the user quits. */
export async function startTui(opts: StartTuiOptions): Promise<void> {
  let last: AuditResult | undefined;
  const instance = render(<App {...opts} onExit={(r) => (last = r)} />, {
    alternateScreen: true,
    exitOnCtrlC: false,
  });
  await instance.waitUntilExit();
  // the alternate screen is gone now; leave a short summary in the normal terminal
  if (last) console.log(`${pc.cyan('⛰ audit-sherpa')} ${renderSummary(last.summary)}`);
}
