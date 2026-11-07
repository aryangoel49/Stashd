import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { makeHandler, type Deps } from '../api/brief';
import { check, LIMITS, memoryCounter, upstashCounter, weekOf } from '../api/_limits';
import { briefParams, OUTPUT_SCHEMA, STASHD_MODEL } from '../src/main/brief/spec';

const install = '6f1d2c3b-4a5e-4f60-8a71-92b3c4d5e6f7';
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://getstashd.vercel.app/api/brief', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': '1.2.3.4', ...headers } });
const answer = (text: string, stop: Anthropic.Beta.BetaMessage['stop_reason'] = 'end_turn') =>
  ({ content: [{ type: 'text', text }], stop_reason: stop }) as unknown as Anthropic.Beta.BetaMessage;

function deps(over: Partial<Deps> = {}): Deps & { calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  return { counter: memoryCounter(), totalPerDay: 1000, create: async (p) => (calls.push(p), answer('{"name":"Climate essay"}')), calls, ...over };
}

describe('Stashd AI server', () => {
  it('asks Claude exactly the way the app does, with the shared instructions', async () => {
    const d = deps();
    const res = await makeHandler(d)(post({ install, kind: 'brief', content: '{"items":[]}' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: '{"name":"Climate essay"}', left: 59 });
    expect(d.calls[0]).toEqual(briefParams('brief', STASHD_MODEL, '{"items":[]}'));
    expect(d.calls[0].output_config?.format).toEqual({ type: 'json_schema', schema: OUTPUT_SCHEMA });
  });

  it('turns away anything that isn’t a well-formed brief request', async () => {
    const h = makeHandler(deps());
    expect((await h(post({ install: 'nope', kind: 'brief', content: 'x' }))).status).toBe(400);
    expect((await h(post({ install, kind: 'chat', content: 'x' }))).status).toBe(400);
    expect((await h(post({ install, kind: 'brief', content: 'x'.repeat(90_000) }))).status).toBe(413);
    expect((await h(post({ install, kind: 'brief', content: 'x'.repeat(70_000) }))).status).toBe(400);
    expect((await h(new Request('https://x/api/brief'))).status).toBe(405);
  });

  it('stops at the daily limit per install, kindly', async () => {
    const h = makeHandler(deps());
    for (let i = 0; i < LIMITS.perInstall; i++) expect((await h(post({ install, kind: 'name', content: '{}' }))).status).toBe(200);
    const res = await h(post({ install, kind: 'name', content: '{}' }));
    expect(res.status).toBe(429);
    expect((await res.json()).message).toMatch(/back tomorrow/);
  });

  it('says it’s switched off without a key, and busy when Anthropic is', async () => {
    expect((await makeHandler(deps({ create: null }))(post({ install, kind: 'name', content: '{}' }))).status).toBe(503);
    const busy = new Anthropic.APIError(529, undefined, 'overloaded', new Headers());
    const res = await makeHandler(deps({ create: async () => { throw busy; } }))(post({ install, kind: 'name', content: '{}' }));
    expect(res.status).toBe(503);
  });

  it('passes on a refusal as an error, not a brief', async () => {
    const res = await makeHandler(deps({ create: async () => answer('', 'refusal') }))(post({ install, kind: 'brief', content: '{}' }));
    expect(res.status).toBe(422);
  });

  it('keeps briefs working if the counter store is down', async () => {
    const counter = { bump: async () => { throw new Error('down'); }, note: async () => undefined };
    expect((await makeHandler(deps({ counter }))(post({ install, kind: 'name', content: '{}' }))).status).toBe(200);
  });
});

describe('fair-use counters', () => {
  it('pauses for everyone once the daily total is reached', async () => {
    const c = memoryCounter();
    expect((await check(c, install, 'a', 2)).refused).toBeNull();
    expect((await check(c, install, 'b', 2)).refused).toBeNull();
    expect((await check(c, install, 'c', 2)).refused).toBe('total');
  });

  it('only stores hashes, never the install ID or address itself', async () => {
    const send = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(JSON.parse(String(init?.body)).map(() => ({ result: 1 })))));
    await check(upstashCounter('https://redis.example', 'tok', send as unknown as typeof fetch), install, '9.9.9.9', 100);
    const sent = send.mock.calls.map((c) => String(c[1]?.body)).join(' ');
    expect(sent).not.toContain(install);
    expect(sent).not.toContain('9.9.9.9');
    expect(sent).toContain('"EX"');
  });

  it('names weeks the ISO way', () => {
    expect(weekOf(new Date('2026-11-06T12:00:00Z'))).toBe('2026-W45');
    expect(weekOf(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');
  });
});
