// Saves jobs as JSON files:
//   <base>/<jobId>/job.json             name, dates, learned preferences
//   <base>/<jobId>/history/<id>.json    one file per save
// Writes are atomic (write a temp file, then rename), so a crash never leaves half a file.
// A file damaged some other way is repaired from its last good copy (see safety.ts).

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Job, SaveEntry } from '../shared/types';
import { entryId as checkEntryId, jobId as checkJobId } from '../shared/validate';
import { isObject, recoverJson, reportDamage } from './safety';

export const MAX_HISTORY = 30;

/** A stable, filesystem-safe id for a job, like "climate-essay-3f9a1c". */
export function jobIdFor(name: string, seed: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'job';
  const hash = createHash('sha256').update(`${name}|${seed}`).digest('hex').slice(0, 6);
  return `${slug}-${hash}`;
}

export function entryIdFor(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

let tmpCount = 0;

export async function writeFileAtomic(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Unique per write: two saves of one file in the same millisecond mustn't share a temp file.
  const tmp = `${file}.${process.pid}.${Date.now()}.${++tmpCount}.tmp`;
  const fh = await fs.open(tmp, 'w', 0o600);
  try {
    await fh.writeFile(data, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fs.rename(tmp, file);
}

/** Like writeFileAtomic, keeping what was there as <file>.bak. A damaged file never replaces a good copy. */
export async function writeFileKeepingLast(file: string, data: string): Promise<void> {
  try {
    const current = await fs.readFile(file, 'utf8');
    JSON.parse(current);
    await writeFileAtomic(`${file}.bak`, current);
  } catch {
    // nothing there yet, or it's damaged
  }
  await writeFileAtomic(file, data);
}

const isJob = (v: unknown): boolean => isObject(v) && typeof (v as Job).name === 'string' && typeof (v as Job).updatedAt === 'string';

export class JobStore {
  private readonly repairs = new Map<string, Promise<Job>>();

  constructor(
    private readonly base: string,
    /** Where backups live (see safety.ts): damaged files are restored from them. */
    private readonly backups?: string,
  ) {}

  private dir(id: string): string {
    return path.join(this.base, checkJobId(id));
  }

  private entryFile(id: string, entry: string): string {
    return path.join(this.dir(id), 'history', `${checkEntryId(entry)}.json`);
  }

  async create(name: string, now = new Date()): Promise<Job> {
    let id = jobIdFor(name, now.toISOString());
    for (let i = 2; await this.exists(id); i++) id = jobIdFor(`${name} ${i}`, now.toISOString());
    const job: Job = { id, name, createdAt: now.toISOString(), updatedAt: now.toISOString(), done: false, prefs: { hide: {}, add: {} } };
    await this.put(job);
    return job;
  }

  async exists(id: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.dir(id), 'job.json'));
      return true;
    } catch {
      return false;
    }
  }

  async get(id: string): Promise<Job> {
    const file = path.join(this.dir(id), 'job.json');
    try {
      const job: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
      if (isJob(job)) return job as Job;
    } catch (e) {
      // No folder at all: there's no such job (a deleted one must stay deleted).
      await fs.access(this.dir(id)).catch(() => {
        throw e;
      });
    }
    // Several readers can find the same damage at once; it's repaired (and reported) once.
    const repairing = this.repairs.get(id) ?? this.repairJob(id, file).finally(() => this.repairs.delete(id));
    this.repairs.set(id, repairing);
    return repairing;
  }

  /** A folder's saves outlive a damaged job.json: its last good copy, or a new one made from the saves. */
  private async repairJob(id: string, file: string): Promise<Job> {
    const restored = recoverJson(file, `jobs/${id}/job.json`, this.backups, isJob);
    if (restored) return restored as Job;
    const dates: string[] = [];
    for (const entry of await this.entryIds(id)) {
      const saved = await this.entry(id, entry).catch(() => null);
      if (typeof saved?.savedAt === 'string') dates.push(saved.savedAt);
    }
    if (!dates.length) throw new Error(`No saves to rebuild ${id} from`);
    dates.sort();
    // The folder's own id holds its name: "climate-essay-3f9a1c".
    const words = id.replace(/-[0-9a-f]{6}$/, '').replace(/-/g, ' ');
    const job: Job = { id, name: words.charAt(0).toUpperCase() + words.slice(1), createdAt: dates[0], updatedAt: dates[dates.length - 1], done: false, prefs: { hide: {}, add: {} } };
    await this.put(job);
    reportDamage(file, true);
    return job;
  }

  async put(job: Job): Promise<void> {
    await writeFileKeepingLast(path.join(this.dir(job.id), 'job.json'), JSON.stringify(job, null, 2));
  }

  /** All jobs, most recently updated first. Unreadable folders are skipped. */
  async list(): Promise<Job[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.base);
    } catch {
      return [];
    }
    const jobs: Job[] = [];
    for (const n of names) {
      try {
        jobs.push(await this.get(n));
      } catch {
        // not a job folder
      }
    }
    return jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** A free entry id for this time (adds -1, -2 when two saves land in the same millisecond). */
  async freeEntryId(jobId: string, date: Date): Promise<string> {
    const base = entryIdFor(date);
    for (let i = 0; i < 100; i++) {
      const id = i === 0 ? base : `${base}-${i}`;
      try {
        await fs.access(this.entryFile(jobId, id));
      } catch {
        return id;
      }
    }
    throw new Error('Could not pick a save name');
  }

  async saveEntry(entry: SaveEntry): Promise<void> {
    await writeFileAtomic(this.entryFile(entry.jobId, entry.id), JSON.stringify(entry, null, 2));
  }

  async entry(jobId: string, id: string): Promise<SaveEntry> {
    const file = this.entryFile(jobId, id);
    // A missing file isn't damage: it was pruned or deleted, and stays that way.
    const text = await fs.readFile(file, 'utf8');
    try {
      const entry: unknown = JSON.parse(text);
      if (isObject(entry)) return entry as SaveEntry;
    } catch {
      // damaged: below
    }
    const restored = recoverJson(file, `jobs/${jobId}/history/${id}.json`, this.backups);
    if (restored) return restored as SaveEntry;
    reportDamage(file, false);
    throw new Error(`Save ${id} is damaged`);
  }

  /** Entry ids, newest first. */
  async entryIds(jobId: string): Promise<string[]> {
    const dir = path.join(this.dir(jobId), 'history');
    try {
      return (await fs.readdir(dir))
        .filter((n) => n.endsWith('.json'))
        .map((n) => n.slice(0, -5))
        .filter((n) => {
          try {
            checkEntryId(n);
            return true;
          } catch {
            return false;
          }
        })
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  async latest(jobId: string): Promise<SaveEntry | null> {
    for (const id of await this.entryIds(jobId)) {
      try {
        return await this.entry(jobId, id);
      } catch {
        // skip a broken file
      }
    }
    return null;
  }

  /** Keep only the newest MAX_HISTORY saves of a job. */
  async prune(jobId: string, keep = MAX_HISTORY): Promise<void> {
    const ids = await this.entryIds(jobId);
    for (const id of ids.slice(keep)) await fs.rm(this.entryFile(jobId, id), { force: true });
  }

  /** Deleted means deleted: it goes from the backups too. */
  async delete(jobId: string): Promise<void> {
    await fs.rm(this.dir(jobId), { recursive: true, force: true });
    if (!this.backups) return;
    const dir = path.basename(this.dir(jobId));
    for (const b of await fs.readdir(this.backups).catch(() => [])) await fs.rm(path.join(this.backups, b, 'jobs', dir), { recursive: true, force: true });
  }

  async deleteAll(): Promise<void> {
    await fs.rm(this.base, { recursive: true, force: true });
    if (this.backups) await fs.rm(this.backups, { recursive: true, force: true });
  }
}
