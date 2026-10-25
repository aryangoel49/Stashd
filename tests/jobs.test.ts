import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classify, learn, learnedLifestyleApps, recordAppUnticks, suggestName, words } from '../src/main/jobs/match';
import { entryIdFor, JobStore, jobIdFor } from '../src/main/store';
import type { Item, Job, SaveEntry } from '../src/shared/types';
import { DEFAULT_SETTINGS, entryId as checkEntryId, jobId as checkJobId } from '../src/shared/validate';

const tab = (url: string, title: string, active = false): Item => ({
  key: `tab:${url}`, kind: 'tab', label: title, detail: '', app: 'Google Chrome', url, browser: 'chrome', window: 1, active,
});
const doc = (p: string, app = 'Microsoft Word'): Item => ({ key: `doc:${p}`, kind: 'doc', label: path.basename(p), detail: '', app, path: p });
const appItem = (name: string): Item => ({ key: `app:${name}`, kind: 'app', label: name, detail: 'App', app: name });

const essay = doc('/Users/a/Documents/School/Climate essay.docx');
const jstor = tab('https://www.jstor.org/stable/1', 'Sea level rise in coastal cities');
const gmail = tab('https://mail.google.com/mail/u/0', 'Inbox (3)');
const spotify = appItem('Spotify');
const reddit = tab('https://www.reddit.com/r/aww', 'Cute dogs');

function job(over: Partial<Job> = {}): Job {
  return { id: 'climate-essay-abc123', name: 'Climate essay', createdAt: '', updatedAt: '', done: false, prefs: { hide: {}, add: {} }, ...over };
}

describe('classify', () => {
  it('ticks everything for a new job, but hides everyday apps and sites', () => {
    const r = classify({ items: [essay, jstor, gmail, spotify, reddit], job: null, previous: [], name: '', settings: DEFAULT_SETTINGS });
    expect(r.sure.map((i) => i.key)).toEqual([essay.key, jstor.key, reddit.key]);
    expect(r.hidden.map((i) => i.key)).toEqual([gmail.key, spotify.key]);
    expect(r.maybe).toEqual([]);
  });

  it('when updating a job: same items, similar tabs on the same site, same folder and name matches are sure; others are maybe', () => {
    const jstor2 = tab('https://www.jstor.org/stable/2', 'Rising sea level and storms');
    const outline = doc('/Users/a/Documents/School/Outline.docx');
    const notes = tab('https://docs.google.com/document/d/x', 'Climate essay sources - Google Docs');
    const r = classify({
      items: [essay, jstor2, outline, notes, reddit],
      job: job(),
      previous: [essay, jstor],
      name: 'Climate essay',
      settings: DEFAULT_SETTINGS,
    });
    expect(r.sure.map((i) => i.key)).toEqual([essay.key, jstor2.key, outline.key, notes.key]);
    expect(r.maybe.map((i) => i.key)).toEqual([reddit.key]);
  });

  it('hides items unticked twice and makes items added twice sure', () => {
    const j = job({ prefs: { hide: { [reddit.key]: 2 }, add: { [tab('https://youtube.com/x', 'APA').key]: 2 } } });
    const yt = tab('https://youtube.com/x', 'APA');
    const r = classify({ items: [reddit, yt], job: j, previous: [essay], name: 'Climate essay', settings: DEFAULT_SETTINGS });
    expect(r.hidden).toEqual([reddit]);
    expect(r.sure).toEqual([yt]);
  });

  it('highlights things opened since the job was unpacked, and always includes new unsaved documents', () => {
    const docN: Item = { key: 'untitled:Microsoft Word:Document3', kind: 'doc', label: 'Document3', detail: '', app: 'Microsoft Word', untitled: true };
    const newTab = tab('https://www.bbc.com/news/1', 'Floods in Jakarta');
    const r = classify({
      items: [essay, newTab, reddit, docN],
      job: job(),
      previous: [essay],
      name: 'Climate essay',
      settings: DEFAULT_SETTINGS,
      baseline: new Set([essay.key, reddit.key]),
    });
    expect(r.sure.map((i) => i.key)).toEqual([essay.key, docN.key]);
    expect(r.likely.map((i) => i.key)).toEqual([newTab.key]);
    expect(r.maybe.map((i) => i.key)).toEqual([reddit.key]);
  });

  it('treats learned everyday apps like Spotify', () => {
    const notion = appItem('Notion');
    const r = classify({ items: [notion], job: null, previous: [], name: '', settings: DEFAULT_SETTINGS, learnedLifestyleApps: ['Notion'] });
    expect(r.hidden).toEqual([notion]);
  });
});

describe('learn', () => {
  it('counts unticks in a row and resets when ticked', () => {
    const offered = { sure: [essay, reddit], likely: [], maybe: [jstor], hidden: [], why: {} };
    let prefs = learn({ hide: {}, add: {} }, offered, [essay.key, jstor.key]);
    expect(prefs.hide[reddit.key]).toBe(1);
    expect(prefs.add[jstor.key]).toBe(1);
    prefs = learn(prefs, offered, [essay.key, reddit.key, jstor.key]);
    expect(prefs.hide[reddit.key]).toBeUndefined();
    expect(prefs.add[jstor.key]).toBe(2);
  });

  it('learns everyday apps after they are left out of 3 different jobs', () => {
    const notion = appItem('Notion');
    let u: Record<string, string[]> = {};
    for (const j of ['a-1', 'b-1', 'b-1', 'c-1']) u = recordAppUnticks(u, j, [notion], []);
    expect(learnedLifestyleApps(u)).toEqual(['Notion']);
    expect(learnedLifestyleApps(recordAppUnticks({}, 'a-1', [notion], []))).toEqual([]);
  });
});

describe('suggestName', () => {
  it('uses the front document without its extension', () => {
    expect(suggestName([jstor, essay], essay.key)).toBe('Climate essay');
  });
  it('cleans up tab titles', () => {
    const t = tab('https://docs.google.com/d', 'Trip budget - Google Sheets');
    expect(suggestName([t], t.key)).toBe('Trip budget');
    const inbox = tab('https://x.com', '(3) Toronto flights | Expedia');
    expect(suggestName([inbox], inbox.key)).toBe('Toronto flights');
  });
  it('names the job after the topic everything shares', () => {
    const items = [
      tab('https://www.google.com/search?q=ai', 'ai augmentation - Google Search'),
      tab('https://www.nvidia.com/x', 'Blueprint for AI Success eBook | Download & Build | NVIDIA'),
      tab('https://www.microsoft.com/y', 'AI Augmentation: The Key to Uplifting Employees | Microsoft'),
      { key: 'untitled:Microsoft Word:Document2', kind: 'doc' as const, label: 'Document2', detail: '', app: 'Microsoft Word', untitled: true },
    ];
    expect(suggestName(items, items[1].key)).toBe('AI Augmentation');
    const trip = [
      tab('https://www.expedia.ca/a', 'Cheap flights to Toronto | Expedia'),
      tab('https://www.airbnb.ca/b', 'Toronto stays near downtown · Airbnb'),
      tab('https://www.google.com/c', 'things to do in toronto - Google Search'),
    ];
    expect(suggestName(trip, trip[0].key)).toBe('Toronto');
    const soccer = [
      tab('https://streamking.cc/', 'StreamKing - Free NBA, NFL, NHL, MLB, Soccer Streams'),
      tab('https://totalsportek.pro/x', 'Watch Real Madrid at Barcelona Live Stream | TotalSportek'),
      tab('https://streameast.zip/', 'StreamEast.zip'),
      tab('https://soccerstreams.net/', 'Soccer Streams | Soccer Live Streams Reddit'),
    ];
    expect(suggestName(soccer, soccer[0].key)).toBe('Soccer Streams');
    const sea = [
      tab('https://www.jstor.org/stable/1', 'Sea level rise in coastal cities | JSTOR'),
      tab('https://scholar.google.com/x', 'Coastal flooding projections 2050 - Google Scholar'),
      tab('https://www.youtube.com/watch?v=abc', 'How sea levels are rising - YouTube'),
    ];
    expect(suggestName(sea, sea[0].key)).toBe('Sea level rise');
  });

  it('falls back to a document name when there is no clear shared topic', () => {
    const reddit = tab('https://www.reddit.com/r/aww', 'Cute dogs : aww');
    expect(suggestName([reddit, essay, jstor], jstor.key)).toBe('Climate essay');
  });

  it('prefers a saved document over the tab you were on, and shortens long tab titles', () => {
    const reddit = tab('https://www.reddit.com/r/x', 'What exactly is a AI Researcher, are they just Data Scientists? : r/learnprogramming');
    expect(suggestName([reddit, essay], reddit.key)).toBe('Climate essay');
    expect(suggestName([reddit], reddit.key)).toBe('AI Researcher');
    const long = tab('https://x.io', 'Artificial Intelligence (AI) | Latest news and analysis | The Economist');
    expect(suggestName([long], long.key)).toBe('Artificial Intelligence (AI)');
  });

  it('falls back for untitled things', () => {
    const u: Item = { key: 'untitled:Microsoft Word:Document1', kind: 'doc', label: 'Document1', detail: '', app: 'Microsoft Word', untitled: true };
    expect(suggestName([u], u.key)).toBe('New folder');
    expect(suggestName([], null)).toBe('New folder');
  });
});

describe('words', () => {
  it('finds meaningful words', () => {
    expect([...words('The Climate Essay.docx')]).toEqual(['climate', 'essay']);
  });
});

describe('ids', () => {
  it('job ids are safe and unique per seed', () => {
    const id = jobIdFor('Climate essay!', 'x');
    expect(id).toMatch(/^climate-essay-[0-9a-f]{6}$/);
    expect(checkJobId(id)).toBe(id);
    expect(jobIdFor('Climate essay!', 'y')).not.toBe(id);
  });
  it('entry ids validate', () => {
    expect(checkEntryId(entryIdFor(new Date('2026-10-25T10:00:00.000Z')))).toBe('2026-10-25T10-00-00-000Z');
    expect(() => checkEntryId('../../etc')).toThrow();
  });
});

describe('JobStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'wwi-jobs-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const entry = (jobId: string, id: string, savedAt: string): SaveEntry => ({
    version: 2, id, jobId, savedAt, note: '', items: [essay], frontKey: essay.key, appOrder: [], tidied: false, errors: [],
  });

  it('creates jobs, saves history newest first, and prunes old saves', async () => {
    const store = new JobStore(dir);
    const j = await store.create('Climate essay', new Date('2026-10-20T10:00:00Z'));
    const j2 = await store.create('Climate essay', new Date('2026-10-20T10:00:00Z'));
    expect(j2.id).not.toBe(j.id);
    for (let i = 0; i < 5; i++) {
      const d = new Date(Date.UTC(2026, 9, 21, 10, i));
      await store.saveEntry(entry(j.id, await store.freeEntryId(j.id, d), d.toISOString()));
    }
    expect((await store.latest(j.id))?.savedAt).toBe('2026-10-21T10:04:00.000Z');
    await store.prune(j.id, 3);
    expect(await store.entryIds(j.id)).toHaveLength(3);
    expect((await store.list()).map((x) => x.id).sort()).toEqual([j.id, j2.id].sort());
    expect((await readdir(path.join(dir, j.id, 'history'))).every((f) => f.endsWith('.json'))).toBe(true);
    await store.delete(j.id);
    expect(await store.exists(j.id)).toBe(false);
  });

  it('refuses unsafe ids', async () => {
    const store = new JobStore(dir);
    await expect(store.get('../outside')).rejects.toThrow();
  });
});
