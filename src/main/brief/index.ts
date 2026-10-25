// Picks who writes the brief: Claude (if connected), then Apple Intelligence, then the basic template.

import type { Brief, Item, SaveEntry } from '../../shared/types';
import { basicBrief } from './basic';

export interface BriefWriter {
  name: 'claude' | 'apple';
  /** Returns null when this writer is not set up (no key, no Apple Intelligence). Throws on failure. */
  write(entry: SaveEntry, previous: SaveEntry | null, feedback: string | null): Promise<Brief | null>;
  /** A short name for a new job from its items, or null when this writer is not set up. */
  suggestName(items: Item[]): Promise<string | null>;
}

/** Ask the writers for a job name; null if none is set up or they all fail. */
export async function aiJobName(writers: BriefWriter[], items: Item[]): Promise<string | null> {
  for (const w of writers) {
    try {
      const n = await w.suggestName(items);
      if (n) return n;
    } catch {
      // try the next one
    }
  }
  return null;
}

export async function writeBrief(
  writers: BriefWriter[],
  entry: SaveEntry,
  previous: SaveEntry | null,
  feedback: string | null,
): Promise<Brief> {
  const reasons: string[] = [];
  for (const w of writers) {
    try {
      const b = await w.write(entry, previous, feedback);
      if (b) return reasons.length ? { ...b, fallbackReason: reasons.join(' ') } : b;
    } catch (e) {
      reasons.push(`${w.name === 'claude' ? 'Claude' : 'Apple Intelligence'}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const b = basicBrief(entry);
  return reasons.length ? { ...b, fallbackReason: reasons.join(' ') } : b;
}
