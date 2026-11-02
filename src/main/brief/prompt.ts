// What the AI is told, and exactly what it is sent. Shared by Claude and Apple Intelligence.
// It sends names, titles, scrubbed addresses, your note and the end of an open Claude chat (secrets removed).
// Never file contents.

import type { SaveEntry } from '../../shared/types';
import { redactCommand, redactUrlString } from '../redact';
import { neededItems } from './basic';

export const INSTRUCTIONS = `You write a short "welcome back" brief for someone returning to a piece of work on their Mac.
You get a list of what they had open when they saved (files, browser tabs, apps, AI chats), which item was in front (the last thing they were on), their own note, and sometimes what changed since their previous save.

The brief must be precise and very simple to read. Someone glancing at it for two seconds should understand it.

Return four short parts:
- "sentence": what this work is, in plain words. At most 10 words. Example: "Writing your climate essay on carbon taxes."
- "lastOn": the thing they were on last, by its plain name, and what they were doing. At most 12 words. Example: "The essay draft, at the counterargument section."
- "soFar": what's done so far. At most 12 words. Use "" if the data doesn't say.
- "next": one concrete next step. If their note says what's next, use it. At most 12 words. Example: "Find two more sources for the counterargument."

How to write:
- Short, common words. One idea per part. Write like a clear instruction, not a story.
- No jokes, no metaphors, no clever phrasing, no filler.
- Don't describe the app or the computer ("in TextEdit", "was in front when you saved", "tab", "window") unless it's needed to find the thing.
- No jargon, no "resources", no "context", no em dashes, no exclamation marks, no emoji.
- Each part is a plain phrase or sentence. No lists, no labels like "Next:".

Rules:
- Only use facts from the data. Never invent progress, deadlines, or contents of files. If unsure, say less.
- Name the project, not the last tiny step. The first part should make the project clear at a glance.
- Most saves have no AI chat. Then work the project out from the tab titles, file names, sites, folder name and note together.
- An item may have "chatEnd": the end of a chat they were having with an AI assistant about this work, and its name is the chat's title. Use it only for the big picture: the goal, what was decided, what's left. Ignore commands, file names, error messages and talk about tools. Don't quote it.
Also return:
- "highlights": 0 to 2 short phrases copied exactly from your parts that matter most (shown in bold). Usually the next step's key words.
- "needed": the ids of the 1 to 6 items they need first (always include the front item if there is one).`;

export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    sentence: { type: 'string' },
    lastOn: { type: 'string' },
    soFar: { type: 'string' },
    next: { type: 'string' },
    highlights: { type: 'array', items: { type: 'string' } },
    needed: { type: 'array', items: { type: 'string' } },
  },
  required: ['sentence', 'lastOn', 'soFar', 'next', 'highlights', 'needed'],
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
