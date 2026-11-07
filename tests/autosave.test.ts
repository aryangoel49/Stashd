import { mkdtempSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Capture, Item, Settings } from '../src/shared/types';

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() }, screen: { getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1440, height: 900 } }) } }));
vi.mock('../src/main/exec', async (orig) => ({ ...(await orig<typeof import('../src/main/exec')>()), run: vi.fn(async () => { throw new Error('not in tests'); }) }));

const { AutoSaver, driftStep, namesOf, START, verdict } = await import('../src/main/autosave');
const { RULES } = await import('../src/main/rules');
const { Memory } = await import('../src/main/memory');
const { Core } = await import('../src/main/core');
const { SettingsStore } = await import('../src/main/settings');
const { JobStore } = await import('../src/main/store');
type OpenLook = import('../src/main/core').OpenLook;

const MIN = 60_000;

describe('noticing that you moved on', () => {
  it('after 10 minutes on a folder, 3 minutes on something else counts as moving on', () => {
    let t = START;
    let drifted: string | null = null;
    for (let m = 0; m <= 10; m++) ({ track: t } = driftStep(t, 'essay', m * MIN, RULES));
    for (let m = 11; m <= 14 && !drifted; m++) ({ track: t, drifted } = driftStep(t, 'other', m * MIN, RULES));
    expect(drifted).toBe('essay');
  });

  it('a quick look at Mail, or coming back within 3 minutes, is not moving on', () => {
    let t = START;
    for (let m = 0; m <= 10; m++) ({ track: t } = driftStep(t, 'essay', m * MIN, RULES));
    let r = driftStep(t, 'neutral', 11 * MIN, RULES);
    r = driftStep(r.track, 'other', 12 * MIN, RULES);
    r = driftStep(r.track, 'essay', 14 * MIN, RULES);
    r = driftStep(r.track, 'essay', 15 * MIN, RULES);
    expect(r.drifted).toBeNull();
    expect(r.track.focus).toBe('essay');
  });

  it('a few minutes on a folder is not "working on it" yet', () => {
    let t = START;
    for (let m = 0; m <= 3; m++) ({ track: t } = driftStep(t, 'essay', m * MIN, RULES));
    const r = driftStep(driftStep(t, 'other', 4 * MIN, RULES).track, 'other', 8 * MIN, RULES);
    expect(r.drifted).toBeNull();
  });
});

describe('learning from your answers', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  it('asks until it has heard enough', () => expect(verdict(['ignored', 'ignored'], null, RULES, now)).toBe('ask'));
  it('goes quiet when you mostly ignore a card', () => expect(verdict(['ignored', 'ignored', 'ignored', 'ignored', 'keep'], '2026-11-06T11:00:00Z', RULES, now)).toBe('quiet'));
  it('keeps showing a card you answer', () => expect(verdict(Array(5).fill('keep'), '2026-11-06T11:00:00Z', RULES, now)).toBe('ask'));
  it('tries once more after a week', () => expect(verdict(Array(5).fill('ignored'), '2026-10-20T11:00:00Z', RULES, now)).toBe('ask'));
  it('names one, two or many folders', () => {
    expect(namesOf(['Climate essay'])).toBe('Climate essay');
    expect(namesOf(['Climate essay', 'Toronto trip'])).toBe('Climate essay and Toronto trip');
    expect(namesOf(['a', 'b', 'c'])).toBe('3 folders');
  });
});

function look(front: string): OpenLook {
  return { state: {}, open: new Set(), jobs: [{ id: 'essay', name: 'Climate essay' }] as never, latest: [], items: [], cap: { items: [] } as unknown as Capture, front };
}

function rig(over: Partial<Settings> = {}, answer: 'act' | 'dismiss' | 'timeout' = 'timeout') {
  let clock = Date.parse('2026-11-06T09:00:00Z');
  const memory = Memory.open(mkdtempSync(path.join(os.tmpdir(), 'stashd-auto-')));
  const saves: string[][] = [];
  const removed: string[] = [];
  const packed: string[] = [];
  const cards: string[] = [];
  const auto = new AutoSaver({
    settings: () => ({ autoSave: true, autoSaveTalk: 'helpful', ...over }) as Settings,
    memory: () => memory,
    rules: RULES,
    lookNow: async () => look('essay'),
    frontFolder: (l) => l.front ?? 'neutral',
    foldersInUse: () => ['essay'],
    homeOf: async () => null,
    wouldSave: async () => true,
    save: async (_cap, ids) => (saves.push(ids), ids.map((id) => ({ jobId: id, entryId: '2026-11-06T09-00-00-000Z', name: 'Climate essay' }))),
    remove: async (jobId) => void removed.push(jobId),
    packUp: async (jobId) => void packed.push(jobId),
    unpack: async () => undefined,
    ask: async (card) => (cards.push(card.title), answer),
    busy: () => false,
    now: () => clock,
  });
  const tick = async (front: string, minutes: number) => {
    for (let m = 0; m < minutes; m++) {
      clock += MIN;
      await auto.look(look(front));
    }
  };
  return { auto, memory, saves, removed, packed, cards, tick, advance: (ms: number) => (clock += ms) };
}

describe('automatic saving', () => {
  it('saves on its own when you move on, then says so; the card closes nothing by itself', async () => {
    const r = rig();
    await r.tick('essay', 11);
    await r.tick('other', 4);
    expect(r.saves).toEqual([['essay']]);
    expect(r.cards).toEqual(['Saved Climate essay']);
    expect(r.packed).toEqual([]);
    expect(r.memory.rows('moments')).toMatchObject([{ kind: 'drift', from_folder: 'essay' }]);
    expect(r.memory.rows('saves')).toMatchObject([{ folder: 'essay', how: 'auto' }]);
    expect(r.memory.answers('drift_saved')).toEqual(['ignored']);
  });

  it('Pack up on the card packs the folder up from the save it just made', async () => {
    const r = rig({}, 'act');
    await r.tick('essay', 11);
    await r.tick('other', 4);
    expect(r.packed).toEqual(['essay']);
    expect(r.removed).toEqual([]);
    expect(r.memory.answers('drift_saved')).toEqual(['pack']);
  });

  it('shows the moving-on card at most once every half hour; the saving goes on', async () => {
    const r = rig();
    await r.tick('essay', 11);
    await r.tick('other', 4);
    await r.tick('essay', 11);
    await r.tick('other', 4);
    expect(r.saves).toEqual([['essay'], ['essay']]);
    expect(r.cards).toHaveLength(1);
    r.advance(31 * MIN);
    await r.tick('essay', 11);
    await r.tick('other', 4);
    expect(r.cards).toHaveLength(2);
  });

  it('with cards off, it saves and shows nothing', async () => {
    const r = rig({ autoSaveTalk: 'quiet' });
    await r.tick('essay', 11);
    await r.tick('other', 4);
    expect(r.saves).toEqual([['essay']]);
    expect(r.cards).toEqual([]);
  });

  it('turned off, it does nothing at all', async () => {
    const r = rig({ autoSave: false });
    await r.tick('essay', 11);
    await r.tick('other', 4);
    await r.auto.leaving('sleep');
    expect(r.saves).toEqual([]);
    expect(r.memory.counts().moments).toBe(0);
  });

  it('saves before sleep, and asks when you are back after a while (Remove takes the save away)', async () => {
    const r = rig({}, 'act');
    await r.tick('essay', 2);
    await r.auto.leaving('sleep');
    await r.auto.leaving('lock'); // the lid locks the screen too: same moment
    expect(r.saves).toEqual([['essay']]);
    r.advance(40 * MIN);
    await r.auto.back();
    expect(r.cards).toEqual(['Saved Climate essay before your Mac slept']);
    expect(r.removed).toEqual(['essay']);
    expect(r.memory.answers('back_sleep')).toEqual(['remove']);
    expect(r.memory.rows('moments').find((m) => m.kind === 'sleep')).toMatchObject({ minutes_away: 40 });
  });

  it('after a short break there is no card', async () => {
    const r = rig();
    await r.tick('essay', 2);
    await r.auto.leaving('sleep');
    r.advance(5 * MIN);
    await r.auto.back();
    expect(r.cards).toEqual([]);
  });

  it('walking away counts from when you stopped, and coming back ends it', async () => {
    const r = rig();
    await r.tick('essay', 2);
    r.auto.idle(RULES.awayAfterMin * 60);
    await new Promise((res) => setTimeout(res, 0));
    expect(r.memory.rows('moments').some((m) => m.kind === 'away')).toBe(true);
  });
});

describe('the save itself', () => {
  const tab = (n: number, title: string): Item => ({ key: `tab:https://jstor.org/s/${n}`, kind: 'tab', label: title, detail: 'jstor.org', app: 'Google Chrome', url: `https://jstor.org/s/${n}`, browser: 'chrome', window: 1 });

  it('replaces its own last automatic save, skips unchanged ones, and leaves your saves and settings alone', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'stashd-autosave-'));
    let open = [tab(1, 'Carbon tax essay draft'), tab(2, 'Carbon tax essay sources')];
    const capture = async (): Promise<Capture> => ({ at: new Date().toISOString(), appOrder: ['Google Chrome'], frontApp: 'Google Chrome', items: open, errors: [] });
    const settings = new SettingsStore(dir);
    const store = new JobStore(path.join(dir, 'jobs'));
    const core = new Core(settings, store, { icons: async () => [] } as never, dir, ['Stashd'], capture);
    core.beginSave();
    const p = await core.preview();
    const mine = await core.commitSave({ jobId: null, name: 'Carbon tax essay', note: '', keys: p.sure.map((i) => i.key), tidy: true });
    expect(settings.get().tidyUp).toBe(true);

    open = [...open, tab(3, 'Carbon tax essay outline')];
    const first = await core.autoSave(await capture(), [mine.jobId]);
    expect(first).toHaveLength(1);
    expect(await core.autoSave(await capture(), [mine.jobId])).toEqual([]);

    open = [...open, tab(4, 'Carbon tax essay conclusion')];
    const second = await core.autoSave(await capture(), [mine.jobId]);
    const ids = await store.entryIds(mine.jobId);
    expect(ids).toContain(mine.entryId);
    expect(ids).toContain(second[0].entryId);
    expect(ids).not.toContain(first[0].entryId);
    expect((await store.latest(mine.jobId))?.auto).toBe(true);
    expect(settings.get().tidyUp).toBe(true);

    await core.removeAutoSave(mine.jobId, mine.entryId);
    expect(await store.entryIds(mine.jobId)).toContain(mine.entryId);
    await core.removeAutoSave(mine.jobId, second[0].entryId);
    expect(await store.entryIds(mine.jobId)).toEqual([mine.entryId]);
  });
});
