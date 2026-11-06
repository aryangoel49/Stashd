import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BreakStore } from '../src/main/breaks';
import { backupBeforeChange, backupsDir, KEEP_BACKUPS, onDamage, type Damage } from '../src/main/safety';
import { SettingsStore } from '../src/main/settings';
import { JobStore } from '../src/main/store';
import type { SaveEntry } from '../src/shared/types';

const save = (jobId: string, id: string): SaveEntry => ({ version: 2, id, jobId, savedAt: id.replace(/T(\d\d)-(\d\d)-(\d\d)-/, 'T$1:$2:$3.').replace(/Z.*/, 'Z'), note: '', items: [], frontKey: null, appOrder: [], tidied: false, errors: [] });
const OLD = '2026-11-01T10-00-00-000Z';
const NEW = '2026-11-02T10-00-00-000Z';

describe('never losing a save', () => {
  let dir: string;
  let store: JobStore;
  let told: Damage[];
  const jobFile = (id: string) => path.join(dir, 'jobs', id, 'job.json');
  const entryFile = (job: string, id: string) => path.join(dir, 'jobs', job, 'history', `${id}.json`);
  const backups = () => readdirSync(backupsDir(dir)).sort();

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'stashd-safety-'));
    store = new JobStore(path.join(dir, 'jobs'), backupsDir(dir));
    told = [];
    onDamage((d) => told.push(d));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function aFolder(): Promise<string> {
    const job = await store.create('Climate essay');
    await store.saveEntry(save(job.id, OLD));
    await store.saveEntry(save(job.id, NEW));
    return job.id;
  }

  describe('backups', () => {
    it('has nothing to back up on a brand-new install, but remembers the version', () => {
      expect(backupBeforeChange(dir, '1.5.0')).toBeNull();
      expect(existsSync(backupsDir(dir))).toBe(false);
      writeFileSync(path.join(dir, 'settings.json'), '{}');
      expect(backupBeforeChange(dir, '1.5.0')).toBeNull();
    });

    it('copies saves before a new version runs, once, and leaves the Claude key and caches out', async () => {
      const id = await aFolder();
      for (const f of ['settings.json', 'state.json', 'break.json', 'api-key.bin', 'install-id']) writeFileSync(path.join(dir, f), '{}');
      mkdirSync(path.join(dir, 'Cache'));
      const made = backupBeforeChange(dir, '1.5.0')!;
      expect(made).toBeTruthy();
      expect(readdirSync(made).sort()).toEqual(['break.json', 'jobs', 'settings.json', 'state.json']);
      expect(JSON.parse(readFileSync(path.join(made, 'jobs', id, 'history', `${NEW}.json`), 'utf8')).id).toBe(NEW);
      expect(backupBeforeChange(dir, '1.5.0')).toBeNull();
      expect(backupBeforeChange(dir, '1.5.1')).toContain('1.5.0');
      expect(backups()).toHaveLength(2);
    });

    it(`keeps the last ${KEEP_BACKUPS}`, async () => {
      await aFolder();
      for (let i = 1; i <= KEEP_BACKUPS + 3; i++) backupBeforeChange(dir, `1.5.${i}`, new Date(2026, 10, i));
      expect(backups()).toHaveLength(KEEP_BACKUPS);
      expect(backups().at(-1)).toContain('1.5.7');
      expect(backups()[0]).toContain('1.5.3');
    });

    it('tries again next time if a backup fails, and a half-made one never counts', async () => {
      await aFolder();
      writeFileSync(backupsDir(dir), 'in the way');
      expect(() => backupBeforeChange(dir, '1.5.0')).toThrow();
      rmSync(backupsDir(dir));
      expect(backupBeforeChange(dir, '1.5.0')).toBeTruthy();
      expect(backups().filter((b) => b.endsWith('.tmp'))).toEqual([]);
    });
  });

  describe('a damaged folder file', () => {
    it('comes back from its last good copy, and the damaged file is kept', async () => {
      const id = await aFolder();
      await store.put({ ...(await store.get(id)), name: 'Climate essay v2' });
      await store.put({ ...(await store.get(id)), name: 'Climate essay v3' });
      writeFileSync(jobFile(id), '{"id":"cli');
      const jobs = await store.list();
      expect(jobs.map((j) => j.name)).toEqual(['Climate essay v2']);
      expect(readdirSync(path.join(dir, 'jobs', id)).some((n) => n.startsWith('job.json.damaged-'))).toBe(true);
      expect(told).toEqual([{ file: jobFile(id), repaired: true }]);
    });

    it('comes back from a backup when there is no last good copy', async () => {
      const id = await aFolder();
      backupBeforeChange(dir, '1.5.0');
      writeFileSync(jobFile(id), '');
      expect((await store.get(id)).name).toBe('Climate essay');
    });

    it('is rebuilt from its saves when no copy is left, so the folder never vanishes', async () => {
      const id = await aFolder();
      writeFileSync(jobFile(id), 'garbage');
      const [job] = await store.list();
      expect(job).toMatchObject({ id, name: 'Climate essay', createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z' });
      expect((await store.latest(id))?.id).toBe(NEW);
      expect(JSON.parse(readFileSync(jobFile(id), 'utf8')).name).toBe('Climate essay');
    });

    it('is repaired once when several readers find the damage at the same moment', async () => {
      const id = await aFolder();
      writeFileSync(jobFile(id), 'garbage');
      const jobs = await Promise.all([store.get(id), store.get(id), store.list()]);
      expect(jobs[0].name).toBe('Climate essay');
      expect(told).toHaveLength(1);
    });

    it('rebuilds a folder whose file is valid JSON but makes no sense, or is gone', async () => {
      const a = await aFolder();
      writeFileSync(jobFile(a), '{}');
      expect((await store.get(a)).name).toBe('Climate essay');
      rmSync(jobFile(a));
      rmSync(`${jobFile(a)}.bak`, { force: true });
      expect((await store.list()).map((j) => j.id)).toEqual([a]);
    });

    it('a damaged file never replaces the last good copy', async () => {
      const id = await aFolder();
      await store.put({ ...(await store.get(id)), name: 'Good' });
      await store.put({ ...(await store.get(id)), name: 'Good 2' });
      writeFileSync(jobFile(id), '{"oops');
      await store.put({ ...(await store.get(id)), name: 'After repair' });
      expect(JSON.parse(readFileSync(`${jobFile(id)}.bak`, 'utf8')).name).toBe('Good');
    });
  });

  describe('a damaged save', () => {
    it('comes back from a backup', async () => {
      const id = await aFolder();
      backupBeforeChange(dir, '1.5.0');
      writeFileSync(entryFile(id, NEW), '{"version":2,"id":');
      expect((await store.latest(id))?.id).toBe(NEW);
      expect(told).toEqual([{ file: entryFile(id, NEW), repaired: true }]);
    });

    it('with no copy left: the one before it is used, you are told, and the damaged file is kept', async () => {
      const id = await aFolder();
      writeFileSync(entryFile(id, NEW), 'garbage');
      expect((await store.latest(id))?.id).toBe(OLD);
      expect(await store.entryIds(id)).toEqual([OLD]);
      expect(told).toEqual([{ file: entryFile(id, NEW), repaired: false }]);
      const left = readdirSync(path.join(dir, 'jobs', id, 'history')).find((n) => n.includes('.damaged-'))!;
      expect(readFileSync(path.join(dir, 'jobs', id, 'history', left), 'utf8')).toBe('garbage');
    });

    it('does not bring back a save that was pruned', async () => {
      const id = await aFolder();
      backupBeforeChange(dir, '1.5.0');
      await store.prune(id, 1);
      await expect(store.entry(id, OLD)).rejects.toThrow();
      expect(await store.entryIds(id)).toEqual([NEW]);
      expect(told).toEqual([]);
    });
  });

  describe('deleting', () => {
    it('a deleted folder stays deleted, in the backups too', async () => {
      const id = await aFolder();
      const keep = (await store.create('Toronto trip')).id;
      const made = backupBeforeChange(dir, '1.5.0')!;
      await store.delete(id);
      await expect(store.get(id)).rejects.toThrow();
      expect((await store.list()).map((j) => j.id)).toEqual([keep]);
      expect(readdirSync(path.join(made, 'jobs'))).toEqual([keep]);
    });

    it('deleting everything removes the backups', async () => {
      await aFolder();
      backupBeforeChange(dir, '1.5.0');
      await store.deleteAll();
      expect(existsSync(backupsDir(dir))).toBe(false);
    });
  });

  describe('settings and the Break shelf', () => {
    it('damaged settings come back instead of going to defaults', async () => {
      const s = new SettingsStore(dir);
      await s.update({ accent: 'teal' });
      await s.update({ accent: 'coral' });
      writeFileSync(path.join(dir, 'settings.json'), '{"accent":');
      expect(new SettingsStore(dir).get().accent).toBe('teal');
      expect(told).toEqual([{ file: path.join(dir, 'settings.json'), repaired: true }]);
    });

    it('settings damaged beyond repair use defaults but keep the damaged file, and you are told', () => {
      writeFileSync(path.join(dir, 'settings.json'), 'garbage');
      expect(new SettingsStore(dir).get().accent).toBe('indigo');
      expect(readdirSync(dir).some((n) => n.startsWith('settings.json.damaged-'))).toBe(true);
      expect(told[0].repaired).toBe(false);
    });

    it('a first run is not damage', () => {
      new SettingsStore(dir);
      expect(told).toEqual([]);
    });

    it('a damaged Break shelf keeps your places', async () => {
      const first = new BreakStore(dir);
      await first.setBrowser('brave');
      await first.setBrowser('edge');
      writeFileSync(path.join(dir, 'break.json'), '[1,');
      expect((await new BreakStore(dir).get()).browser).toBe('brave');
    });
  });
});
