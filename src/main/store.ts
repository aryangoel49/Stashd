// Saves snapshots as JSON files: <base>/<projectId>/<snapshotId>.json
// Writes are atomic (write a temp file, then rename), so a crash never leaves half a file.

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Snapshot, SnapshotSummary } from '../shared/types';
import { projectId as checkProjectId, snapshotId as checkSnapshotId } from '../shared/validate';

/** A stable, filesystem-safe id for a project folder, like "my-app-3f9a1c". */
export function projectIdFor(folder: string): string {
  const slug = path
    .basename(folder)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'project';
  const hash = createHash('sha256').update(folder).digest('hex').slice(0, 6);
  return `${slug}-${hash}`;
}

export function snapshotIdFor(date: Date): string {
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

export interface PruneOptions {
  count: number;
  days: number;
}

/**
 * Which snapshots to delete. Rules: nothing older than `days`, at most `count` per project,
 * and when over the count, automatic snapshots go before manual ones. The newest snapshot is always kept.
 */
export function planPrune(list: SnapshotSummary[], opts: PruneOptions, now: number): string[] {
  const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (sorted.length === 0) return [];
  const rest = sorted.slice(1); // sorted[0] is the newest and is always kept
  const cutoff = now - opts.days * 86_400_000;
  const del = new Set<string>();
  for (const s of rest) if (Date.parse(s.createdAt) < cutoff) del.add(s.id);
  const remaining = rest.filter((s) => !del.has(s.id));
  let over = remaining.length + 1 - opts.count;
  // Oldest first, automatic ones before manual ones.
  const order = [...remaining.filter((s) => s.auto).reverse(), ...remaining.filter((s) => !s.auto).reverse()];
  for (const s of order) {
    if (over <= 0) break;
    del.add(s.id);
    over--;
  }
  return [...del];
}

export function summarize(s: Snapshot): SnapshotSummary {
  return { id: s.id, projectId: s.projectId, createdAt: s.createdAt, auto: s.auto, trigger: s.trigger, note: s.note };
}

export class SnapshotStore {
  constructor(private readonly base: string) {}

  private dir(projectId: string): string {
    return path.join(this.base, checkProjectId(projectId));
  }

  private file(projectId: string, id: string): string {
    return path.join(this.dir(projectId), `${checkSnapshotId(id)}.json`);
  }

  async save(s: Snapshot): Promise<void> {
    await writeFileAtomic(this.file(s.projectId, s.id), JSON.stringify(s, null, 2));
  }

  /** A free snapshot id for this time (adds -1, -2 when two saves land in the same millisecond). */
  async freeId(projectId: string, date: Date): Promise<string> {
    const base = snapshotIdFor(date);
    for (let i = 0; i < 100; i++) {
      const id = i === 0 ? base : `${base}-${i}`;
      try {
        await fs.access(this.file(projectId, id));
      } catch {
        return id;
      }
    }
    throw new Error('Could not pick a snapshot name');
  }

  async load(projectId: string, id: string): Promise<Snapshot> {
    return JSON.parse(await fs.readFile(this.file(projectId, id), 'utf8')) as Snapshot;
  }

  async list(projectId: string): Promise<SnapshotSummary[]> {
    const dir = this.dir(projectId); // throws on an unsafe id
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    const out: SnapshotSummary[] = [];
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      const id = n.slice(0, -5);
      try {
        out.push(summarize(await this.load(projectId, id)));
      } catch {
        // skip unreadable or hand-edited files
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async latest(projectId: string): Promise<Snapshot | null> {
    const [top] = await this.list(projectId);
    return top ? this.load(projectId, top.id) : null;
  }

  async prune(projectId: string, opts: PruneOptions, now = Date.now()): Promise<string[]> {
    const ids = planPrune(await this.list(projectId), opts, now);
    for (const id of ids) await fs.rm(this.file(projectId, id), { force: true });
    return ids;
  }

  async deleteProject(projectId: string): Promise<void> {
    await fs.rm(this.dir(projectId), { recursive: true, force: true });
  }

  async deleteAll(): Promise<void> {
    await fs.rm(this.base, { recursive: true, force: true });
  }
}
