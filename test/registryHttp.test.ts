import { afterEach, describe, expect, it, vi } from 'vitest';

const runNpm = vi.fn();
vi.mock('../src/core/npm.js', () => ({ runNpm }));

const { createNpmVersionFetcher } = await import('../src/core/registry.js');

afterEach(() => {
  vi.unstubAllGlobals();
  runNpm.mockReset();
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
