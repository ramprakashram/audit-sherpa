import { afterEach, describe, expect, it, vi } from 'vitest';

const runNpm = vi.fn();
let override: string | undefined;
vi.mock('../src/core/npm.js', () => ({ runNpm, getNpmRegistryOverride: () => override }));

const { createNpmVersionFetcher, getRegistry } = await import('../src/core/registry.js');
const { normalizeRegistryUrl } = await vi.importActual<typeof import('../src/core/npm.js')>('../src/core/npm.js');

afterEach(() => {
  vi.unstubAllGlobals();
  runNpm.mockReset();
  override = undefined;
});

describe('registry override', () => {
  it('normalizes and validates --registry urls', () => {
    expect(normalizeRegistryUrl('https://reg.example/npm')).toBe('https://reg.example/npm/');
    expect(normalizeRegistryUrl(' http://localhost:4873/ ')).toBe('http://localhost:4873/');
    expect(() => normalizeRegistryUrl('notaurl')).toThrow();
    expect(() => normalizeRegistryUrl('ftp://reg.example')).toThrow();
  });

  it('getRegistry returns the override without spawning npm', async () => {
    override = 'https://custom.example/';
    expect(await getRegistry('/override')).toBe('https://custom.example/');
    expect(runNpm).not.toHaveBeenCalled();
  });
});

describe('createNpmVersionFetcher', () => {
  it('reads versions from the registry abbreviated metadata over HTTP', async () => {
    runNpm.mockResolvedValue({ stdout: 'https://reg.example/\n', exitCode: 0 });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ versions: { '1.0.0': {}, '1.0.1': {} } })));
    vi.stubGlobal('fetch', fetchMock);

    expect(await createNpmVersionFetcher('/http')('@scope/pkg')).toEqual(['1.0.0', '1.0.1']);
    expect(fetchMock).toHaveBeenCalledWith('https://reg.example/@scope%2fpkg', expect.anything());
    // only `npm config get registry` was spawned, no `npm view`
    expect(runNpm).toHaveBeenCalledTimes(1);
  });

  it('falls back to npm view when the HTTP request fails', async () => {
    runNpm.mockImplementation(async (args: string[]) =>
      args[0] === 'view' ? { stdout: '["2.0.0"]', exitCode: 0 } : { stdout: 'https://private.example', exitCode: 0 },
    );
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })));

    expect(await createNpmVersionFetcher('/fallback')('private-pkg')).toEqual(['2.0.0']);
    expect(runNpm).toHaveBeenCalledWith(['view', 'private-pkg', 'versions', '--json'], expect.anything());
  });
});
