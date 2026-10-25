// Picks who writes the brief: Claude (if connected), then Apple Intelligence, then the basic template.

import type { Brief, SaveEntry } from '../../shared/types';
import { basicBrief } from './basic';

export interface BriefWriter {
  name: 'claude' | 'apple';
  /** Returns null when this writer is not set up (no key, no Apple Intelligence). Throws on failure. */
  write(entry: SaveEntry, previous: SaveEntry | null, feedback: string | null): Promise<Brief | null>;
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
