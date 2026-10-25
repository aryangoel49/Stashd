// The Claude brief. This is the ONLY module in the app allowed to use the network
// (tests/privacy.test.ts fails if any other file imports http/https/net or calls fetch).
// It sends the data from prompt.ts: names, titles, scrubbed addresses and your note. Never file contents.

import Anthropic from '@anthropic-ai/sdk';
import type { Brief, SaveEntry } from '../../shared/types';
import type { BriefWriter } from './index';
import { modelInfo } from '../../shared/models';
import { acceptAiBrief } from './basic';
import { buildPromptData, cleanAiName, INSTRUCTIONS, NAME_INSTRUCTIONS, NAME_SCHEMA, namePayload, OUTPUT_SCHEMA } from './prompt';

function friendlyError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'The API key was not accepted.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'This API key is not allowed to use that model.';
  if (e instanceof Anthropic.NotFoundError) return 'That model name was not found.';
  if (e instanceof Anthropic.RateLimitError) return 'Too many requests right now.';
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach Claude (are you offline?).';
  if (e instanceof Anthropic.APIError) return `Claude returned an error (${e.status ?? 'unknown'}).`;
  return e instanceof Error ? e.message : String(e);
}

async function ask(
  apiKey: string,
  model: string,
  content: string,
  opts: { system?: string; schema?: Record<string, unknown>; maxTokens?: number; quick?: boolean } = {},
) {
  // Bigger models think for longer, so they get more room and more time.
  const slow = modelInfo(model)?.slow ?? true;
  const timeout = opts.quick ? (slow ? 20_000 : 8_000) : slow ? 60_000 : 30_000;
  const client = new Anthropic({ apiKey, timeout, maxRetries: 1 });
  try {
    return await client.beta.messages.create({
      model,
      max_tokens: (opts.maxTokens ?? 2000) * (slow ? 2 : 1),
      output_config: { effort: 'low', format: { type: 'json_schema', schema: opts.schema ?? OUTPUT_SCHEMA } },
      system: opts.system ?? INSTRUCTIONS,
      messages: [{ role: 'user', content }],
      // If a bigger model declines (its safety checks can be over-cautious), Anthropic retries on a suitable model.
      // Haiku has no such fallback; a decline there just moves on to Apple Intelligence or the basic brief.
      ...(model.startsWith('claude-haiku') ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
    });
  } catch (e) {
    throw new Error(friendlyError(e));
  }
}

export function claudeWriter(opts: { getKey: () => Promise<string | null>; getModel: () => string; allowed: () => boolean }): BriefWriter {
  return {
    name: 'claude',
    async write(entry: SaveEntry, previous: SaveEntry | null, feedback: string | null): Promise<Brief | null> {
      if (!opts.allowed()) return null;
      const key = await opts.getKey();
      if (!key) return null;
      const data = buildPromptData(entry, previous, feedback);
      const response = await ask(key, opts.getModel(), JSON.stringify(data.payload));
      if (response.stop_reason === 'refusal') throw new Error('Claude declined to write this brief.');
      const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('Claude sent back something unexpected.');
      }
      const brief = acceptAiBrief(parsed, data.idToKey, 'claude', data.fallbackNeeded);
      if (!brief) throw new Error('Claude sent back something unexpected.');
      return brief;
    },
    async suggestName(items) {
      if (!opts.allowed()) return null;
      const key = await opts.getKey();
      if (!key) return null;
      const response = await ask(key, opts.getModel(), namePayload(items), { system: NAME_INSTRUCTIONS, schema: NAME_SCHEMA, maxTokens: 1000, quick: true });
      if (response.stop_reason === 'refusal') return null;
      const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      try {
        return cleanAiName((JSON.parse(text) as { name?: unknown }).name);
      } catch {
        return null;
      }
    },
  };
}

/** One tiny call to check a key works before saving it. */
export async function testClaudeKey(apiKey: string, model: string): Promise<void> {
  const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 0 });
  try {
    await client.messages.create({ model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with OK.' }] });
  } catch (e) {
    throw new Error(friendlyError(e));
  }
}
