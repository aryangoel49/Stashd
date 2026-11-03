// Notices when you open something yourself that's in a packed folder (a tab you saved, a document)
// and offers to Unpack the rest. Only exact matches count, never "looks similar". What Stashd
// opened itself (Unpack, Undo, clicking a card) never counts, and nor does a folder that's already open.

import { powerMonitor } from 'electron';
import type { Item, Job, OpenState, SaveEntry } from '../shared/types';
import { openedRecently } from './open';
import { matchKeys } from './urls';

/** How often to look, and how long after Stashd opened something to wait before looking again. */
const EVERY_MS = 20_000;
const AFTER_OPENING_MS = 20_000;
/** Once a folder has been offered, it isn't offered again for a while. */
const ASK_AGAIN_MS = 4 * 60 * 60_000;

export interface PackedWork {
  jobId: string;
  name: string;
  /** What you opened that's in the folder. */
  opened: Item[];
  /** How many more of its tabs and files are packed. */
  more: number;
}

/**
 * The packed folder that something you just opened belongs to, if any. A folder counts as packed when
 * nothing of it was open apart from what you just opened, and it has more to bring back.
 */
export function packedWorkFor(
  justOpened: Set<string>,
  jobs: Job[],
  latest: (SaveEntry | null)[],
  state: Record<string, OpenState>,
  askedAt: Map<string, number>,
  now = Date.now(),
): PackedWork | null {
  let best: PackedWork | null = null;
  for (const [n, job] of jobs.entries()) {
    if (job.done || now - (askedAt.get(job.id) ?? 0) < ASK_AGAIN_MS) continue;
    const content = (latest[n]?.items ?? []).filter((i) => i.kind !== 'app');
    const opened = content.filter((i) => matchKeys(i).some((k) => justOpened.has(k)));
    const s = state[job.id];
    if (!opened.length || !s || s.open > opened.length) continue;
    const more = content.length - opened.length;
    if (more < 1) continue;
    if (!best || opened.length > best.opened.length) best = { jobId: job.id, name: job.name, opened, more };
  }
  return best;
}

export class Noticer {
  private seen: Set<string> | null = null;
  private askedAt = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private readonly look: () => Promise<{ open: Set<string>; state: Record<string, OpenState>; jobs: Job[]; latest: (SaveEntry | null)[] }>,
    private readonly offer: (work: PackedWork) => void,
    /** True while the save box is up: never interrupt a save. */
    private readonly saving: () => boolean,
  ) {}

  start(): void {
    this.timer ??= setInterval(() => void this.tick(), EVERY_MS);
  }

  /** You said no (or yes): don't bring this folder up again for a while. */
  answered(jobId: string): void {
    this.askedAt.set(jobId, Date.now());
  }

  async tick(): Promise<void> {
    // Away from the Mac: don't spend battery looking.
    if (this.busy || powerMonitor.getSystemIdleTime() > 120) return;
    this.busy = true;
    try {
      const look = await this.look();
      const before = this.seen;
      this.seen = look.open;
      // The first look, and anything that appeared while Stashd was opening things, is only remembered.
      if (!before || openedRecently(AFTER_OPENING_MS) || this.saving()) return;
      const fresh = new Set([...look.open].filter((k) => !before.has(k)));
      if (!fresh.size) return;
      const work = packedWorkFor(fresh, look.jobs, look.latest, look.state, this.askedAt);
      if (!work) return;
      this.answered(work.jobId);
      this.offer(work);
    } catch {
      // can't tell what's open right now: look again next time
    } finally {
      this.busy = false;
    }
  }
}
