// Where your time went: what was in front each time Stashd looked at your desk (about every 20 seconds),
// kept in memory for a few hours and never written down as it is. A save keeps only the summary for its own
// things: about how many minutes each was in front, and how long ago. That lets the brief say what you were
// really doing ("mostly the essay draft, checking two sources") from titles and minutes alone. No page
// contents are ever read, and nothing here leaves the Mac unless you turned Stashd AI on (then: the minutes).

import type { Item, TrailStep } from '../shared/types';
import { matchKeys } from './urls';

/** One look: the thing in front (its loose key) and when. */
export interface Look {
  loose: string;
  at: number;
}

/** How far back the trail goes. */
export const TRAIL_MS = 3 * 60 * 60_000;
/** A look counts for at most this long: longer gaps mean Stashd wasn't looking (asleep, or away). */
const GAP_MS = 150_000;
const MAX_STEPS = 8;

/** Adds a look and drops what's older than the trail goes back. */
export function addLook(looks: Look[], loose: string, at: number): Look[] {
  return [...looks.filter((l) => at - l.at < TRAIL_MS), { loose, at }];
}

/** For these items (a save's): minutes in front over the last few hours, most recently looked at first. */
export function trailOf(looks: Look[], items: Item[], now: number): TrailStep[] {
  const keyOf = new Map<string, string>();
  for (const i of items) for (const k of matchKeys(i)) if (!keyOf.has(k)) keyOf.set(k, i.key);
  const ms = new Map<string, number>();
  const lastAt = new Map<string, number>();
  const recent = looks.filter((l) => now - l.at < TRAIL_MS).sort((a, b) => a.at - b.at);
  for (const [n, l] of recent.entries()) {
    const key = keyOf.get(l.loose);
    if (!key) continue;
    const dt = Math.max(0, Math.min((recent[n + 1]?.at ?? now) - l.at, GAP_MS));
    ms.set(key, (ms.get(key) ?? 0) + dt);
    lastAt.set(key, l.at + dt);
  }
  return [...ms.entries()]
    .filter(([, t]) => t >= 30_000)
    .sort((a, b) => lastAt.get(b[0])! - lastAt.get(a[0])!)
    .slice(0, MAX_STEPS)
    .map(([key, t]) => ({ key, minutes: Math.max(1, Math.round(t / 60_000)), minutesAgo: Math.max(0, Math.round((now - lastAt.get(key)!) / 60_000)) }));
}
