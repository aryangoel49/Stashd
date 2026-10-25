// Saves jobs as JSON files:
//   <base>/<jobId>/job.json             name, dates, learned preferences
//   <base>/<jobId>/history/<id>.json    one file per save
// Writes are atomic (write a temp file, then rename), so a crash never leaves half a file.

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Job, SaveEntry } from '../shared/types';
import { entryId as checkEntryId, jobId as checkJobId } from '../shared/validate';

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

export async function writeFileAtomic(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fh = await fs.open(tmp, 'w', 0o600);
  try {
    await fh.writeFile(data, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fs.rename(tmp, file);
}

export class JobStore {
  constructor(private readonly base: string) {}

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
    return JSON.parse(await fs.readFile(path.join(this.dir(id), 'job.json'), 'utf8')) as Job;
  }

  async put(job: Job): Promise<void> {
    await writeFileAtomic(path.join(this.dir(job.id), 'job.json'), JSON.stringify(job, null, 2));
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
    return JSON.parse(await fs.readFile(this.entryFile(jobId, id), 'utf8')) as SaveEntry;
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

  async delete(jobId: string): Promise<void> {
    await fs.rm(this.dir(jobId), { recursive: true, force: true });
  }

  async deleteAll(): Promise<void> {
    await fs.rm(this.base, { recursive: true, force: true });
  }
}
