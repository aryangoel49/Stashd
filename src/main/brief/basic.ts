// The brief, without AI: a short plain sentence from a template. Always works, offline.
// Also holds the shared pieces every brief uses: which items are "needed", and checking
// an AI's answer before showing it.

import type { Brief, Item, SaveEntry } from '../../shared/types';
import { words } from '../jobs/match';

function an(item: Item): string {
  if (item.kind === 'tab') return `"${trim(item.label, 60)}" in ${item.app.replace('Google ', '')}`;
  if (item.kind === 'folder') return `the ${item.label} folder`;
  if (item.kind === 'app') return item.app;
  return item.label;
}

function trim(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** What "Pick up where I left off" opens: the front item, the active tabs, and anything the note mentions. */
export function neededItems(entry: Pick<SaveEntry, 'items' | 'frontKey' | 'note'>, max = 6): string[] {
  const out: string[] = [];
  const add = (k: string | null | undefined) => {
    if (k && !out.includes(k) && out.length < max) out.push(k);
  };
  add(entry.frontKey);
  const noteWords = words(entry.note);
  for (const it of entry.items) if (noteWords.size && [...words(it.label)].some((w) => noteWords.has(w))) add(it.key);
  for (const it of entry.items) if (it.kind === 'doc' && !it.untitled) add(it.key);
  for (const it of entry.items) if (it.kind === 'tab' && it.active) add(it.key);
  if (!out.length) for (const it of entry.items.slice(0, 3)) add(it.key);
  return out;
}

/** ", for about 25 minutes": how long the thing you were last on was in front, when the save's trail says. */
function lastOnFor(entry: SaveEntry, front: Item): string {
  const minutes = entry.trail?.find((t) => t.key === front.key)?.minutes ?? 0;
  return minutes >= 5 ? `, for about ${minutes >= 60 ? `${Math.round(minutes / 30) / 2} hours` : `${Math.round(minutes / 5) * 5} minutes`}` : '';
}

export function basicBrief(entry: SaveEntry, now = new Date()): Brief {
  const front = entry.items.find((i) => i.key === entry.frontKey) ?? entry.items[0];
  const tabs = entry.items.filter((i) => i.kind === 'tab').length;
  const docs = entry.items.filter((i) => i.kind === 'doc').length;
  const highlights: string[] = [];
  let sentence: string;
  if (front) {
    const name = an(front);
    highlights.push(name);
    const others: string[] = [];
    const otherDocs = docs - (front.kind === 'doc' ? 1 : 0);
    const otherTabs = tabs - (front.kind === 'tab' ? 1 : 0);
    if (otherDocs > 0) others.push(plural(otherDocs, 'other file'));
    if (otherTabs > 0) others.push(plural(otherTabs, 'other tab'));
    sentence = `You were last on ${name}${others.length ? `, with ${others.join(' and ')} open` : ''}.`;
  } else {
    sentence = 'Nothing was open when you saved this.';
  }
  if (entry.note) {
    const n = trim(entry.note.replace(/\s+/g, ' '), 140);
    sentence += ` Your note: ${n.endsWith('.') ? n : `${n}.`}`;
  }
  const sections = front
    ? {
        lastOn: trim(an(front), 90) + lastOnFor(entry, front),
        ...(tabs + docs > 1 ? { soFar: `${[docs && plural(docs, 'file'), tabs && plural(tabs, 'tab')].filter(Boolean).join(' and ')} saved.` } : {}),
        ...(entry.note ? { next: trim(entry.note.replace(/\s+/g, ' '), 140) } : {}),
      }
    : undefined;
  // With sections, the headline stays short: the details are in Last on, So far and Next.
  if (sections) sentence = 'Here is where you left off.';
  return { source: 'basic', sentence, ...(sections ? { sections } : {}), highlights, needed: neededItems(entry), createdAt: now.toISOString() };
}

/** Clean up and check an AI's answer. Returns null if it's unusable. */
export function acceptAiBrief(
  raw: unknown,
  idToKey: Map<string, string>,
  source: 'claude',
  fallbackNeeded: string[],
  now = new Date(),
): Brief | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { sentence?: unknown; lastOn?: unknown; soFar?: unknown; next?: unknown; highlights?: unknown; needed?: unknown };
  if (typeof r.sentence !== 'string') return null;
  const clean = (v: unknown) =>
    typeof v === 'string'
      ? v
          .replace(/\s*[—–]\s*/g, ', ')
          .replace(/\s+/g, ' ')
          .replace(/^(last on|so far|next( up)?)\s*:\s*/i, '')
          .trim()
          .slice(0, 240)
      : '';
  const sentence = clean(r.sentence);
  if (sentence.length < 8) return null;
  const lastOn = clean(r.lastOn);
  const sections = lastOn ? { lastOn, ...(clean(r.soFar) ? { soFar: clean(r.soFar) } : {}), ...(clean(r.next) ? { next: clean(r.next) } : {}) } : undefined;
  const allText = [sentence, lastOn, clean(r.soFar), clean(r.next)].join(' ');
  const highlights = Array.isArray(r.highlights)
    ? r.highlights.filter((h): h is string => typeof h === 'string' && h.length > 1 && allText.includes(h)).slice(0, 3)
    : [];
  const needed = Array.isArray(r.needed)
    ? [...new Set(r.needed.filter((id): id is string => typeof id === 'string').map((id) => idToKey.get(id)).filter((k): k is string => !!k))].slice(0, 8)
    : [];
  return { source, sentence, ...(sections ? { sections } : {}), highlights, needed: needed.length ? needed : fallbackNeeded, createdAt: now.toISOString() };
}
