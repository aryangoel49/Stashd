// How well Smart Tidy all sorts the test desks with Claude. Costs a few cents, so it only runs when asked:
//   SORT_VIA=server SORT_BENCH=<file> npx vitest run tests/sort-claude.test.ts   (through Stashd AI: Haiku 5.5)
//   ANTHROPIC_API_KEY=... SORT_BENCH=<file> npx vitest run tests/sort-claude.test.ts   (your key; SORT_MODELS picks)

import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { briefParams, responseText } from '../src/main/brief/spec';
import { acceptAiSort, sortPayload } from '../src/main/jobs/sortai';
import { DESKS, row, scoreDesk, shuffled, summary } from './sort-desks';

const viaServer = process.env.SORT_VIA === 'server';
const models = viaServer ? ['stashd-ai'] : (process.env.SORT_MODELS ?? 'claude-haiku-5-5,claude-opus-5-5').split(',');

/** Asks Claude, directly with a key or through Stashd AI's server. Returns the JSON text, or null. */
async function askSort(model: string, content: string, tokens: { n: number }): Promise<string | null> {
  if (viaServer) {
    const res = await fetch(process.env.SORT_SERVER ?? 'https://getstashd.vercel.app/api/brief', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ install: randomUUID(), kind: 'sort', content }),
    });
    const body = (await res.json()) as { text?: string; message?: string };
    if (!res.ok) throw new Error(`Stashd AI: ${res.status} ${body.message ?? ''}`);
    return body.text ?? null;
  }
  const client = new Anthropic({ maxRetries: 2 });
  const response = await client.beta.messages.create({
    ...briefParams('sort', model, content),
    ...(model.startsWith('claude-haiku') ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
  });
  tokens.n += response.usage.input_tokens + response.usage.output_tokens;
  return response.stop_reason === 'refusal' ? null : responseText(response);
}

describe.skipIf(!viaServer && !process.env.ANTHROPIC_API_KEY)('Smart Tidy all accuracy, with Claude', () => {
  for (const model of models) {
    it(`scores every desk with ${model}`, async () => {
      const rows: string[] = [];
      const scores = [];
      const tokens = { n: 0 };
      for (const d of DESKS) {
        const { payload, byId } = sortPayload(shuffled(d));
        const text = await askSort(model, JSON.stringify(payload), tokens);
        let parsed: unknown = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        const pieces = acceptAiSort(parsed, byId);
        const works = pieces.map((p) => p.items);
        const s = scoreDesk(d, works);
        scores.push(s);
        rows.push(row(d, works, s) + `\n   names: ${pieces.map((p) => p.name).join(', ')}`);
      }
      const out = `\n== ${model} (${tokens.n} tokens)\n${rows.join('\n')}\nWith ${model}: ${summary(scores)}\n`;
      if (process.env.SORT_BENCH) appendFileSync(process.env.SORT_BENCH, out);
      console.log(out);
      expect(scores.length).toBe(DESKS.length);
    }, 600_000);
  }
});
