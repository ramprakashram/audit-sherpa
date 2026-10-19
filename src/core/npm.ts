import { execa } from 'execa';
import { createInterface } from 'node:readline';

export interface NpmRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface NpmRunOptions {
  cwd: string;
  /** Called for every line printed by npm (stdout + stderr interleaved). */
  onLine?: (line: string) => void;
  timeoutMs?: number;
}

export class NpmError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = 'NpmError';
  }
}

/** Runs `npm <args>` and never throws on a non-zero exit code. */
export async function runNpm(args: string[], opts: NpmRunOptions): Promise<NpmRunResult> {
  const subprocess = execa('npm', args, {
    cwd: opts.cwd,
    reject: false,
    all: true,
    timeout: opts.timeoutMs,
    env: {
      npm_config_color: 'false',
      npm_config_progress: 'false',
      npm_config_update_notifier: 'false',
      npm_config_fund: 'false',
    },
  });

  if (opts.onLine && subprocess.all) {
    const rl = createInterface({ input: subprocess.all });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed) opts.onLine!(trimmed);
    });
  }

  const result = await subprocess;
  if (result.failed && result.exitCode === undefined) {
    throw new NpmError(
      `Failed to run npm: ${result.shortMessage ?? result.message}. Is npm installed and on PATH?`,
      -1,
      String(result.stderr ?? ''),
    );
  }
  return {
    exitCode: result.exitCode ?? 1,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}
