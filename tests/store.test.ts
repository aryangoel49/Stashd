import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Snapshot, SnapshotSummary } from '../src/shared/types';
import { planPrune, projectIdFor, SnapshotStore, snapshotIdFor } from '../src/main/store';
import { projectId as checkProjectId, snapshotId as checkSnapshotId } from '../src/shared/validate';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-17T12:00:00.000Z');

function summary(daysAgo: number, auto = false, i = 0): SnapshotSummary {
  const createdAt = new Date(NOW - daysAgo * DAY - i * 1000).toISOString();
  return { id: snapshotIdFor(new Date(createdAt)), projectId: 'p-1', createdAt, auto, trigger: auto ? 'idle' : 'manual', note: '' };
}

describe('planPrune', () => {
  it('deletes snapshots older than the day limit, but keeps the newest', () => {
    const list = [summary(1), summary(40), summary(50)];
    expect(planPrune(list, { count: 20, days: 30 }, NOW).sort()).toEqual([list[1].id, list[2].id].sort());
    expect(planPrune([summary(90)], { count: 20, days: 30 }, NOW)).toEqual([]);
  });

  it('removes automatic snapshots before manual ones when over the count', () => {
    const manualOld = summary(5);
    const autoNew = summary(1, true);
    const newest = summary(0);
    const del = planPrune([manualOld, autoNew, newest], { count: 2, days: 30 }, NOW);
    expect(del).toEqual([autoNew.id]);
  });

  it('removes the oldest when all are the same kind', () => {
    const list = [summary(0), summary(1), summary(2), summary(3)];
    expect(planPrune(list, { count: 2, days: 30 }, NOW).sort()).toEqual([list[2].id, list[3].id].sort());
  });
});

describe('ids', () => {
  it('project ids are safe and stable', () => {
    const id = projectIdFor('/Users/me/Code/My App!');
    expect(id).toMatch(/^my-app-[0-9a-f]{6}$/);
    expect(projectIdFor('/Users/me/Code/My App!')).toBe(id);
    expect(projectIdFor('/Users/me/Other/My App!')).not.toBe(id);
    expect(checkProjectId(id)).toBe(id);
  });
  it('snapshot ids validate', () => {
    expect(checkSnapshotId(snapshotIdFor(new Date(NOW)))).toBe('2026-10-17T12-00-00-000Z');
    expect(() => checkSnapshotId('../../etc/passwd')).toThrow();
  });
});

describe('SnapshotStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'wwi-store-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function snap(id: string, createdAt: string): Snapshot {
    return {
      version: 1, id, projectId: 'demo-abc123', projectName: 'demo', projectPath: '/tmp/demo', createdAt, auto: false, trigger: 'manual',
      note: 'hi', files: [], git: null, tabs: [], shell: null, errors: [],
    };
  }

  it('saves, lists newest first, loads and deletes', async () => {
    const store = new SnapshotStore(dir);
    const d1 = new Date(NOW - 1000);
    const d2 = new Date(NOW);
    await store.save(snap(await store.freeId('demo-abc123', d1), d1.toISOString()));
    await store.save(snap(await store.freeId('demo-abc123', d2), d2.toISOString()));
    const list = await store.list('demo-abc123');
    expect(list.map((s) => s.createdAt)).toEqual([d2.toISOString(), d1.toISOString()]);
    expect((await store.latest('demo-abc123'))?.createdAt).toBe(d2.toISOString());
    // atomic write leaves no temp files behind
    expect((await readdir(path.join(dir, 'demo-abc123'))).every((f) => f.endsWith('.json'))).toBe(true);
    await store.deleteProject('demo-abc123');
    expect(await store.list('demo-abc123')).toEqual([]);
  });

  it('picks a new id when two saves land in the same millisecond', async () => {
    const store = new SnapshotStore(dir);
    const d = new Date(NOW);
    const a = await store.freeId('demo-abc123', d);
    await store.save(snap(a, d.toISOString()));
    const b = await store.freeId('demo-abc123', d);
    expect(b).toBe(`${a}-1`);
  });

  it('refuses unsafe project ids', async () => {
    const store = new SnapshotStore(dir);
    await expect(store.list('../outside')).rejects.toThrow();
  });
});
