// Drives real browsers with the scripts Stashd really uses: opens test tabs, reads them, closes them, and checks
// private windows stay out of it. Only runs when asked, on browsers that are already open:
//   STASHD_LIVE_BROWSERS=brave,edge,vivaldi npx vitest run tests/browsers-live.test.ts
// It only touches its own test tabs (example.com/stashd-live-…) and the private window it makes.

import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: {}, shell: {} }));
import { BROWSER_APPS, collectTabs, isRunning } from '../src/main/collectors/browsers';
import { run } from '../src/main/exec';
import { openItems } from '../src/main/open';
import { closeTabsScript } from '../src/main/tidy';
import type { BrowserName, Item } from '../src/shared/types';
import { BROWSERS, DEFAULT_SETTINGS } from '../src/shared/validate';

const names = (process.env.STASHD_LIVE_BROWSERS ?? '').split(',').filter(Boolean) as BrowserName[];
const stamp = Date.now().toString(36);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!names.length).each(names)('%s', (b) => {
  const id = BROWSER_APPS[b].bundleId;
  const url = (name: string) => `https://example.com/stashd-live-${b}-${stamp}-${name}`;
  const opts = { keepQueryStrings: false, excludedDomains: [] };
  const settings = { ...DEFAULT_SETTINGS, browsers: Object.fromEntries(BROWSERS.map((x) => [x, x === b])) as Record<BrowserName, boolean> };
  const item = (u: string): Item => ({ key: `tab:${u}`, kind: 'tab', label: u, detail: '', app: BROWSER_APPS[b].appName, url: u, browser: b });
  const mine = async () => (await collectTabs([b], opts)).tabs.filter((t) => t.url.includes(stamp));
  const script = (s: string) => run('osascript', ['-e', `tell application id "${id}"\n${s}\nend tell`], { timeoutMs: 30_000 });
  async function until<T>(get: () => Promise<T>, done: (v: T) => boolean): Promise<T> {
    let v = await get();
    for (let i = 0; i < 40 && !done(v); i++) {
      await pause(250);
      v = await get();
    }
    return v;
  }
  const close = async (urls: string[]) => Number((await run('osascript', ['-e', closeTabsScript(b), '--', ...urls], { timeoutMs: 30_000 })).stdout.trim());

  it('is running under its own app id', async () => {
    expect(await isRunning(b)).toBe(true);
    const r = await collectTabs([b], opts);
    expect(r.errors).toEqual([]);
  }, 90_000);

  it('reopens a folder\'s tabs together in a new window, and never twice', async () => {
    const urls = ['a', 'b', 'c'].map(url);
    const first = await openItems(urls.map(item), item(urls[2]).key, settings);
    expect(first).toMatchObject({ opened: 3, failed: [], missing: [] });
    const tabs = await until(mine, (t) => t.length === 3);
    expect(tabs.map((t) => t.url).sort()).toEqual(urls);
    expect(new Set(tabs.map((t) => t.window)).size).toBe(1);
    expect(tabs.every((t) => t.browser === b)).toBe(true);
    expect(tabs.filter((t) => t.active)).toHaveLength(1);
    const again = await openItems(urls.map(item), null, settings);
    expect(again).toMatchObject({ opened: 0, alreadyOpen: 3 });
  }, 90_000);

  it('opens a single tab by the app\'s name', async () => {
    await openItems([item(url('single'))], null, settings);
    const tabs = await until(mine, (t) => t.some((x) => x.url === url('single')));
    expect(tabs.map((t) => t.url)).toContain(url('single'));
  }, 60_000);

  it('never reads or closes a private window', async () => {
    const secret = url('private');
    const made = await script(`set w to id of (make new window with properties {mode:"incognito"})\nset URL of active tab of window id w to "${secret}"\nreturn w`);
    const win = `window id ${made.stdout.trim()}`;
    await pause(1000);
    expect((await mine()).map((t) => t.url)).not.toContain(secret);
    expect(await close([secret])).toBe(0);
    expect((await script(`URL of active tab of ${win}`)).stdout.trim()).toBe(secret);
    await script(`close ${win}`);
  }, 60_000);

  it('closes only the tabs asked for, then a whole window when all its tabs go', async () => {
    expect(await close([url('single')])).toBe(1);
    expect(await close([url('a')])).toBe(1);
    const rest = await until(mine, (t) => t.length === 2);
    expect(rest.map((t) => t.url).sort()).toEqual([url('b'), url('c')]);
    const windows = async () => Number((await script('count of windows')).stdout.trim());
    const before = await windows();
    expect(await close([url('b'), url('c')])).toBe(2);
    expect(await until(mine, (t) => t.length === 0)).toEqual([]);
    expect(await until(windows, (n) => n < before)).toBe(before - 1);
  }, 60_000);
});
