// Stashd AI: writes briefs and folder names for everyone, so nobody needs a Claude key of their own.
//
// The app sends what a brief needs (names, titles, cleaned addresses, the user's note, the end of an open
// AI chat with secrets removed; never file contents). This adds Stashd's Anthropic key, asks Claude the same
// way the app does (src/main/brief/spec.ts), and sends the answer back. Nothing is stored or logged
// except the hashed counters in _limits.ts.
//
// Settings (Vercel → Project → Environment Variables):
//   ANTHROPIC_API_KEY   the Stashd server key (its own workspace, with a monthly spend limit)
//   STASHD_DAILY_TOTAL  optional: requests a day for everyone together before it pauses (default 20000)
//   Upstash Redis       optional but recommended: connect it from Vercel's Marketplace for shared counters

import Anthropic from '@anthropic-ai/sdk';
import { briefParams, isAskKind, responseText, STASHD_MODEL } from '../src/main/brief/spec';
import { check, counterFromEnv, type Counter } from './_limits';

const MAX_BODY = 80_000;
const MAX_CONTENT = 60_000;
const INSTALL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MESSAGES = {
  bad: 'Stashd AI could not read that request.',
  limit: 'Today’s free AI briefs are used up. They’re back tomorrow.',
  busy: 'Stashd AI is busy right now. Try again in a minute.',
  off: 'Stashd AI is switched off right now.',
  declined: 'Claude declined to write this one.',
};

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const fail = (status: number, error: keyof typeof MESSAGES) => reply(status, { error, message: MESSAGES[error] });

export interface Deps {
  counter: Counter;
  totalPerDay: number;
  /** Null when no key is set. */
  create: ((params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage>) | null;
}

export function makeHandler(deps: Deps) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return fail(405, 'bad');
    const raw = await request.text();
    if (raw.length > MAX_BODY) return fail(413, 'bad');
    let body: { install?: unknown; kind?: unknown; content?: unknown };
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      return fail(400, 'bad');
    }
    const { install, kind, content } = body;
    if (typeof install !== 'string' || !INSTALL.test(install)) return fail(400, 'bad');
    if (!isAskKind(kind)) return fail(400, 'bad');
    if (typeof content !== 'string' || !content || content.length > MAX_CONTENT) return fail(400, 'bad');
    if (!deps.create) return fail(503, 'off');

    const address = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
    let left: number | undefined;
    try {
      const c = await check(deps.counter, install, address, deps.totalPerDay);
      if (c.refused) return fail(429, 'limit');
      left = c.left;
    } catch {
      // If the counter store is down, keep briefs working; the Anthropic spend limit still caps the cost.
    }

    try {
      const response = await deps.create(briefParams(kind, STASHD_MODEL, content));
      if (response.stop_reason === 'refusal') return fail(422, 'declined');
      return reply(200, { text: responseText(response), left });
    } catch (e) {
      if (e instanceof Anthropic.APIError && (e.status === 429 || (e.status ?? 0) >= 500)) return fail(503, 'busy');
      if (e instanceof Anthropic.APIConnectionError) return fail(503, 'busy');
      return fail(502, 'busy');
    }
  };
}

const key = process.env.ANTHROPIC_API_KEY;
const client = key ? new Anthropic({ apiKey: key, timeout: 30_000, maxRetries: 1 }) : null;

export const POST = makeHandler({
  counter: counterFromEnv(process.env),
  totalPerDay: Number(process.env.STASHD_DAILY_TOTAL) || 20_000,
  create: client ? (params) => client.beta.messages.create(params) : null,
});
export const GET = POST;
