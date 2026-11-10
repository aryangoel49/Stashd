// Tidy all's "Sort into folders": what's left open that belongs to no folder, split into separate pieces of
// work, so each can become a folder of its own. Two things go together when they mean the same thing (the
// on-device meaning model), share words, sit in the same Chrome tab group, or in the same Finder folder.
// Only real work becomes a folder: something that fits with nothing else (a stray tab, a shop, a feed) or
// is just a site's front page isn't saved anywhere; it closes. Pure: the meaning vectors are passed in.

import os from 'node:os';
import path from 'node:path';
import type { Item } from '../../shared/types';
import { hostOf, itemTokens, meaningText, textTokens, type MeaningLookup } from './relevance';

/** Two things this alike (0 to 1) belong together. Unrelated titles score up to about 0.2 with the meaning model. */
export const LINK = 0.25;
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

/** Error and robot-check pages: what's on them isn't the work. */
const DEAD = /\b(page not found|404|not found|access denied|forbidden|just a moment|attention required|are you a robot|captcha)\b/i;

/** A blank tab, an error page or a site's front page (mail.google.com, youtube.com): not a piece of work. */
export function isNoWork(i: Item): boolean {
  if (i.kind !== 'tab') return false;
  if (!i.url || DEAD.test(i.label)) return true;
  try {
    const u = new URL(i.url);
    if (!/^https?:$/.test(u.protocol)) return true;
    return u.pathname.replace(/\/+$/, '') === '' && !u.search;
  } catch {
    return true;
  }
}

/** The words of a tab's site (en.wikipedia.org: en, wikipedia, org). */
function siteWords(i: Item): string[] {
  return textTokens((hostOf(i) ?? '').replace(/\./g, ' '));
}

/**
 * What the meaning model compares for sorting: the title without the site's name ("Toronto - Wikipedia" is
 * "Toronto"), so two pages of one site don't look alike just for that.
 */
export function sortText(i: Item): string | null {
  const text = meaningText(i);
  if (!text || i.kind !== 'tab') return text;
  const site = new Set(siteWords(i));
  const parts = i.label.split(/\s+[-–—|·•:]\s+/);
  const kept = parts.filter((p) => {
    const w = textTokens(p);
    return !w.length || !w.every((x) => site.has(x));
  });
  if (!kept.length || kept.length === parts.length) return text;
  return meaningText({ ...i, label: kept.join(' - ') });
}

/** How alike two things are, 0 to 1. */
export function likeness(a: Item, b: Item, meaning?: MeaningLookup): number {
  const ga = a.group?.trim();
  if (ga && ga === b.group?.trim() && a.browser === b.browser) return 1;
  const pa = place(a);
  const pb = place(b);
  if (pa && pb && (pa === pb || pa.startsWith(pb + path.sep) || pb.startsWith(pa + path.sep))) return 0.8;

  let score = 0;
  const ta = sortText(a);
  const tb = sortText(b);
  const va = ta ? meaning?.(ta) : undefined;
  const vb = tb ? meaning?.(tb) : undefined;
  if (va && vb && va.length === vb.length) {
    score = va.reduce((s, x, i) => s + x * vb[i], 0);
    if ([a, b].some((i) => CASUAL.test(hostOf(i) ?? ''))) score *= 0.5;
  }
  // Shared words (not the site's own name): two of three in common is as strong as a close meaning. A single
  // shared word ("jobs") is only a hint.
  const site = new Set([...siteWords(a), ...siteWords(b)]);
  const wa = new Set(itemTokens(a).filter((w) => !site.has(w)));
  const wb = [...new Set(itemTokens(b).filter((w) => !site.has(w)))];
  const shared = wb.filter((w) => wa.has(w)).length;
  const fewer = Math.min(wa.size, wb.length);
  if (shared >= 2) score = Math.max(score, 0.75 * (shared / fewer));
  else if (shared === 1) score = Math.max(score, 0.2);
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
  // A link needs both sides to agree: each is among the other's two closest matches. A tab that is
  // vaguely like everything ("Things to do in Toronto" next to "Acme budget") links to nothing new.
  const closest = items.map((_, i) =>
    new Set(
      items
        .map((_, j) => j)
        .filter((j) => j !== i)
        .sort((x, y) => like(i, y) - like(i, x))
        .slice(0, 2),
    ),
  );
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) if (like(i, j) >= LINK && closest[i].has(j) && closest[j].has(i)) of[root(i)] = root(j);
  const groups = [...Map.groupBy(items.keys(), root).values()].filter((g) => g.length >= 2);
  return groups
    .sort((x, y) => y.length - x.length || Math.min(...x) - Math.min(...y))
    .slice(0, MAX_WORKS)
    .map((g) => g.sort((x, y) => x - y).map((i) => items[i]));
}
