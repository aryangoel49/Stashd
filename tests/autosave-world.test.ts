// Automatic saving and the memory working together with the real save engine, in the situations people hit.
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Memory as MemoryType } from '../src/main/memory';
import type { Capture, Item } from '../src/shared/types';

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() }, screen: { getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1440, height: 900 } }) } }));
vi.mock('../src/main/exec', async (orig) => ({ ...(await orig<typeof import('../src/main/exec')>()), run: vi.fn(async () => { throw new Error('not in tests'); }) }));

const { AutoSaver } = await import('../src/main/autosave');
const { RULES } = await import('../src/main/rules');
const { Memory } = await import('../src/main/memory');
const { Core } = await import('../src/main/core');
const { SettingsStore } = await import('../src/main/settings');
const { JobStore } = await import('../src/main/store');

const MIN = 60_000;
const tab = (n: string, title: string, active = false): Item => ({ key: `tab:https://jstor.org/s/${n}`, kind: 'tab', label: title, detail: 'jstor.org', app: 'Google Chrome', url: `https://jstor.org/s/${n}`, browser: 'chrome', window: 2, active });
const dog = (active = true): Item => ({ key: 'tab:https://reddit.com/r/aww', kind: 'tab', label: 'Cute dogs : aww', detail: 'reddit.com', app: 'Google Chrome', url: 'https://reddit.com/r/aww', browser: 'chrome', window: 1, active });
const A = tab('1', 'Carbon tax essay draft', true);
const B = tab('2', 'Carbon tax essay sources');
const C = tab('3', 'Carbon tax essay outline');

function world(answer: 'act' | 'dismiss' | 'timeout' = 'timeout') {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'stashd-probe-'));
  const settings = new SettingsStore(dir);
  const store = new JobStore(path.join(dir, 'jobs'));
  let open: Item[] = [A, B];
  const fake = async (): Promise<Capture> => ({ at: new Date().toISOString(), appOrder: ['Google Chrome'], frontApp: 'Google Chrome', items: open, errors: [] });
  const core = new Core(settings, store, { icons: async () => [] } as never, dir, ['Stashd'], fake);
  const memory = Memory.open(dir);
  core.memory = memory;
  let clock = Date.parse('2026-11-06T09:00:00Z');
  const cards: string[] = [];
  const makeAuto = () =>
    new AutoSaver({
      settings: () => settings.get(),
      memory: () => core.memory,
      rules: RULES,
      lookNow: () => (core.notify(), core.lookAtOpen()),
      frontFolder: (l) => core.frontFolder(l),
      foldersInUse: (l) => core.foldersInUse(l),
      homeOf: (l) => core.homeOf(l),
      wouldSave: (cap, id) => core.wouldSave(cap, id),
      save: (cap, ids) => core.autoSave(cap, ids),
      remove: (j, e) => core.removeAutoSave(j, e),
      unpack: async () => undefined,
      ask: async (card) => (cards.push(card.title), answer),
      busy: () => false,
      now: () => clock,
    });
  const auto = makeAuto();
  const tick = async (minutes: number) => {
    for (let m = 0; m < minutes; m++) {
      clock += MIN;
      core.notify();
      await auto.look(await core.lookAtOpen());
    }
  };
  const save = async (name = 'Carbon tax essay', tidy = false) => {
    core.beginSave();
    const p = await core.preview();
    return core.commitSave({ jobId: null, name, note: '', keys: p.sure.map((i) => i.key), tidy });
  };
  return { dir, core, store, memory, cards, auto, makeAuto, tick, save, setOpen: (o: Item[]) => (open = o), fake, advance: (ms: number) => (clock += ms), settings };
}

describe('moving on', () => {
  it('saves on its own, without asking, when there is something new', async () => {
    const w = world();
    const s = await w.save();
    await w.tick(11);
    w.setOpen([dog(), A, B, C]);
    await w.tick(4);
    expect(w.cards).toEqual([]);
    expect((await w.store.latest(s.jobId))?.auto).toBe(true);
    expect((await w.store.latest(s.jobId))?.items.map((i) => i.label)).toContain(C.label);
  });

  it('saves nothing right after you saved, when nothing changed', async () => {
    const w = world();
    const s = await w.save();
    await w.tick(11);
    w.setOpen([dog(), A, B]);
    await w.tick(4);
    expect(await w.store.entryIds(s.jobId)).toEqual([s.entryId]);
  });

  it('saves nothing after you packed the folder up yourself', async () => {
    const w = world();
    await w.tick(0);
    const s = await w.save();
    await w.tick(11);
    await w.core.commitSave({ jobId: s.jobId, name: 'Carbon tax essay', note: '', keys: [A.key, B.key], tidy: true }).catch(async () => {
      w.core.beginSave();
      await w.core.preview({ jobId: s.jobId });
      await w.core.commitSave({ jobId: s.jobId, name: 'Carbon tax essay', note: '', keys: [A.key, B.key], tidy: true });
    });
    w.setOpen([dog()]);
    await w.tick(4);
    expect((await w.store.latest(s.jobId))?.auto).toBeFalsy();
  });

  it('does not save a folder you deleted', async () => {
    const w = world();
    const s = await w.save();
    await w.tick(11);
    await w.core.deleteJob(s.jobId);
    w.setOpen([dog(), A, B]);
    await w.tick(4);
    expect((await w.store.list()).map((j) => j.id)).not.toContain(s.jobId);
  });

  it('a new tab on the same topic is not moving on', async () => {
    const w = world();
    const s = await w.save();
    await w.tick(11);
    w.setOpen([{ ...tab('9', 'Carbon tax essay more reading', true), window: 1 }, A, B]);
    await w.tick(4);
    expect(await w.core.homeOf(await (w.core.notify(), w.core.lookAtOpen()))).toBe(s.jobId);
    expect(await w.store.entryIds(s.jobId)).toEqual([s.entryId]);
  });
});

describe('what an automatic save holds', () => {
  it('leaves out an unrelated tab you happen to be on', async () => {
    const w = world();
    const s = await w.save();
    await w.tick(2);
    w.setOpen([dog(), A, B, C]);
    await w.tick(1);
    await w.auto.leaving('sleep');
    const latest = await w.store.latest(s.jobId);
    expect(latest?.auto).toBe(true);
    expect(latest?.items.map((i) => i.label)).not.toContain('Cute dogs : aww');
  });

  it('keeps things from the folder that are closed now', async () => {
    const w = world();
    const s = await w.save();
    await w.tick(2);
    w.setOpen([A, C]);
    await w.tick(1);
    await w.auto.leaving('sleep');
    expect((await w.store.latest(s.jobId))?.items.map((i) => i.label).sort()).toEqual([A.label, C.label, B.label].sort());
  });

  it('does not use up a brief for every automatic save', async () => {
    const w = world();
    let briefs = 0;
    w.core.writers = [{ name: 'stashd', write: async () => (briefs++, null), suggestName: async () => null }] as never;
    const s = await w.save();
    await new Promise((r) => setTimeout(r, 50));
    const after = briefs;
    for (const extra of ['x', 'y', 'z']) {
      w.setOpen([A, B, tab(extra, `Carbon tax essay ${extra}`)]);
      w.core.notify();
      const look = await w.core.lookAtOpen();
      await w.core.autoSave(look.cap, [s.jobId]);
    }
    await new Promise((r) => setTimeout(r, 50));
    expect(briefs).toBe(after);
  });

  it('an automatic save at that moment does not break the save box you just opened', async () => {
    const w = world();
    const s = await w.save();
    w.setOpen([A, B, C]);
    w.core.notify();
    const look = await w.core.lookAtOpen();
    const running = w.core.autoSave(look.cap, [s.jobId]);
    for (let i = 0; i < 200 && !(w.core as unknown as { pending: unknown }).pending; i++) await new Promise((r) => setImmediate(r));
    w.core.beginSave();
    const box = await w.core.preview({ jobId: s.jobId });
    await running;
    await expect(w.core.commitSave({ jobId: s.jobId, name: 'Carbon tax essay', note: 'mine', keys: box.sure.map((i) => i.key), tidy: false })).resolves.toBeTruthy();
  });
});

function stub(saves: { jobId: string; entryId: string; name: string }[][] = []) {
  let clock = Date.parse('2026-11-06T09:00:00Z');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'stashd-stub-'));
  const memory = Memory.open(dir);
  const cards: string[] = [];
  const saved: string[][] = [];
  const look = { state: {}, open: new Set(), jobs: [{ id: 'essay', name: 'Climate essay' }], latest: [], items: [], cap: { items: [] }, front: 'x' } as never;
  const deps = {
    settings: () => ({ autoSave: true, autoSaveTalk: 'helpful' }) as never,
    memory: () => memory as MemoryType | undefined,
    rules: RULES,
    lookNow: async () => look,
    frontFolder: () => 'essay',
    foldersInUse: () => ['essay'],
    homeOf: async () => null,
    wouldSave: async () => true,
    save: async (_c: unknown, ids: string[]) => (saved.push(ids), saves.shift() ?? []),
    remove: async () => undefined,
    unpack: async () => undefined,
    ask: async (c: { title: string }) => (cards.push(c.title), 'timeout' as const),
    busy: () => false,
    now: () => clock,
  };
  return { auto: new AutoSaver(deps), deps, memory, cards, saved, advance: (ms: number) => (clock += ms) };
}
const one = { jobId: 'essay', entryId: '2026-11-06T09-00-00-000Z', name: 'Climate essay' };

describe('leaving and coming back', () => {
  it('the card waits until you have unlocked, not while the login screen is up', async () => {
    const r = stub([[one]]);
    await r.auto.leaving('sleep');
    r.auto.setLocked(true);
    await r.auto.leaving('lock');
    r.advance(40 * MIN);
    await r.auto.back(); // the Mac woke, still locked
    expect(r.cards).toEqual([]);
    r.auto.setLocked(false);
    await r.auto.back();
    expect(r.cards).toEqual(['Saved Climate essay before your Mac slept']);
  });

  it('the lid closing locks the screen at the same moment: one save, not two', async () => {
    const r = stub([[one], [one]]);
    await Promise.all([r.auto.leaving('sleep'), r.auto.leaving('lock')]);
    expect(r.saved).toEqual([['essay']]);
  });

  it('walked away, then the Mac slept later: you still hear about the save when back', async () => {
    const r = stub([[one], []]);
    await r.auto.leaving('away');
    r.advance(30 * MIN);
    await r.auto.leaving('sleep');
    r.advance(60 * MIN);
    await r.auto.back();
    expect(r.cards).toEqual(['Saved Climate essay while you were away']);
  });

  it('locked, then shut down soon after: the restart still offers to bring work back', async () => {
    const w = world();
    await w.save();
    await w.tick(1);
    await w.auto.leaving('lock');
    w.advance(MIN);
    await w.auto.leaving('shutdown');
    w.advance(10 * MIN);
    await w.makeAuto().afterRestart();
    expect(w.cards.at(-1)).toContain('before your Mac shut down');
  });

  it('shut down with nothing changed since your last save: the restart still offers it', async () => {
    const w = world();
    await w.save();
    await w.tick(1);
    await w.auto.leaving('shutdown');
    w.advance(10 * MIN);
    await w.makeAuto().afterRestart();
    expect(w.cards.at(-1)).toContain('before your Mac shut down');
  });

  it('a broken memory never stops a save', async () => {
    const boom = new Proxy({}, { get: () => () => { throw new Error('disk full'); } }) as MemoryType;
    const r = stub([[one], [one]]);
    r.deps.memory = () => boom;
    await r.auto.leaving('sleep');
    expect(r.saved).toEqual([['essay']]);
  });

  it('a broken memory never stops a save on moving on', async () => {
    const boom = new Proxy({}, { get: () => () => { throw new Error('disk full'); } }) as MemoryType;
    const r = stub([[one]]);
    r.deps.memory = () => boom;
    const d = r.deps as { frontFolder: () => string };
    for (let m = 0; m < 11; m++) {
      r.advance(MIN);
      await r.auto.look({ jobs: [], items: [], cap: {} } as never);
    }
    d.frontFolder = () => 'other';
    for (let m = 0; m < 4; m++) {
      r.advance(MIN);
      await r.auto.look({ jobs: [], items: [], cap: {} } as never).catch(() => undefined);
    }
    expect(r.saved).toEqual([['essay']]);
  });
});

describe('deleting a folder', () => {
  it('stays deleted when a brief or card finishes writing afterwards', async () => {
    const w = world();
    const s = await w.save();
    const latest = await w.store.latest(s.jobId);
    const job = await w.store.get(s.jobId);
    await w.core.deleteJob(s.jobId);
    await w.store.saveEntry(latest!).catch(() => undefined);
    await w.store.put(job).catch(() => undefined);
    expect(await w.store.list()).toEqual([]);
  });
});

describe('memory and privacy', () => {
  const SECRET = 'Zebra-private-title-4471';
  const secretTab: Item = { key: 'tab:https://x.io/a', kind: 'tab', label: SECRET, detail: 'x.io', app: 'Google Chrome', url: 'https://x.io/a', browser: 'chrome' };
  const anywhere = (dir: string) => readdirSync(dir).filter((f) => f.startsWith('memory.db') && statSync(path.join(dir, f)).isFile() && readFileSync(path.join(dir, f)).includes(SECRET));

  it('"Forget my history" leaves no title in any file', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'stashd-forget-'));
    const m = Memory.open(dir);
    for (let i = 0; i < 20; i++) m.recordSave({ folder: 'f', file: 'e', how: 'manual', kind: 'manual', items: [secretTab] });
    expect(anywhere(dir).length).toBeGreaterThan(0);
    m.forget();
    expect(anywhere(dir)).toEqual([]);
    m.close();
    expect(anywhere(dir)).toEqual([]);
  });

  it('"Forget my history" also clears copies set aside earlier', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'stashd-forget2-'));
    writeFileSync(path.join(dir, 'memory.db.damaged-2026'), SECRET);
    writeFileSync(path.join(dir, 'memory.db.before-v2-2026'), SECRET);
    const m = Memory.open(dir);
    m.forget();
    expect(anywhere(dir)).toEqual([]);
  });

  it('deleting a folder forgets what the memory held about it', async () => {
    const w = world();
    const s = await w.save();
    expect(w.memory.rows('snapshot_items').length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 50));
    await w.core.deleteJob(s.jobId);
    expect(w.memory.rows('snapshot_items')).toEqual([]);
    expect(w.memory.rows('saves')).toEqual([]);
  });

  it('only you can read the memory files, while it runs', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'stashd-perm-'));
    const m = Memory.open(dir);
    m.recordSave({ folder: 'f', file: 'e', how: 'manual', kind: 'manual', items: [secretTab] });
    for (const f of readdirSync(dir).filter((n) => n.startsWith('memory.db'))) expect(`${f} ${(statSync(path.join(dir, f)).mode & 0o777).toString(8)}`).toBe(`${f} 600`);
  });

  it('survives a damaged file while keeping the damaged copy', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'stashd-dmg-'));
    writeFileSync(path.join(dir, 'memory.db'), 'not a database at all'.repeat(100));
    const m = Memory.open(dir);
    expect(m.version()).toBeGreaterThan(0);
    expect(readdirSync(dir).some((n) => n.startsWith('memory.db.damaged-'))).toBe(true);
  });
});
