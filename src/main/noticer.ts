// Notices when you open something yourself that's in a packed folder (a tab you saved, a document)
// and offers to Unpack the rest. Only exact matches count, never "looks similar". What Stashd
// opened itself (Unpack, Undo, clicking a card) never counts, and nor does a folder that's already open.

import { powerMonitor } from 'electron';
import type { Item, Job, OpenState, SaveEntry } from '../shared/types';
import { openedRecently } from './open';
import { isBreakItem } from './breaks';
import { looseKey, matchKeys } from './urls';

/** How often to look, and how long after Stashd opened something to wait before looking again. */
const EVERY_MS = 20_000;
/** Looking asks every browser and document app what it has open, which takes far longer on an older (Intel)
 *  Mac and briefly holds up the browser it asks. So looking never takes more than about 2% of the time: a
 *  look that took 2 s waits 100 s before the next, never more than LONGEST_WAIT_MS. */
const LONGEST_WAIT_MS = 2 * 60_000;
export function nextLookIn(lookMs: number): number {
  return Math.min(LONGEST_WAIT_MS, Math.max(EVERY_MS, lookMs * 50));
}
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

/** Videos and shows open right now (not a site's home page), by loose key. */
export function openBreaks(items: Item[]): Map<string, Item> {
  const out = new Map<string, Item>();
  for (const i of items) {
    if (!isBreakItem(i)) continue;
    try {
      if (new URL(i.url!).pathname.replace(/\/+$/, '') === '') continue;
    } catch {
      continue;
    }
    out.set(looseKey(i), i);
  }
  return out;
}

export class Noticer {
  private seen: Set<string> | null = null;
  private watching: Map<string, Item> | null = null;
  private askedAt = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  /** How long the last look took. */
  private lookMs = 0;

  constructor(
    private readonly look: () => Promise<{ open: Set<string>; state: Record<string, OpenState>; jobs: Job[]; latest: (SaveEntry | null)[]; items?: Item[] }>,
    private readonly offer: (work: PackedWork) => void,
    /** True while the save box is up: never interrupt a save. */
    private readonly saving: () => boolean,
    /** Videos you closed since the last look: they go to Continue watching. */
    private readonly closedBreaks: (items: Item[]) => void = () => undefined,
  ) {}

  start(): void {
    if (this.timer) return;
    const next = () => {
      this.timer = setTimeout(() => void this.tick().finally(next), nextLookIn(this.lookMs));
    };
    next();
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
      const started = Date.now();
      const look = await this.look();
      this.lookMs = Date.now() - started;
      // A video that was open and now isn't: you closed it (or Tidy all did). Either way it goes to
      // Continue watching, at the top; you remove it there when you're done with it.
      if (look.items) {
        const now = openBreaks(look.items);
        const gone = this.watching ? [...this.watching].filter(([k]) => !now.has(k)).map(([, i]) => i) : [];
        this.watching = now;
        if (gone.length) this.closedBreaks(gone);
      }
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

/** An app you haven't switched to in this long counts as sitting unused. */
const DORMANT_MS = 45 * 60_000;
/** The nudge comes at most this often. */
const NUDGE_EVERY_MS = 3 * 60 * 60_000;
/** Never counted as unused: they're meant to stay open. */
const ALWAYS_OPEN = ['Finder', 'Stashd', 'Electron', 'Claude'];

/**
 * Apps with windows open that you haven't switched to for a while (a video you finished, a document you
 * forgot). `lastFront` holds when each app was last in front; apps first seen count from then.
 */
export function dormantApps(withWindows: string[], lastFront: Map<string, number>, everyday: string[], now = Date.now()): string[] {
  const skip = new Set([...ALWAYS_OPEN, ...everyday].map((a) => a.toLowerCase()));
  return withWindows.filter((a) => !skip.has(a.toLowerCase()) && now - (lastFront.get(a) ?? now) >= DORMANT_MS);
}

/** Watches which app is in front, and nudges you to Tidy all when things sit unused. */
export class DormantWatcher {
  private lastFront = new Map<string, number>();
  private nudgedAt = Date.now() - NUDGE_EVERY_MS + DORMANT_MS;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly windows: () => Promise<{ front: string | null; apps: { name: string }[]; order: string[] }>,
    private readonly everyday: () => string[],
    private readonly nudge: (apps: string[]) => void,
    private readonly busy: () => boolean,
  ) {}

  start(): void {
    this.timer ??= setInterval(() => void this.tick(), 30_000);
  }

  async tick(now = Date.now()): Promise<void> {
    if (powerMonitor.getSystemIdleTime() > 120) return;
    const win = await this.windows().catch(() => null);
    if (!win) return;
    const regular = new Set(win.apps.map((a) => a.name));
    const open = win.order.filter((n) => regular.has(n));
    for (const a of open) if (!this.lastFront.has(a)) this.lastFront.set(a, now);
    if (win.front) this.lastFront.set(win.front, now);
    if (now - this.nudgedAt < NUDGE_EVERY_MS || this.busy()) return;
    const idle = dormantApps(open, this.lastFront, this.everyday(), now);
    if (!idle.length) return;
    this.nudgedAt = now;
    this.nudge(idle);
  }
}
