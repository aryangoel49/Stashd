// What the AI is told, and exactly what it is sent. Shared by Claude and Apple Intelligence.
// It sends names, titles, scrubbed addresses, your note and the end of an open Claude chat (secrets removed).
// Never file contents.

import type { SaveEntry } from '../../shared/types';
import { redactCommand, redactUrlString } from '../redact';
import { neededItems } from './basic';

export const INSTRUCTIONS = `You write a tiny "welcome back" brief for someone returning to a piece of work on their Mac.
You get a list of what they had open when they saved (files, browser tabs, apps, AI chats), which item was in front (the last thing they were on), their own note, and sometimes what changed since their previous save.

Write ONE or TWO short sentences, at most 45 words, that tell them where they left off and what to do next.

Voice: a sharp, well-read colleague with a dry sense of humour. The brief is useful first and charming second.
- Lead with the facts: what they were on last, by its plain name, and how far it got.
- End with the natural next step. If their note says what was next, use it.
- Add ONE light touch of personality: a wry turn of phrase, a vivid verb, or a gentle nudge. Never a joke that makes the facts harder to follow.
- Confident and warm, not silly. No slang, no "lol", no puns on people's names, no teasing the person, no exclamation marks, no emoji.
- Use everyday words. No jargon, no "resources", no "context", no "dive in", no "journey".

Examples of the voice (the content is made up, never reuse it):
- "Your climate essay stopped mid-argument, with three tabs of carbon-tax evidence waiting in the wings. Next up is the counterargument your note promised."
- "The Lisbon trip is mostly sorted: flights picked and an Alfama flat shortlisted. All that's left is the hard part, deciding what to eat."
- "You and Claude agreed to trim travel to $2,000, so the grant budget is one number away. Get Priya's final figures and it's done."

Rules:
- Only use facts from the data. Never invent progress, deadlines, or contents of files. If unsure, say less, and skip the joke before you skip a fact.
- An item may have "chatEnd": the last part of a chat they were having with an AI assistant about this work. Use it to say what they were figuring out or what was decided. Don't quote it.
- No em dashes, no lists, no headings.
Also return:
- "highlights": 1 to 3 short phrases copied exactly from your sentence that matter most (shown in colour).
- "needed": the ids of the 1 to 6 items they need first (always include the front item if there is one).`;

export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    sentence: { type: 'string' },
    highlights: { type: 'array', items: { type: 'string' } },
    needed: { type: 'array', items: { type: 'string' } },
  },
  required: ['sentence', 'highlights', 'needed'],
  additionalProperties: false,
} as const;

export interface PromptData {
  payload: Record<string, unknown>;
  idToKey: Map<string, string>;
  fallbackNeeded: string[];
}

/** Build the data sent to the model. Items get short ids (i1, i2…) instead of paths. */
export function buildPromptData(entry: SaveEntry, previous: SaveEntry | null, feedback: string | null): PromptData {
  const idToKey = new Map<string, string>();
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

export const NAME_INSTRUCTIONS = `You name a piece of work someone is doing on their Mac, from the titles of the browser tabs and documents they have open.
Reply with a short folder name of 1 to 3 words that says what the work is about, like "Climate essay", "Toronto trip" or "Resume update".
Never copy a tab title. Use the shared topic across the titles and ignore unrelated tabs. Sentence case, no quotes, no emoji, no punctuation at the end.`;

export const NAME_SCHEMA = {
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
  additionalProperties: false,
} as const;

/** Titles only (scrubbed), for naming. */
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
