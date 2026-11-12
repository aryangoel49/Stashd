// Stashd AI: briefs and folder names for everyone, through Stashd's own server (api/brief.ts), which asks
// Claude the same way for every Mac. Only on after you agree (Settings → Briefs, or the first-run setup).
//
// What goes out is exactly what a Claude brief sends (see prompt.ts): names, titles, cleaned addresses, your
// note and the end of an open AI chat with secrets removed. Never file contents.
// This file and claude.ts are the only ones allowed to use the network (tests/privacy.test.ts), and this one
// only ever talks to STASHD_AI.

import type { Brief, SaveEntry } from '../../shared/types';
import type { BriefWriter } from './index';
import { acceptAiSort, sortPayload } from '../jobs/sortai';
import { acceptAiBrief } from './basic';
import { buildPromptData, cleanAiName, namePayload } from './prompt';
import type { AskKind } from './spec';

export const STASHD_AI = 'https://getstashd.vercel.app/api/brief';

/** The one request to Stashd AI. Returns the model's JSON text and how many requests are left today. */
async function post(install: string, version: string, kind: AskKind, content: string, timeoutMs: number): Promise<{ text: string; left?: number }> {
  let res: Response;
  try {
    res = await fetch(STASHD_AI, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ install, kind, content, v: version }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new StashdAiError('error', 'Could not reach Stashd AI (are you offline?).');
  }
  const out = (await res.json().catch(() => ({}))) as { text?: unknown; message?: unknown; left?: unknown };
  if (!res.ok || typeof out.text !== 'string') {
    throw new StashdAiError(res.status === 429 ? 'limit' : 'error', typeof out.message === 'string' ? out.message : 'Stashd AI isn’t available right now.');
  }
  return { text: out.text, left: typeof out.left === 'number' ? out.left : undefined };
}

export class StashdAiError extends Error {
  constructor(readonly code: 'limit' | 'error', message: string) {
    super(message);
  }
}

/** Ask Stashd: one question with its context (see ask.ts). */
export async function stashdAsk(opts: { installId: () => Promise<string>; version: string }, content: string): Promise<{ text: string; left?: number }> {
  return post(await opts.installId(), opts.version, 'ask', content, 30_000);
}

export function stashdWriter(opts: { installId: () => Promise<string>; allowed: () => boolean; version: string }): BriefWriter {
  const ask = async (kind: AskKind, content: string, timeoutMs: number) => (await post(await opts.installId(), opts.version, kind, content, timeoutMs)).text;

  return {
    name: 'stashd',
    async write(entry: SaveEntry, previous: SaveEntry | null, feedback: string | null): Promise<Brief | null> {
      if (!opts.allowed()) return null;
      const data = buildPromptData(entry, previous, feedback);
      const text = await ask('brief', JSON.stringify(data.payload), 30_000);
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('Stashd AI sent back something unexpected.');
      }
      const brief = acceptAiBrief(parsed, data.idToKey, 'claude', data.fallbackNeeded);
      if (!brief) throw new Error('Stashd AI sent back something unexpected.');
      return brief;
    },
    async suggestName(items) {
      if (!opts.allowed()) return null;
      try {
        return cleanAiName((JSON.parse(await ask('name', namePayload(items), 8_000)) as { name?: unknown }).name);
      } catch {
        return null;
      }
    },
    async place(content) {
      if (!opts.allowed()) return null;
      return JSON.parse(await ask('place', content, 8_000)) as unknown;
    },
    async sortWork(items, folders) {
      if (!opts.allowed()) return null;
      const { payload, byId, folderById } = sortPayload(items, folders);
      const text = await ask('sort', JSON.stringify(payload), 12_000);
      try {
        return acceptAiSort(JSON.parse(text), byId, folderById);
      } catch {
        throw new Error('Stashd AI sent back something unexpected.');
      }
    },
  };
}

/** Sort sites Stashd doesn't know (see sites.ts): one small request for a few sites at a time. */
export async function stashdSites(opts: { installId: () => Promise<string>; version: string }, content: string): Promise<string> {
  return (await post(await opts.installId(), opts.version, 'sites', content, 20_000)).text;
}
