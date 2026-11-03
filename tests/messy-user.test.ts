// Things a messy, impatient real user does, run against the real logic.
// Tests marked it.fails are known bugs: they pass while the bug is there. When a bug is fixed,
// that test starts failing, so change it.fails to it. (The first round of six bugs is fixed.)

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capture, Item } from '../src/shared/types';

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  screen: { getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1440, height: 900 } }) },
}));

// Window stand-ins for the pack-up flow: they record what would be shown instead of opening anything.
const shown: string[] = [];
const fakeWin = () => ({
  webContents: { send: (ch: string) => shown.push(ch) },
  setBounds: () => undefined,
  showInactive: () => undefined,
  hide: () => undefined,
  close: () => undefined,
  isVisible: () => true,
});
vi.mock('../src/main/windows', () => ({
  prepareWindow: () => fakeWin(),
  showWindow: (route: string) => {
    shown.push(`show:${route}`);
    return fakeWin();
  },
  getWindow: () => fakeWin(),
}));

// Nothing here may run AppleScript or open apps: every command "fails" and is recorded.
const ran: string[][] = [];
vi.mock('../src/main/exec', async (orig) => ({
  ...(await orig<typeof import('../src/main/exec')>()),
  run: vi.fn(async (cmd: string, args: string[]) => {
    ran.push([cmd, ...args]);
    throw new Error('not in tests');
  }),
}));

const { Core } = await import('../src/main/core');
const { SettingsStore } = await import('../src/main/settings');
const { JobStore } = await import('../src/main/store');
const { TidyFlow } = await import('../src/main/tidyflow');
const { assemble } = await import('../src/main/capture');
const { cleanTabUrl, isExcluded } = await import('../src/main/urls');
const { words } = await import('../src/main/jobs/match');
const v = await import('../src/shared/validate');
const { DEFAULT_SETTINGS } = v;
const exec = await import('../src/main/exec');
const { collectTabs } = await import('../src/main/collectors/browsers');

const tab = (n: number, title = `Page ${n}`, window = 1): Item => ({
  key: `tab:https://example.com/p${n}`,
  kind: 'tab',
  label: title,
  detail: 'example.com',
  app: 'Google Chrome',
  url: `https://example.com/p${n}`,
  browser: 'chrome',
  window,
});

let dir: string;
let open: Item[];
function makeCore() {
  const capture = async (): Promise<Capture> => ({ at: new Date().toISOString(), appOrder: ['Google Chrome'], frontApp: 'Google Chrome', items: open, errors: [] });
  return new Core(new SettingsStore(dir), new JobStore(path.join(dir, 'jobs')), { icons: async () => [] } as never, dir, ['Stashd'], capture);
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'stashd-messy-'));
  open = [];
  shown.length = 0;
  ran.length = 0;
});
afterEach(async () => {
  // Let background brief writing finish before the folder goes.
  await new Promise((r) => setTimeout(r, 100));
  await rm(dir, { recursive: true, force: true });
});

describe('stashing with nothing useful open', () => {
  it('offers nothing to save, and does not crash', async () => {
    const core = makeCore();
    core.beginSave();
    const p = await core.preview();
    expect(p.sure).toEqual([]);
    expect(p.suggestedName).toBe('New folder');
  });
});

describe('very long tab addresses', () => {
  // A long Google search in Japanese: each character becomes 9 characters in the address.
  const longSearch = `https://www.google.com/search?q=${encodeURIComponent('東京で週末に泊まれる安いホテルとおすすめの観光地'.repeat(25))}`;

  it('the address is kept when stashing', () => {
    const url = cleanTabUrl(longSearch, DEFAULT_SETTINGS);
    expect(url).not.toBeNull();
    expect(url!.length).toBeGreaterThan(4200);
  });

  it('one long tab address does not stop the whole save', () => {
    const key = `tab:${cleanTabUrl(longSearch, DEFAULT_SETTINGS)}`;
    expect(() => v.saveRequest({ jobId: null, name: 'Tokyo trip', note: '', keys: ['tab:https://example.com', key], tidy: false })).not.toThrow();
  });
});

describe('sites that are left out for privacy', () => {
  it('leaves out real sign-in and bank pages', () => {
    expect(isExcluded(new URL('https://accounts.google.com/signin'), DEFAULT_SETTINGS.excludedDomains)).toBe(true);
    expect(isExcluded(new URL('https://www.chase.com/bank/login'), DEFAULT_SETTINGS.excludedDomains)).toBe(true);
  });

  it.each([
    'https://data.worldbank.org/indicator/NY.GDP.MKTP.CD',
    'https://www.goodreads.com/author/show/1077326.J_K_Rowling',
    'https://en.wikipedia.org/wiki/Authoritarianism',
    'https://en.wikipedia.org/wiki/Bankruptcy',
    'https://www.riverbankcollege.edu/courses',
  ])('keeps the ordinary page %s', (url) => {
    expect(isExcluded(new URL(url), DEFAULT_SETTINGS.excludedDomains)).toBe(false);
  });
});

describe('lots of tabs', () => {
  it('80 tabs across 6 windows are all offered', async () => {
    open = Array.from({ length: 80 }, (_, i) => tab(i, `Climate essay source ${i}`, (i % 6) + 1));
    const core = makeCore();
    core.beginSave();
    const p = await core.preview();
    expect(p.sure.length + p.likely.length + p.maybe.length + p.hiddenCount).toBe(80);
  });

  it('says so when some tabs were left out', async () => {
    const US = '\x1f';
    const RS = '\x1e';
    const out = Array.from({ length: 250 }, (_, i) => `1${US}false${US}https://example.com/p${i}${US}Page ${i}${RS}`).join('');
    vi.mocked(exec.run).mockResolvedValueOnce({ stdout: out, stderr: '' } as never);
    const r = await collectTabs(['chrome'], DEFAULT_SETTINGS, new Set(['com.google.Chrome']));
    expect(r.tabs.length === 250 || r.errors.length > 0).toBe(true);
  });

  it('says so when more than 300 things were open', () => {
    const tabs = Array.from({ length: 350 }, (_, i) => ({ browser: 'chrome' as const, window: 1, title: `t${i}`, url: `https://example.com/${i}`, active: false }));
    const r = assemble({ front: null, frontBundleId: null, apps: [], order: [] }, tabs, [], []);
    expect(r.items.length).toBe(350);
  });
});

describe('names in other languages', () => {
  it('English words are matched', () => {
    expect(words('Climate essay draft')).toContain('climate');
  });

  it.each([
    ['Voyage à Montréal', 'montréal'],
    ['Übungsblatt Mathematik', 'übungsblatt'],
    ['Résumé for Café job', 'résumé'],
    ['東京旅行の計画', '東京旅行の計画'],
  ])('keeps the words in "%s"', (text, word) => {
    expect(words(text)).toContain(word);
  });
});

describe('renaming', () => {
  it('rejects an empty or spaces-only name', () => {
    expect(() => v.jobName('')).toThrow();
    expect(() => v.jobName('    ')).toThrow();
  });

  it('accepts emoji and duplicate names as separate folders', async () => {
    const store = new JobStore(path.join(dir, 'jobs'));
    const a = await store.create('🎓', new Date('2026-10-01T10:00:00Z'));
    const b = await store.create('🎓', new Date('2026-10-01T10:00:00Z'));
    expect(a.id).not.toBe(b.id);
    expect((await store.list()).length).toBe(2);
  });
});

describe('going offline with Claude connected', () => {
  it('still writes a basic brief and says why', async () => {
    open = [tab(1, 'Climate essay notes')];
    const core = makeCore();
    core.writers = [{ name: 'claude', write: async () => { throw new Error('Connection error.'); }, suggestName: async () => { throw new Error('Connection error.'); } }];
    core.beginSave();
    await core.preview();
    const { jobId, entryId } = await core.commitSave({ jobId: null, name: 'Climate essay', note: 'para 3', keys: [open[0].key], tidy: false });
    const entry = await vi.waitFor(async () => {
      const e = await core.store.entry(jobId, entryId);
      expect(e.brief).toBeDefined();
      return e;
    });
    expect(entry.brief?.source).toBe('basic');
    expect(entry.brief?.fallbackReason).toContain('Connection error');
    expect(await core.aiName([open[0].key])).toBeNull();
  });
});

describe('Pack up with an unsaved document', () => {
  const untitled: Item = { key: 'untitled:Microsoft Word:Document1', kind: 'doc', label: 'Document1', detail: '', app: 'Microsoft Word', untitled: true };
  // A file in an app Stashd can't close, so nothing real is ever touched.
  const file: Item = { key: 'doc:/nowhere/notes.txt', kind: 'doc', label: 'notes.txt', detail: '', app: 'Stashd Test App', path: '/nowhere/notes.txt' };

  async function packed(core: InstanceType<typeof Core>, items: Item[], name: string) {
    open = items;
    core.beginSave();
    await core.preview({ asNew: true });
    return core.commitSave({ jobId: null, name, note: '', keys: items.map((i) => i.key), tidy: true });
  }

  it('Skip in the naming box carries on packing', async () => {
    const core = makeCore();
    const tidy = new TidyFlow(core, () => ({ x: 1000, y: 0, width: 24, height: 24 }));
    const a = await packed(core, [untitled, file], 'Essay');
    const run = tidy.run(a.jobId, a.entryId);
    await vi.waitFor(() => expect(shown).toContain('show:naming'));
    tidy.finishNaming([null]);
    tidy.finishOverlay();
    await run;
    expect(shown).toContain('toast:show');
  });

  // Closing the naming box with ⌘W (or Window → Close) instead of Skip must not leave Pack up stuck.
  it('a later Pack up still works after the naming box was closed without answering', async () => {
    const core = makeCore();
    const tidy = new TidyFlow(core, () => ({ x: 1000, y: 0, width: 24, height: 24 }));
    const a = await packed(core, [untitled, file], 'Essay');
    void tidy.run(a.jobId, a.entryId);
    await vi.waitFor(() => expect(shown).toContain('show:naming'));
    // (the user closes the naming window here: nothing reaches TidyFlow)
    shown.length = 0;
    const b = await packed(core, [{ ...file, key: 'doc:/nowhere/other.txt', path: '/nowhere/other.txt', label: 'other.txt' }], 'Trip');
    void tidy.run(b.jobId, b.entryId);
    await vi.waitFor(() => expect(shown).toContain('toast:show'), { timeout: 3000 });
  });
});

describe('Pack up on a folder that holds only an app', () => {
  it('packs that folder (not a new one) and includes the app', async () => {
    const terminal: Item = { key: 'app:Terminal', kind: 'app', label: 'Terminal', detail: 'App', app: 'Terminal' };
    open = [terminal];
    const core = makeCore();
    core.beginSave();
    await core.preview({ asNew: true });
    const first = await core.commitSave({ jobId: null, name: 'Server work', note: '', keys: [terminal.key], tidy: false });
    // Later, with nothing marking it current, Pack up is pressed on that folder.
    await core.setDone(first.jobId, false);
    (core as unknown as { state: { currentJobId: string | null } }).state.currentJobId = null;
    core.beginSave(undefined, first.jobId);
    const p = await core.preview();
    expect(p.jobId).toBe(first.jobId);
    expect(p.sure.map((i) => i.key)).toContain(terminal.key);
  });
});

describe('second round (known bugs)', () => {
  // KNOWN BUG: a local PDF opened in Chrome (file://) is never saved.
  it('keeps a PDF from the Mac opened in Chrome', () => {
    expect(cleanTabUrl('file:///Users/me/Downloads/Lecture%205.pdf', DEFAULT_SETTINGS)).not.toBeNull();
  });

  it('a second new folder with the same name gets told apart', async () => {
    open = [tab(1, 'Essay outline')];
    const core = makeCore();
    for (let i = 0; i < 2; i++) {
      core.beginSave();
      await core.preview({ asNew: true });
      await core.commitSave({ jobId: null, name: 'Essay', note: '', keys: [open[0].key], tidy: false });
    }
    const names = (await core.listJobs()).map((j) => j.name);
    expect(new Set(names).size).toBe(2);
  });
});

describe('closing a tab by accident after Unpack', () => {
  it('Pack up keeps the closed tab in the folder', async () => {
    const a = tab(1, 'Climate essay notes');
    const b = tab(2, 'Climate essay sources');
    open = [a, b];
    const core = makeCore();
    core.beginSave();
    await core.preview({ asNew: true });
    const first = await core.commitSave({ jobId: null, name: 'Climate essay', note: '', keys: [a.key, b.key], tidy: false });
    // Tab b is closed by mistake; then Pack up is pressed on the folder (auto-commit uses sure + kept).
    open = [a];
    core.beginSave(undefined, first.jobId);
    const p = await core.preview();
    const keys = [...p.sure, ...p.kept].map((i) => i.key);
    expect(keys).toContain(b.key);
    await core.commitSave({ jobId: p.jobId, name: p.suggestedName, note: '', keys, tidy: false });
    const latest = await core.store.latest(first.jobId);
    expect(latest!.items.map((i) => i.key)).toEqual(expect.arrayContaining([a.key, b.key]));
  });
});

describe('Tidy all', () => {
  it('saves the open folder, closes loose tabs, and leaves everyday sites alone', async () => {
    const core = makeCore();
    const trip = [tab(1, 'Flights to Tokyo'), tab(2, 'Ryokans in Kyoto')];
    open = trip;
    core.beginSave();
    await core.preview({ asNew: true });
    const first = await core.commitSave({ jobId: null, name: 'Japan trip', note: '', keys: trip.map((i) => i.key), tidy: false });
    // Still working on it, with a stray tab and mail open too.
    const stray: Item = { ...tab(9, 'Warriors vs Lakers'), key: 'tab:https://www.espn.com/nba/game', url: 'https://www.espn.com/nba/game', detail: 'espn.com' };
    const mail: Item = { ...tab(10, 'Inbox'), key: 'tab:https://mail.google.com/mail/u/0/', url: 'https://mail.google.com/mail/u/0/', detail: 'mail.google.com' };
    open = [...trip, stray, mail];
    const plan = await core.tidyAll();
    expect(plan.saved.map((s) => s.name)).toContain('Japan trip');
    expect(plan.loose + plan.breaks).toBe(1);
    expect(plan.breaks).toBe(1); // the ESPN game goes on the Break shelf
    expect(plan.close.map((i) => i.key)).toEqual([stray.key]);
    expect((await core.listJobs()).map((j) => j.name)).toEqual(['Japan trip']);
    expect((await core.store.latest(first.jobId))!.items.map((i) => i.key).sort()).toEqual(trip.map((i) => i.key).sort());
  });

  it('files a stray tab into the packed folder it clearly belongs to, and leaves unclear ones out', async () => {
    const core = makeCore();
    const site = (host: string, p: string, title: string): Item => ({ ...tab(0, title), key: `tab:https://${host}${p}`, url: `https://${host}${p}`, detail: host });
    const save = async (name: string, items: Item[]) => {
      open = items;
      core.beginSave();
      await core.preview({ asNew: true });
      return core.commitSave({ jobId: null, name, note: '', keys: items.map((i) => i.key), tidy: true });
    };
    const japan = await save('Japan trip', [site('www.google.com', '/travel/flights/tokyo', 'Flights to Tokyo Kyoto Japan'), site('www.booking.com', '/kyoto', 'Ryokans in Kyoto Japan')]);
    await save('Tax return', [site('www.irs.gov', '/forms', 'IRS tax forms 1040'), site('turbotax.intuit.com', '/', 'TurboTax tax return')]);
    const rail = site('www.japan-guide.com', '/e/e2361.html', 'Japan Rail Pass Tokyo to Kyoto');
    const random = site('www.espn.com', '/nba/game', 'Warriors vs Lakers');
    open = [rail, random];
    const plan = await core.tidyAll();
    expect(plan.filed).toEqual([{ jobId: japan.jobId, name: 'Japan trip', count: 1 }]);
    expect(plan.loose + plan.breaks).toBe(1);
    expect(plan.breaks).toBe(1); // the ESPN game goes on the Break shelf
    expect(plan.close.map((i) => i.key).sort()).toEqual([rail.key, random.key].sort());
    expect((await core.store.latest(japan.jobId))!.items.map((i) => i.key)).toContain(rail.key);
  });

  it('lists what it closed for 10 minutes, then forgets it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const core = makeCore();
      const stray = tab(9, 'Warriors vs Lakers');
      await core.rememberTidied([stray, tab(8)]);
      expect(core.recentlyTidied()?.items.map((i) => i.key)).toEqual([stray.key, tab(8).key]);
      // Reopening one takes it off the list.
      await core.reopenTidied(stray.key);
      expect(core.recentlyTidied()?.items.map((i) => i.key)).toEqual([tab(8).key]);
      vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
      expect(core.recentlyTidied()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('only closes what a packed folder already holds, without saving it again', async () => {
    const core = makeCore();
    open = [tab(1, 'Flights to Tokyo'), tab(2, 'Ryokans in Kyoto')];
    core.beginSave();
    await core.preview({ asNew: true });
    const first = await core.commitSave({ jobId: null, name: 'Japan trip', note: '', keys: open.map((i) => i.key), tidy: true });
    open = [tab(1, 'Flights to Tokyo')];
    const plan = await core.tidyAll();
    expect(plan.saved).toEqual([]);
    expect(plan.close.map((i) => i.key)).toEqual([tab(1).key]);
    expect(await core.store.entryIds(first.jobId)).toHaveLength(1);
  });
});

describe('Tidy all quits apps', () => {
  it('quits every app except Claude, Finder and Stashd', async () => {
    const { appsToQuit } = await import('../src/main/core');
    expect(appsToQuit(['Finder', 'Claude', 'Notes', 'Phone', 'Google Chrome', 'Spotify', 'Stashd'])).toEqual(['Notes', 'Phone', 'Google Chrome', 'Spotify']);
  });
});

describe('Pinning and ⌃O', () => {
  it('opens the pinned folder, else the one opened last; only one pin at a time', async () => {
    const core = makeCore();
    const make = async (name: string, n: number) => {
      open = [tab(n, `${name} page`)];
      core.beginSave();
      await core.preview({ asNew: true });
      return (await core.commitSave({ jobId: null, name, note: '', keys: open.map((i) => i.key), tidy: true })).jobId;
    };
    const a = await make('Alpha', 1);
    const b = await make('Beta', 2);
    expect(await core.quickOpenTarget()).toBe(b);
    open = [];
    await core.open(a, undefined, 'all');
    expect(await core.quickOpenTarget()).toBe(a);
    await core.setPinned(b, true);
    expect(await core.quickOpenTarget()).toBe(b);
    await core.setPinned(a, true);
    const pins = (await core.listJobs()).filter((j) => j.pinned).map((j) => j.id);
    expect(pins).toEqual([a]);
  });
});

describe('Removing from a folder', () => {
  it('takes an item out, and Undo puts it back', async () => {
    const core = makeCore();
    open = [tab(1, 'Flights to Tokyo'), tab(2, 'Ryokans in Kyoto')];
    core.beginSave();
    await core.preview({ asNew: true });
    const { jobId } = await core.commitSave({ jobId: null, name: 'Japan trip', note: '', keys: open.map((i) => i.key), tidy: true });
    // Let the brief for the new save finish writing first.
    await new Promise((r) => setTimeout(r, 200));
    await core.removeItem(jobId, tab(2).key);
    expect((await core.store.latest(jobId))!.items.map((i) => i.key)).toEqual([tab(1).key]);
    await core.restoreItem(jobId, tab(2).key);
    expect((await core.store.latest(jobId))!.items.map((i) => i.key)).toEqual([tab(1).key, tab(2).key]);
    await expect(core.restoreItem(jobId, tab(2).key)).rejects.toThrow();
  });
});

describe('Merging keeps one copy of each page', () => {
  it('drops the same page saved with a slightly different address', async () => {
    const { withoutRepeats } = await import('../src/main/core');
    const a: Item = { ...tab(1), key: 'tab:https://www.github.com/me/repo', url: 'https://www.github.com/me/repo' };
    const b: Item = { ...tab(1), key: 'tab:http://github.com/me/repo/', url: 'http://github.com/me/repo/' };
    const c: Item = { ...tab(2), key: 'tab:https://vercel.com/me/stashd', url: 'https://vercel.com/me/stashd' };
    expect(withoutRepeats([a, c, b, c]).map((i) => i.key)).toEqual([a.key, c.key]);
  });

  it('drops the same page on another address with the same title, but keeps different pages', async () => {
    const { withoutRepeats } = await import('../src/main/core');
    const site = (url: string, label: string): Item => ({ ...tab(0, label), key: `tab:${url}`, url });
    const live = site('https://getstashd.vercel.app/', 'Stashd · Put your work to bed');
    const preview = site('https://swift-flint-etetf54.vercel.app/', 'Stashd · Put your work to bed');
    const features = site('https://getstashd.vercel.app/features.html', 'Stashd features');
    const otherInbox = site('https://mail.example.com/', 'Inbox');
    const inbox = site('https://mail.google.com/', 'Inbox');
    expect(withoutRepeats([live, features, preview, inbox, otherInbox]).map((i) => i.url)).toEqual([live.url, features.url, inbox.url, otherInbox.url]);
  });
});

describe('Ctrl+S while watching a video, with unrelated tabs open', () => {
  it('offers the Break shelf instead of making a folder out of the video', async () => {
    const core = makeCore();
    const video: Item = { ...tab(1, '(182) Your SUS Clips... - YouTube'), key: 'tab:https://www.youtube.com/watch?v=u0iATr7A5KM', url: 'https://www.youtube.com/watch?v=u0iATr7A5KM', detail: 'youtube.com', active: true };
    const repo: Item = { ...tab(2, 'JuliusBrussee/caveman: why use many token'), key: 'tab:https://github.com/JuliusBrussee/caveman', url: 'https://github.com/JuliusBrussee/caveman' };
    const search: Item = { ...tab(3, 'github repo for saving tokens - Google Search'), key: 'tab:https://www.google.com/search?q=tokens', url: 'https://www.google.com/search?q=tokens' };
    open = [video, repo, search];
    core.beginSave();
    const p = await core.preview();
    expect(p.jobId).toBeNull();
    expect(p.onlyBreaks.map((i) => i.key)).toEqual([video.key]);
  });
});

describe('Ctrl+S with only a chat and a video open', () => {
  it('guesses no folder from the chat, and offers to put the video on the Break shelf', async () => {
    const core = makeCore();
    const chat: Item = { key: 'app:Claude', kind: 'app', label: 'Claude', detail: '', app: 'Claude', chat: { title: 'Stashd · Build', url: 'https://claude.ai/chat/abcdef123' } };
    const repo: Item = { ...tab(1, 'Stashd repo'), key: 'tab:https://github.com/a/stashd', url: 'https://github.com/a/stashd' };
    open = [chat, repo];
    core.beginSave();
    await core.preview({ asNew: true });
    await core.commitSave({ jobId: null, name: 'Stashd project', note: '', keys: [chat.key, repo.key], tidy: true });
    const video: Item = { ...tab(2, 'Some clip - YouTube'), key: 'tab:https://www.youtube.com/watch?v=x1', url: 'https://www.youtube.com/watch?v=x1', detail: 'youtube.com' };
    open = [chat, video];
    core.beginSave();
    const p = await core.preview();
    expect(p.jobId).toBeNull();
    expect(p.onlyBreaks.map((i) => i.key)).toEqual([video.key]);
    const shelved = await core.shelveBreaks([video.key]);
    expect(shelved.map((i) => i.key)).toEqual([video.key]);
    expect((await core.breakShelf()).items.map((i) => i.url)).toContain(video.url);
  });
});
