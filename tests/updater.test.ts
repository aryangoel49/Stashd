// Stashd keeping itself up to date (src/main/updater.ts): which release to take. The whole download,
// check and swap is tried on real signed builds by hand (see the commit), since it needs a signed app.

import { describe, expect, it } from 'vitest';
import { newer, pickAsset } from '../src/main/updater';

const sha = 'a'.repeat(64);
const release = (tag: string, assets: object[], extra: object = {}) => ({ tag_name: tag, assets, ...extra });
const zip = (name: string, url = `https://github.com/aryangoel49/Stashd/releases/download/x/${name}`) => ({ name, browser_download_url: url, digest: `sha256:${sha}`, size: 10 });

describe('the updater', () => {
  it('compares versions as numbers', () => {
    expect(newer('1.10.0', '1.9.2')).toBe(true);
    expect(newer('1.5.0', '1.5.0')).toBe(false);
    expect(newer('1.4.9', '1.5.0')).toBe(false);
    expect(newer('v2.0.0', '1.99.99')).toBe(true);
    expect(newer('banana', '1.0.0')).toBe(false);
  });

  it("takes this chip's zip, with its checksum", () => {
    const r = release('v1.6.0', [zip('Stashd.dmg'), zip('Stashd-darwin-x64-1.6.0.zip'), zip('Stashd-darwin-arm64-1.6.0.zip')]);
    expect(pickAsset(r, 'arm64')).toMatchObject({ version: '1.6.0', url: expect.stringContaining('arm64'), sha256: sha });
    expect(pickAsset(r, 'x64')?.url).toContain('x64');
  });

  it('skips drafts, pre-releases, files without a checksum and downloads from anywhere but GitHub', () => {
    const ok = [zip('Stashd-darwin-arm64-1.6.0.zip')];
    expect(pickAsset(release('v1.6.0', ok, { prerelease: true }), 'arm64')).toBeNull();
    expect(pickAsset(release('v1.6.0', ok, { draft: true }), 'arm64')).toBeNull();
    expect(pickAsset(release('v1.6.0', [{ ...ok[0], digest: undefined }]), 'arm64')).toBeNull();
    expect(pickAsset(release('v1.6.0', [zip('Stashd-darwin-arm64-1.6.0.zip', 'https://evil.example/Stashd.zip')]), 'arm64')).toBeNull();
    expect(pickAsset(release('v1.6.0', [zip('Stashd-darwin-arm64-1.6.0.zip', 'http://github.com/x.zip')]), 'arm64')).toBeNull();
    expect(pickAsset(release('v1.6.0', [zip('Stashd-darwin-arm64-1.5.0.zip')]), 'arm64')).toBeNull();
  });
});
