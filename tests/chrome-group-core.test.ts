// When Stashd asks Chrome to put a folder's tabs in its tab group: saving (not packing up), keeping a
// folder Stashd saved for you, and an Unpack that found tabs already open. Never when it packs up.

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capture, Item } from '../src/shared/types';

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() }, screen: { getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1440, height: 900 } }) } }));
// Chrome itself is stood in for: the real one is in open.ts, and the extension has its own tests.
const asked: { action: string; name: string; urls: string[]; create: boolean }[] = [];
vi.mock('../src/main/open', async (orig) => ({
  ...(await orig<typeof import('../src/main/open')>()),
  changeChromeGroup: vi.fn(async (action: string, name: string, urls: string[], create = false) => {
    asked.push({ action, name, urls, create });
  }),
}));
vi.mock('../src/main/exec', async (orig) => ({
  ...(await orig<typeof import('../src/main/exec')>()),
  run: vi.fn(async () => {
    throw new Error('not in tests');
  }),
}));

const { Core } = await import('../src/main/core');
const { SettingsStore } = await import('../src/main/settings');
const { JobStore } = await import('../src/main/store');

const tab = (url: string, label: string): Item => ({ key: `tab:${url}`, kind: 'tab', label, detail: '', app: 'Google Chrome', url, browser: 'chrome', window: 1 });
const cn = tab('https://www.cntower.ca/visit', 'CN Tower');
const hotel = tab('https://www.booking.com/city/ca/toronto.html', 'Toronto hotels');
const inSafari: Item = { ...tab('https://www.tripadvisor.ca/toronto', 'Things to do'), app: 'Safari', browser: 'safari' };

let dir: string;
let open: Item[];
const makeCore = () =>
  new Core(new SettingsStore(dir), new JobStore(path.join(dir, 'jobs')), { icons: async () => [] } as never, dir, ['Stashd'], async (): Promise<Capture> => ({
    at: new Date().toISOString(),
    appOrder: ['Google Chrome'],
    frontApp: 'Google Chrome',
    items: open,
    errors: [],
  }));

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'stashd-group-'));
  open = [cn, hotel, inSafari];
  asked.length = 0;
});
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 100));
  await rm(dir, { recursive: true, force: true });
});

/** Saves everything open as a new folder. `tidy`: Pack up (the tabs close) instead of just saving. */
async function save(core: InstanceType<typeof Core>, name: string, tidy: boolean) {
  core.beginSave();
  const p = await core.preview({ asNew: true });
  return core.commitSave({ jobId: null, name, note: '', keys: [...p.sure, ...p.likely, ...p.maybe].map((i) => i.key), tidy });
}

describe('asking Chrome for the folder’s tab group', () => {
  it('a save that leaves your tabs open puts them in the group, making it if there is none', async () => {
    const core = makeCore();
    await save(core, 'Toronto trip', false);
    await new Promise((r) => setTimeout(r, 50));
    expect(asked).toEqual([{ action: 'regroup', name: 'Toronto trip', urls: [cn.url, hotel.url], create: true }]);
  });

  it('Pack up does not: it takes the tabs out of the group and closes them', async () => {
    const core = makeCore();
    await save(core, 'Toronto trip', true);
    await new Promise((r) => setTimeout(r, 50));
    expect(asked).toEqual([]);
  });

  it('keeping a folder Stashd saved for you puts its tabs in a group', async () => {
    const core = makeCore();
    const r = await save(core, 'Toronto trip', false);
    const job = await core.store.get(r.jobId);
    job.forYou = true;
    await core.store.put(job);
    asked.length = 0;
    await core.keepForYou(r.jobId);
    await new Promise((r) => setTimeout(r, 50));
    expect(asked.map((a) => [a.action, a.name, a.create])).toEqual([['regroup', 'Toronto trip', true]]);
  });

  it('an automatic save never touches your tab groups', async () => {
    const core = makeCore();
    const r = await save(core, 'Toronto trip', false);
    asked.length = 0;
    await core.autoSave((await (core as unknown as { fakeCapture: () => Promise<Capture> }).fakeCapture()), [r.jobId]);
    expect(asked).toEqual([]);
  });
});
