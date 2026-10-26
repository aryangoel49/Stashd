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
