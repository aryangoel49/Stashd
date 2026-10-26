// Suggestions: folders that are really one piece of work, and things saved in the wrong folder.
// Pure functions on top of the relevance engine (relevance.ts), so they work with word matching alone
// and get better when the on-device meaning model is available. Nothing here changes anything:
// it only proposes, and the person accepts or dismisses each suggestion.

import type { Item, Suggestion } from '../../shared/types';
import { documentFrequency, jobProfile, LIKELY, meaningText, scoreItem, SURE, textTokens, type MeaningLookup } from './relevance';

export interface FolderData {
  id: string;
  name: string;
  note: string;
  items: Item[];
}

/** Share of the smaller folder's items that are also in the other one, at which two folders are one. */
const MERGE_OVERLAP = 0.5;
/** Average fit of each folder's items to the other folder, at which two folders look like one. */
const MERGE_FIT = 1.2;
/** A stray item must fit another folder this much better than its own. */
const MOVE_MARGIN = 1.0;

/**
 * Enough evidence to propose something: the same meaning, the same site or file folder, or at least
 * two shared words. One shared word ("summary") is a coincidence, not a reason.
 */
function strongReason(why: string[]): boolean {
  return why.some((w) => /similar topic|about the same thing|same site|same folder|in both/.test(w) || (w.startsWith('mentions ') && w.includes(',')));
}

const contentOf = (items: Item[]) => items.filter((i) => i.kind !== 'app' && !i.untitled);

export function mergeId(a: string, b: string): string {
  return `merge:${[a, b].sort().join('|')}`;
}

export function moveId(itemKey: string, to: string): string {
  return `move:${to}|${itemKey}`;
}

/** Mean score of `items` against a folder's profile, each capped so one exact match can't carry it. */
function meanFit(items: Item[], target: FolderData, df: Map<string, number>, meaning?: MeaningLookup): { fit: number; why: string[] } {
  const p = jobProfile(target.name, target.note, contentOf(target.items));
  const why = new Map<string, number>();
  let total = 0;
  for (const it of items) {
    const s = scoreItem(it, p, df, null, meaning);
    total += Math.max(0, Math.min(s.score, 3));
    for (const w of s.why) if (w !== 'was in this job') why.set(w, (why.get(w) ?? 0) + 1);
  }
  const top = [...why.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
  return { fit: items.length ? total / items.length : 0, why: top };
}

function sharedNameWords(a: string, b: string): string[] {
  const bt = new Set(textTokens(b));
  return [...new Set(textTokens(a))].filter((t) => bt.has(t));
}

/**
 * Up to `limit` suggestions, most confident first. `dismissed` holds suggestion ids the person said no
 * to; they are never proposed again (until that dismissal runs out, which the caller decides).
 */
export function suggest(folders: FolderData[], opts: { meaning?: MeaningLookup; dismissed?: Set<string>; limit?: number } = {}): Suggestion[] {
  const { meaning, dismissed = new Set(), limit = 3 } = opts;
  const out: Suggestion[] = [];
  const df = documentFrequency(folders.flatMap((f) => contentOf(f.items)));

  // ---------- folders that are one piece of work ----------
  const merged = new Set<string>();
  for (let i = 0; i < folders.length; i++) {
    for (let j = i + 1; j < folders.length; j++) {
      const a = folders[i];
      const b = folders[j];
      const ai = contentOf(a.items);
      const bi = contentOf(b.items);
      if (!ai.length || !bi.length) continue;
      const id = mergeId(a.id, b.id);
      if (dismissed.has(id)) continue;
      const bKeys = new Set(bi.map((x) => x.key));
      const shared = ai.filter((x) => bKeys.has(x.key)).length;
      const overlap = shared / Math.min(ai.length, bi.length);
      const ab = meanFit(ai, b, df, meaning);
      const ba = meanFit(bi, a, df, meaning);
      const fit = Math.min(ab.fit, ba.fit);
      const names = sharedNameWords(a.name, b.name);
      if (overlap < MERGE_OVERLAP && !(fit >= MERGE_FIT && (names.length > 0 || fit >= MERGE_FIT * 1.5) && strongReason([...ab.why, ...ba.why]))) continue;
      // The smaller folder goes into the bigger one.
      const [from, into] = ai.length <= bi.length ? [a, b] : [b, a];
      const why = [
        ...(shared ? [`${shared} ${shared === 1 ? 'thing' : 'things'} in both`] : []),
        ...(names.length ? [`both about ${names.slice(0, 2).join(' and ')}`] : []),
        ...[...new Set([...ab.why, ...ba.why])].filter((w) => !w.startsWith('mentions')).slice(0, 2),
      ];
      out.push({ kind: 'merge', id, from: from.id, fromName: from.name, into: into.id, intoName: into.name, score: overlap * 3 + fit, why });
      merged.add(a.id);
      merged.add(b.id);
    }
  }

  // ---------- things saved in the wrong folder ----------
  for (const f of folders) {
    if (merged.has(f.id)) continue; // a merge suggestion already covers this folder
    const items = contentOf(f.items);
    if (items.length < 3) continue; // too little to say what the folder is about
    for (const it of items) {
      if (!meaningText(it)) continue;
      // How well it fits its own folder, judged without itself.
      const own = scoreItem(it, jobProfile(f.name, f.note, items.filter((x) => x.key !== it.key)), df, null, meaning).score;
      if (own >= LIKELY) continue;
      let best: { to: FolderData; score: number; why: string[] } | null = null;
      for (const g of folders) {
        if (g.id === f.id || merged.has(g.id) || g.items.some((x) => x.key === it.key)) continue;
        const s = scoreItem(it, jobProfile(g.name, g.note, contentOf(g.items)), df, null, meaning);
        if (s.score >= SURE && s.score >= own + MOVE_MARGIN && strongReason(s.why) && (!best || s.score > best.score)) best = { to: g, score: s.score, why: s.why };
      }
      if (!best) continue;
      const id = moveId(it.key, best.to.id);
      if (dismissed.has(id)) continue;
      out.push({ kind: 'move', id, itemKey: it.key, itemLabel: it.label, item: it, from: f.id, fromName: f.name, to: best.to.id, toName: best.to.name, score: best.score - own, why: best.why.slice(0, 2) });
    }
  }

  return out.sort((x, y) => y.score - x.score).slice(0, limit);
}
