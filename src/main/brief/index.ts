// Picks who writes the brief: your own Claude key (if you added one), then Stashd AI, then the basic template.

import type { Brief, Item, SaveEntry } from '../../shared/types';
import { basicBrief } from './basic';
import type { SortFolder } from '../jobs/sortai';

export interface BriefWriter {
  name: 'claude' | 'stashd';
  /** Returns null when this writer is not set up (no key, or Stashd AI turned off). Throws on failure. */
  write(entry: SaveEntry, previous: SaveEntry | null, feedback: string | null): Promise<Brief | null>;
  /** A short name for a new job from its items, or null when this writer is not set up. */
  suggestName(items: Item[]): Promise<string | null>;
  /** Smart Tidy all: what's open, sorted into named pieces of work, or null when this writer is not set up. Throws on failure. */
  sortWork(items: Item[], folders?: SortFolder[]): Promise<AiPiece[] | null>;
  /** ⌃S: the answer to a place request (see jobs/placeai.ts) as parsed JSON, or null when this writer is not set up. Throws on failure. */
  place(content: string): Promise<unknown | null>;
}

export interface AiPiece {
  name: string;
  items: Item[];
  /** The folder you already have that this piece belongs to; a new folder when absent. */
  jobId?: string;
}

/** Ask the writers to sort what's open into pieces of work; null if none is set up or they all fail. */
export async function aiSortWork(writers: BriefWriter[], items: Item[], folders: SortFolder[] = []): Promise<AiPiece[] | null> {
  for (const w of writers) {
    try {
      const pieces = await w.sortWork(items, folders);
      if (pieces) return pieces;
    } catch {
      // try the next one
    }
  }
  return null;
}

/** Ask the writers which work a save is and what's part of it; null if none is set up or they all fail. */
export async function aiPlace(writers: BriefWriter[], content: string): Promise<unknown | null> {
  for (const w of writers) {
    try {
      const answer = await w.place(content);
      if (answer) return answer;
    } catch {
      // try the next one
    }
  }
  return null;
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
      reasons.push(`${w.name === 'claude' ? 'Claude' : 'Stashd AI'}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const b = basicBrief(entry);
  return reasons.length ? { ...b, fallbackReason: reasons.join(' ') } : b;
}
