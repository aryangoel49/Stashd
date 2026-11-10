// Tidy all's "Sort into folders": what's left open that belongs to no folder, split into separate pieces of
// work, so each can become a folder of its own. Two things go together when they mean the same thing (the
// on-device meaning model), share words, sit in the same Chrome tab group, or in the same Finder folder.
// Only real work becomes a folder: something that fits with nothing else (a stray tab, a shop, a feed) or
// is just a site's front page isn't saved anywhere; it closes. Pure: the meaning vectors are passed in.

import os from 'node:os';
import path from 'node:path';
import type { Item } from '../../shared/types';
import { hostOf, isGeneralHost, itemTokens, meaningText, type MeaningLookup } from './relevance';

/** Two things this alike (0 to 1) belong together. Unrelated titles score up to about 0.2 with the meaning model. */
export const LINK = 0.25;
/** Two pieces of work join when each thing in one is, at best, this close to the other (on average). */
const JOIN = 0.14;
/** At most this many new folders from one Tidy all (the biggest pieces of work). */
export const MAX_WORKS = 10;

/** Folders that hold everything (Downloads, Desktop), so sharing them says nothing. */
const GENERAL_DIRS = new Set(['', 'Desktop', 'Documents', 'Downloads'].map((d) => path.join(os.homedir(), d)));

/** Where a document or Finder window lives, if that says something. */
function place(i: Item): string | null {
  if (!i.path || (i.kind !== 'doc' && i.kind !== 'folder')) return null;
  const dir = i.kind === 'folder' ? i.path : path.dirname(i.path);
  return GENERAL_DIRS.has(dir) || dir === '/' ? null : dir;
}

/** Social, shopping and streaming sites: their page titles are vague ("Jobs | LinkedIn"), so meaning alone counts for less. */
const CASUAL = /(^|\.)(linkedin|reddit|facebook|instagram|tiktok|pinterest|netflix|twitch|x|twitter|threads)\.com$|(^|\.)(amazon|ebay)\.[a-z.]+$/;

/** A blank tab or a site's front page (mail.google.com, youtube.com): a place, not a piece of work. */
export function isNoWork(i: Item): boolean {
  if (i.kind !== 'tab') return false;
  if (!i.url) return true;
  try {
    const u = new URL(i.url);
    if (!/^https?:$/.test(u.protocol)) return true;
    return u.pathname.replace(/\/+$/, '') === '' && !u.search;
  } catch {
    return true;
  }
}

/** How alike two things are, 0 to 1. */
export function likeness(a: Item, b: Item, meaning?: MeaningLookup): number {
  const ga = a.group?.trim();
  if (ga && ga === b.group?.trim() && a.browser === b.browser) return 1;
  const pa = place(a);
  const pb = place(b);
  if (pa && pb && (pa === pb || pa.startsWith(pb + path.sep) || pb.startsWith(pa + path.sep))) return 0.8;

  let score = 0;
  const ta = meaningText(a);
  const tb = meaningText(b);
  const va = ta ? meaning?.(ta) : undefined;
  const vb = tb ? meaning?.(tb) : undefined;
  if (va && vb && va.length === vb.length) {
    score = va.reduce((s, x, i) => s + x * vb[i], 0);
    // A one-word title ("Jobs", "Inbox") gives the model too little to go on: it counts for less.
    if (ta!.split(/\s+/).length < 2 || tb!.split(/\s+/).length < 2) score *= 0.6;
    if ([a, b].some((i) => CASUAL.test(hostOf(i) ?? ''))) score *= 0.5;
  }
  // Shared words: two of three words in common is as strong as a close meaning. A single shared word
  // ("jobs") is only a hint.
  const wa = new Set(itemTokens(a));
  const wb = [...new Set(itemTokens(b))];
  const shared = wb.filter((w) => wa.has(w)).length;
  const fewer = Math.min(wa.size, wb.length);
  if (shared >= 2) score = Math.max(score, 0.75 * (shared / fewer));
  else if (shared === 1) score = Math.max(score, 0.2);
  // The same site (not a general one like google.com) is a small nudge, never enough on its own.
  const ha = hostOf(a);
  if (ha && ha === hostOf(b) && !isGeneralHost(ha)) score += 0.15;
  // Tabs in the same browser window lean together a little.
  if (a.kind === 'tab' && b.kind === 'tab' && a.browser === b.browser && a.window != null && a.window === b.window) score += 0.08;
  return Math.min(1, score);
}

/**
 * Splits things into pieces of work (two or more things that belong together), the biggest first, at most
 * MAX_WORKS. Anything that fits with nothing else is left out.
 */
export function sortIntoWorks(all: Item[], meaning?: MeaningLookup): Item[][] {
  const items = all.filter((i) => !isNoWork(i));
  if (items.length < 2) return [];
  const sim = items.map((a, i) => items.map((b, j) => (i === j ? 1 : j < i ? 0 : likeness(a, b, meaning))));
  const like = (i: number, j: number) => (i < j ? sim[i][j] : sim[j][i]);
  // Things clearly alike are linked, and whatever is linked, even through something else, is one piece of work.
  const of = items.map((_, i) => i);
  const root = (i: number): number => (of[i] === i ? i : (of[i] = root(of[i])));
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (like(i, j) >= LINK) of[root(i)] = root(j);
  let groups = [...Map.groupBy(items.keys(), root).values()].filter((g) => g.length >= 2);
  // Two pieces of work that are halves of one (an essay and its research, found apart) join when every
  // thing in one has its closest outside match in the other, close enough on average. A stray tab can't
  // pull two pieces together this way: it never belongs to a piece.
  for (let joined = true; joined; ) {
    joined = false;
    for (const [a, ga] of groups.entries()) {
      const votes = ga.map((i) => {
        let best = { g: -1, score: -1 };
        for (const [b, gb] of groups.entries()) if (b !== a) for (const j of gb) if (like(i, j) > best.score) best = { g: b, score: like(i, j) };
        return best;
      });
      const target = votes[0].g;
      if (target < 0 || votes.some((v) => v.g !== target) || votes.reduce((s, v) => s + v.score, 0) / votes.length < JOIN) continue;
      groups[target] = [...groups[target], ...ga];
      groups = groups.filter((_, k) => k !== a);
      joined = true;
      break;
    }
  }
  return groups
    .sort((x, y) => y.length - x.length || Math.min(...x) - Math.min(...y))
    .slice(0, MAX_WORKS)
    .map((g) => g.sort((x, y) => x - y).map((i) => items[i]));
}
