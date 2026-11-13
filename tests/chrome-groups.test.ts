// Chrome tab groups go through Stashd's extension.

import { describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ shell: {}, nativeImage: {}, app: { isPackaged: true, getPath: () => fake.userData } }));
// Nothing here runs AppleScript: every command is recorded, and Chrome counts as running.
const ran: { cmd: string; args: string[] }[] = [];
// Set for the one test that pretends Stashd's extension isn't installed.
let missing = false;
vi.mock('../src/main/exec', async (orig) => ({
  ...(await orig<typeof import('../src/main/exec')>()),
  run: vi.fn(async (cmd: string, args: string[]) => {
    ran.push({ cmd, args });
    const running = args.some((a) => a.includes('is running'));
    return { stdout: running ? 'true' : missing ? 'missing' : 'ok', stderr: '', code: 0 };
  }),
}));
import type { Item } from '../src/shared/types';
import { changeChromeGroup, chromeTabUrls, CHROME_HELPER_ID, CHROME_HELPER_VERSION, groupPageUrl, newWindowScript } from '../src/main/open';

describe('Chrome tab groups', () => {
  it('passes the folder name and tabs to the extension page', () => {
    const u = groupPageUrl('Toronto trip', ['https://www.cntower.ca/plan-your-visit', 'https://www.booking.com/city/ca/toronto.html']);
    expect(u.startsWith(`chrome-extension://${CHROME_HELPER_ID}/open.html#`)).toBe(true);
    expect(JSON.parse(decodeURIComponent(u.split('#')[1]))).toEqual({ name: 'Toronto trip', urls: ['https://www.cntower.ca/plan-your-visit', 'https://www.booking.com/city/ca/toronto.html'], want: CHROME_HELPER_VERSION });
  });

  it('tells the extension which version Stashd ships, so an older one can load the new copy', async () => {
    const { readFileSync } = await import('node:fs');
    expect(JSON.parse(readFileSync('assets/chrome-extension/manifest.json', 'utf8')).version).toBe(CHROME_HELPER_VERSION);
    const req = JSON.parse(decodeURIComponent(groupPageUrl('Toronto trip', ['https://a.example.com/x']).split('#')[1]));
    expect(req.want).toBe(CHROME_HELPER_VERSION);
  });

  it("the extension's id matches its key", async () => {
    const { createHash } = await import('node:crypto');
    const { readFileSync } = await import('node:fs');
    const key = JSON.parse(readFileSync('assets/chrome-extension/manifest.json', 'utf8')).key;
    const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
    expect([...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('')).toBe(CHROME_HELPER_ID);
  });
});

describe("a folder's tabs that are already open", () => {
  const tab = (url: string, browser = 'chrome'): Item => ({ key: `tab:${url}`, kind: 'tab', label: '', detail: '', app: 'Google Chrome', url, browser } as Item);

  it('only Chrome web pages can go in a tab group', () => {
    const items = [tab('https://a.example.com/x'), tab('https://b.example.com/y', 'safari'), tab('file:///Users/me/a.pdf'), { ...tab('https://c.example.com/z'), kind: 'doc' } as Item];
    expect(chromeTabUrls(items)).toEqual(['https://a.example.com/x']);
  });

  it('asks the extension to put them in the folder\'s group, making it when the window has none', async () => {
    ran.length = 0;
    missing = false;
    await changeChromeGroup('regroup', 'Toronto trip', ['https://www.cntower.ca/visit', 'file:///tmp/x.pdf'], true);
    const page = ran.at(-1)!.args.find((a) => a.startsWith('chrome-extension://'))!;
    expect(JSON.parse(decodeURIComponent(page.split('#')[1]))).toEqual({
      action: 'regroup',
      name: 'Toronto trip',
      urls: ['https://www.cntower.ca/visit'],
      create: true,
      want: CHROME_HELPER_VERSION,
    });
  });

  it("without Stashd's extension, it stops trying for a while instead of flashing a tab in Chrome", async () => {
    missing = true;
    ran.length = 0;
    await changeChromeGroup('regroup', 'Toronto trip', ['https://www.cntower.ca/visit'], true);
    const tried = ran.length;
    await changeChromeGroup('regroup', 'Toronto trip', ['https://www.cntower.ca/visit'], true);
    expect(ran.length).toBe(tried);
    missing = false;
  });

  it("an older extension sees the regroup it already knows: Undo's never says create, so it never makes a group", () => {
    const req = JSON.parse(decodeURIComponent(groupPageUrl('Toronto trip', ['https://www.cntower.ca/visit'], 'regroup').split('#')[1]));
    expect(req).toEqual({ action: 'regroup', name: 'Toronto trip', urls: ['https://www.cntower.ca/visit'], want: CHROME_HELPER_VERSION });
  });
});

describe('opening a folder\'s tabs together', () => {
  it('uses a new window in Brave, Edge and Vivaldi, the way it does in Chrome', () => {
    const ids = { chrome: 'com.google.Chrome', brave: 'com.brave.Browser', edge: 'com.microsoft.edgemac', vivaldi: 'com.vivaldi.Vivaldi' } as const;
    for (const [b, id] of Object.entries(ids)) {
      const s = newWindowScript(b as keyof typeof ids)!;
      expect(s).toContain(`tell application id "${id}"`);
      expect(s).toContain('set wwiWin to make new window');
    }
    expect(newWindowScript('arc')).toBeNull();
  });

  it('uses the window you have open when there is one, and only then makes a new one', () => {
    for (const b of ['chrome', 'safari'] as const) {
      const s = newWindowScript(b)!;
      expect(s).toContain('set wwiWin to window id (wwiReuse as integer)');
      expect(s.indexOf('window id (wwiReuse')).toBeLessThan(s.indexOf('if wwiWin is missing value then'));
    }
  });
});

const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
const osMod = await import('node:os');
const { join } = await import('node:path');
const { chromeHelperNeedsRestart } = await import('../src/main/chromehelper');

describe('a Chrome that still has an older copy of the extension', () => {
  const withChromeJson = async (body: string | null) => {
    fake.userData = await mkdtemp(join(osMod.tmpdir(), 'stashd-helper-'));
    if (body !== null) await writeFile(join(fake.userData, 'chrome.json'), body);
    try {
      return await chromeHelperNeedsRestart();
    } finally {
      await rm(fake.userData, { recursive: true, force: true });
    }
  };

  it('says so when the extension has never said which version it is (before 1.8)', async () => {
    expect(await withChromeJson('{"videos":[],"groups":[],"at":1}')).toBe(true);
  });

  it('says nothing once Chrome has one that loads its own updates, or when the extension was never added', async () => {
    expect(await withChromeJson('{"videos":[],"groups":[],"at":1,"v":"1.8"}')).toBe(false);
    expect(await withChromeJson(null)).toBe(false);
  });
});
