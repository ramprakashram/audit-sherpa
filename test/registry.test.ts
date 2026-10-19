import { describe, expect, it } from 'vitest';
import { pickSafeVersion } from '../src/core/registry.js';

const versions = ['0.9.0', '1.0.0', '1.0.1', '1.2.0', '2.0.0-beta.1', '2.0.0', '2.1.0'];

describe('pickSafeVersion', () => {
  it('picks the lowest non-vulnerable version on the current major line', () => {
    expect(pickSafeVersion(versions, '<1.0.1', '1.0.0')).toEqual({ version: '1.0.1', isSemVerMajor: false });
  });

  it('flags a semver-major update when the whole major line is vulnerable', () => {
    expect(pickSafeVersion(versions, '<2.0.0', '1.0.0')).toEqual({ version: '2.0.0', isSemVerMajor: true });
  });

  it('skips prereleases and combined ranges', () => {
    expect(pickSafeVersion(versions, '<1.2.0 || >=2.0.0 <2.1.0', '1.0.0')).toEqual({ version: '1.2.0', isSemVerMajor: false });
  });

  it('treats 0.x minor bumps as breaking (caret semantics)', () => {
    expect(pickSafeVersion(['0.4.0', '0.6.0', '0.7.0'], '<0.7.0', '0.4.0')).toEqual({ version: '0.7.0', isSemVerMajor: true });
  });

  it('returns undefined when every version is vulnerable', () => {
    expect(pickSafeVersion(versions, '*', '1.0.0')).toBeUndefined();
  });
});
