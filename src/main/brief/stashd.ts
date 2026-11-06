// Stashd AI: briefs and folder names for everyone, through Stashd's own server (api/brief.ts), which asks
// Claude the same way for every Mac. Only on after you agree (Settings → Briefs, or the first-run setup).
//
// What goes out is exactly what a Claude brief sends (see prompt.ts): names, titles, cleaned addresses, your
// note and the end of an open AI chat with secrets removed. Never file contents.
// This file and claude.ts are the only ones allowed to use the network (tests/privacy.test.ts), and this one
// only ever talks to STASHD_AI.

import type { Brief, SaveEntry } from '../../shared/types';
import type { BriefWriter } from './index';
import { acceptAiBrief } from './basic';
import { buildPromptData, cleanAiName, namePayload } from './prompt';
import type { AskKind } from './spec';

export const STASHD_AI = 'https://getstashd.vercel.app/api/brief';

export function stashdWriter(opts: { installId: () => Promise<string>; allowed: () => boolean; version: string }): BriefWriter {
  async function ask(kind: AskKind, content: string, timeoutMs: number): Promise<string> {
    let res: Response;
    try {
      res = await fetch(STASHD_AI, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ install: await opts.installId(), kind, content, v: opts.version }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new Error('Could not reach Stashd AI (are you offline?).');
    }
    const out = (await res.json().catch(() => ({}))) as { text?: unknown; message?: unknown };
    if (!res.ok || typeof out.text !== 'string') throw new Error(typeof out.message === 'string' ? out.message : 'Stashd AI isn’t available right now.');
    return out.text;
  }

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
  };
}
