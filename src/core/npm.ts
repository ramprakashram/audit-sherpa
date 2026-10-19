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
  /** Skip package lifecycle scripts (preinstall/install/postinstall/prepare), like `npm --ignore-scripts`. */
  ignoreScripts?: boolean;
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

let registryOverride: string | undefined;

/**
 * Uses `url` as the npm registry for every npm command and registry request made by audit-sherpa,
 * like passing `--registry <url>` to npm. Scoped registries from .npmrc still apply. Pass undefined to reset.
 */
export function setNpmRegistry(url?: string): void {
  registryOverride = url ? normalizeRegistryUrl(url) : undefined;
}

export function getNpmRegistryOverride(): string | undefined {
  return registryOverride;
}

/** Validates a registry URL and adds the trailing slash npm expects. Throws on invalid input. */
export function normalizeRegistryUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error(`Invalid registry URL: "${url}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid registry URL: "${url}" (must start with http:// or https://)`);
  }
  const s = parsed.toString();
  return s.endsWith('/') ? s : `${s}/`;
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
      ...(registryOverride ? { npm_config_registry: registryOverride } : {}),
      // only ever turn scripts off; an `ignore-scripts=true` in the user's .npmrc stays in effect otherwise
      ...(opts.ignoreScripts ? { npm_config_ignore_scripts: 'true' } : {}),
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
