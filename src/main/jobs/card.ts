// A folder's project card: what the project is about, seen across all of its saves, not just the last one.
// Its key names (words that keep coming back), its websites and its folders on your Mac. Built from the
// folder's history, and you can add names or take them out. Ctrl+S matches new things against this card,
// so a page about the project counts even if nothing like it was in the latest save.

import type { Item, ProjectCard } from '../../shared/types';
import { hostOf, isGeneralHost, itemTokens, textTokens } from './relevance';

const MAX_NAMES = 8;
const MAX_SITES = 6;
const MAX_PLACES = 4;

function top(counts: Map<string, number>, n: number, min = 1): string[] {
  return [...counts.entries()]
    .filter(([, c]) => c >= min)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([k]) => k);
}

/** The card for a folder, from its name and everything it has ever held (each save's items). */
export function buildCard(name: string, saves: Item[][], edits: { add?: string[]; hide?: string[] } = {}): ProjectCard {
  const hide = new Set((edits.hide ?? []).map((h) => h.toLowerCase()));
  const seen = new Map<string, Item>();
  for (const items of saves) for (const it of items) if (!seen.has(it.key)) seen.set(it.key, it);
  const items = [...seen.values()];

  // Names: words that come back across several things (or are in the folder's name).
  const own = new Set(textTokens(name));
  const words = new Map<string, number>();
  for (const it of items) for (const t of itemTokens(it)) if (t.length >= 3) words.set(t, (words.get(t) ?? 0) + 1);
  for (const t of own) words.set(t, (words.get(t) ?? 0) + 3);
  const names = top(new Map([...words].filter(([w, c]) => (c >= 2 || own.has(w)) && !hide.has(w))), MAX_NAMES);

  const sites = new Map<string, number>();
  const places = new Map<string, number>();
  for (const it of items) {
    const h = hostOf(it);
    if (h && !isGeneralHost(h)) sites.set(h, (sites.get(h) ?? 0) + 1);
    if (it.path && (it.kind === 'doc' || it.kind === 'folder')) {
      const dir = it.kind === 'folder' ? it.path : it.path.split('/').slice(0, -1).join('/');
      if (dir) places.set(dir, (places.get(dir) ?? 0) + 1);
    }
  }
  return {
    names,
    added: (edits.add ?? []).filter((a) => a.trim()).slice(0, 12),
    sites: top(new Map([...sites].filter(([s]) => !hide.has(s))), MAX_SITES),
    places: top(new Map([...places].filter(([p]) => !hide.has(p.toLowerCase()))), MAX_PLACES),
  };
}
