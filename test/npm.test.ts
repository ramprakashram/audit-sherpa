import { afterEach, describe, expect, it, vi } from 'vitest';

const execa = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
vi.mock('execa', () => ({ execa }));

const { runNpm, setNpmRegistry } = await import('../src/core/npm.js');
const envOf = () => (execa.mock.calls.at(-1) as unknown as [string, string[], { env: Record<string, string> }])[2].env;

afterEach(() => {
  execa.mockClear();
  setNpmRegistry(undefined);
});

describe('runNpm', () => {
  it('sets npm_config_ignore_scripts only when ignoreScripts is on', async () => {
    await runNpm(['install'], { cwd: '.', ignoreScripts: true });
    expect(envOf().npm_config_ignore_scripts).toBe('true');

    // never force it off, so `ignore-scripts=true` in the user's .npmrc keeps working
    await runNpm(['install'], { cwd: '.' });
    expect(envOf()).not.toHaveProperty('npm_config_ignore_scripts');
  });

  it('applies the --registry override to every npm command, including installs', async () => {
    setNpmRegistry('https://reg.example');
    await runNpm(['install', 'lodash@4.18.1'], { cwd: '.' });
    expect(envOf().npm_config_registry).toBe('https://reg.example/');
  });
});
