// Exactly what the AI is sent (what it is told lives in spec.ts, shared with Stashd's server).
// It sends names, titles, scrubbed addresses, your note and the end of an open Claude chat (secrets removed).
// Never file contents.

import type { SaveEntry } from '../../shared/types';
import { redactCommand, redactUrlString } from '../redact';
import { neededItems } from './basic';

export { INSTRUCTIONS, NAME_INSTRUCTIONS, NAME_SCHEMA, OUTPUT_SCHEMA } from './spec';

export interface PromptData {
  payload: Record<string, unknown>;
  idToKey: Map<string, string>;
  fallbackNeeded: string[];
}

/** Build the data sent to the model. Items get short ids (i1, i2…) instead of paths. */
export function buildPromptData(entry: SaveEntry, previous: SaveEntry | null, feedback: string | null): PromptData {
  const idToKey = new Map<string, string>();
  const trail = new Map((entry.trail ?? []).map((t) => [t.key, t]));
  const items = entry.items.slice(0, 80).map((it, n) => {
    const id = `i${n + 1}`;
    idToKey.set(id, it.key);
    const base: Record<string, unknown> = { id, kind: it.kind, name: redactCommand(it.label), app: it.app };
    // A PDF from this Mac opened in the browser: only its file name, never the path.
    if (it.url?.startsWith('file:')) base.address = decodeURIComponent(it.url.split('/').pop() ?? '').slice(0, 200);
    else if (it.url) base.address = redactUrlString(it.url).slice(0, 200);
    if (it.kind === 'doc' && it.detail && !it.untitled) base.folder = it.detail;
    if (it.untitled) base.unsaved = true;
    if (it.active) base.activeInItsWindow = true;
    if (it.key === entry.frontKey) base.inFrontWhenSaved = true;
    if (it.notOpen) base.notOpenWhenSaved = true;
    if (it.chat?.excerpt) base.chatEnd = it.chat.excerpt.slice(-1200);
    // Where the time went before the save (minutes only; see trail.ts).
    const t = trail.get(it.key);
    if (t) {
      base.minutesInFront = t.minutes;
      base.lastInFrontMinutesAgo = t.minutesAgo;
    }
    return base;
  });

  const payload: Record<string, unknown> = {
    savedAt: entry.savedAt,
    note: redactCommand(entry.note) || null,
    appsFrontToBack: entry.appOrder.slice(0, 8),
    items,
  };
  if (previous) {
    const prevKeys = new Set(previous.items.map((i) => i.key));
    const nowKeys = new Set(entry.items.map((i) => i.key));
    payload.sinceLastSave = {
      lastSavedAt: previous.savedAt,
      lastNote: redactCommand(previous.note) || null,
      newItems: entry.items.filter((i) => !prevKeys.has(i.key)).slice(0, 15).map((i) => redactCommand(i.label)),
      closedItems: previous.items.filter((i) => !nowKeys.has(i.key)).slice(0, 15).map((i) => redactCommand(i.label)),
    };
  }
  if (feedback) payload.feedbackOnLastBrief = redactCommand(feedback).slice(0, 300);
  return { payload, idToKey, fallbackNeeded: neededItems(entry) };
}

export function namePayload(items: SaveEntry['items']): string {
  return JSON.stringify({
    titles: items
      .filter((i) => i.kind !== 'app')
      .slice(0, 40)
      .map((i) => ({ kind: i.kind, title: redactCommand(i.label).slice(0, 140) })),
  });
}

/** Clean a model's suggested name, or null if it's unusable. */
export function cleanAiName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const n = raw.replace(/["“”'`]/g, '').replace(/[.!?]+$/, '').replace(/\s+/g, ' ').trim();
  if (n.length < 2 || n.length > 60 || n.split(' ').length > 6) return null;
  return n.charAt(0).toUpperCase() + n.slice(1);
}
