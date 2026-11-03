// "You were working on this": only exact matches in a packed folder, never twice in a row,
// and never for what Stashd opened itself.

import { describe, expect, it, vi } from 'vitest';

let idle = 0;
let recent = false;
vi.mock('electron', () => ({ powerMonitor: { getSystemIdleTime: () => idle }, shell: {} }));
vi.mock('../src/main/open', () => ({ openedRecently: () => recent }));

import { Noticer, packedWorkFor } from '../src/main/noticer';
import { looseKey } from '../src/main/urls';
import type { Item, Job, SaveEntry } from '../src/shared/types';

const tab = (url: string): Item => ({ key: `tab:${url}`, kind: 'tab', label: url, detail: '', app: 'Google Chrome', url, browser: 'chrome' });
const job = (id: string, extra: Partial<Job> = {}): Job => ({ id, name: id, prefs: { hide: {}, add: {} }, ...extra }) as Job;
const entry = (items: Item[]): SaveEntry => ({ items }) as SaveEntry;

const flights = tab('https://www.google.com/travel/flights?q=Tokyo');
const ryokan = tab('https://www.booking.com/hotel/jp/sanga.html');
const rail = tab('https://www.japanrailpass.net/en/purchase');
const japan = { jobs: [job('japan')], latest: [entry([flights, ryokan, rail])] };

describe('packedWorkFor', () => {
  it('offers a packed folder when you open one of its tabs yourself', () => {
    const w = packedWorkFor(new Set([looseKey(ryokan)]), japan.jobs, japan.latest, { japan: { open: 1, total: 3 } }, new Map());
    expect(w).toMatchObject({ jobId: 'japan', more: 2 });
  });

  it('matches a tab that redirected slightly (http, www., trailing slash)', () => {
    const k = looseKey(tab('http://booking.com/hotel/jp/sanga.html/'));
    expect(packedWorkFor(new Set([k]), japan.jobs, japan.latest, { japan: { open: 1, total: 3 } }, new Map())?.jobId).toBe('japan');
  });

  it('stays quiet for a folder that is already open', () => {
    expect(packedWorkFor(new Set([looseKey(ryokan)]), japan.jobs, japan.latest, { japan: { open: 3, total: 3 } }, new Map())).toBeNull();
  });

  it('stays quiet for similar pages, finished folders, and folders asked about recently', () => {
    const other = looseKey(tab('https://www.booking.com/hotel/jp/another.html'));
    expect(packedWorkFor(new Set([other]), japan.jobs, japan.latest, { japan: { open: 0, total: 3 } }, new Map())).toBeNull();
    expect(packedWorkFor(new Set([looseKey(ryokan)]), [job('japan', { done: true })], japan.latest, { japan: { open: 1, total: 3 } }, new Map())).toBeNull();
    expect(packedWorkFor(new Set([looseKey(ryokan)]), japan.jobs, japan.latest, { japan: { open: 1, total: 3 } }, new Map([['japan', Date.now()]]))).toBeNull();
  });

  it('stays quiet when there is nothing more to bring back', () => {
    const one = [entry([ryokan])];
    expect(packedWorkFor(new Set([looseKey(ryokan)]), japan.jobs, one, { japan: { open: 1, total: 1 } }, new Map())).toBeNull();
  });
});

describe('Noticer', () => {
  const look = (open: Item[], openCount: number) => async () => ({
    open: new Set(open.map(looseKey)),
    state: { japan: { open: openCount, total: 3 } },
    ...japan,
  });

  it('only remembers the first look, then offers once for something new', async () => {
    const offer = vi.fn();
    let current = look([], 0);
    const n = new Noticer(() => current(), offer, () => false);
    await n.tick();
    expect(offer).not.toHaveBeenCalled();
    current = look([ryokan], 1);
    await n.tick();
    expect(offer).toHaveBeenCalledTimes(1);
    // Close it and open it again: not asked twice.
    current = look([], 0);
    await n.tick();
    current = look([ryokan], 1);
    await n.tick();
    expect(offer).toHaveBeenCalledTimes(1);
  });

  it('never offers what Stashd just opened (Unpack, Undo), or while the save box is up', async () => {
    const offer = vi.fn();
    let current = look([], 0);
    let saving = false;
    const n = new Noticer(() => current(), offer, () => saving);
    await n.tick();
    recent = true;
    current = look([ryokan], 1);
    await n.tick();
    recent = false;
    await n.tick();
    current = look([ryokan, flights], 2);
    saving = true;
    await n.tick();
    expect(offer).not.toHaveBeenCalled();
  });

  it("doesn't look while you're away", async () => {
    const lookFn = vi.fn(look([], 0));
    idle = 600;
    await new Noticer(lookFn, vi.fn(), () => false).tick();
    idle = 0;
    expect(lookFn).not.toHaveBeenCalled();
  });
});
