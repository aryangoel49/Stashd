// Fair-use limits for Stashd AI, and the one number we keep: how many installs used it each week.
// Nothing personal is stored. Install IDs and internet addresses are hashed before they're counted,
// and every counter expires on its own.
//
// Counters live in Upstash Redis when it's connected to the Vercel project (free tier), else in memory
// (fine for testing; each server instance then counts on its own).

import { createHash } from 'node:crypto';

export const LIMITS = {
  /** Briefs and folder names per install per day. A busy day is about 30 saves, each asking for both. */
  perInstall: 60,
  /** Per internet address per day: a classroom or office shares one. */
  perAddress: 300,
};

export type Refusal = 'install' | 'address' | 'total';

export interface Counter {
  /** Adds one to each key (each kept for ttl seconds) and returns the new totals. */
  bump(keys: string[], ttl: number): Promise<number[]>;
  /** Notes a member of a set (kept for ttl seconds). */
  note(set: string, member: string, ttl: number): Promise<void>;
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);
const DAY = 86_400;

/** ISO week, like 2026-W45. */
export function weekOf(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const start = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - start) / DAY / 1000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Counts this request, then says whether it's over a limit (null when it may go ahead). */
export async function check(counter: Counter, install: string, address: string, totalPerDay: number, now = new Date()): Promise<Refusal | null> {
  const day = now.toISOString().slice(0, 10);
  const [mine, here, all] = await counter.bump([`d:${day}:i:${hash(install)}`, `d:${day}:a:${hash(address)}`, `d:${day}:all`], 2 * DAY);
  if (all > totalPerDay) return 'total';
  if (mine > LIMITS.perInstall) return 'install';
  if (here > LIMITS.perAddress) return 'address';
  await counter.note(`active:${weekOf(now)}`, hash(install), 120 * DAY);
  return null;
}

export function memoryCounter(): Counter {
  const counts = new Map<string, { n: number; until: number }>();
  const sets = new Map<string, Set<string>>();
  return {
    async bump(keys, ttl) {
      const now = Date.now();
      return keys.map((k) => {
        const c = counts.get(k);
        const next = c && c.until > now ? { n: c.n + 1, until: c.until } : { n: 1, until: now + ttl * 1000 };
        counts.set(k, next);
        return next.n;
      });
    },
    async note(set, member) {
      sets.set(set, (sets.get(set) ?? new Set()).add(member));
    },
  };
}

/** Upstash's REST API: one round trip per request (a pipeline of commands). */
export function upstashCounter(url: string, token: string, send: typeof fetch = fetch): Counter {
  const pipeline = async (commands: (string | number)[][]) => {
    const res = await send(`${url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(commands),
    });
    if (!res.ok) throw new Error(`counter store answered ${res.status}`);
    return (await res.json()) as { result?: unknown }[];
  };
  return {
    async bump(keys, ttl) {
      // SET … NX EX starts a counter with its expiry; INCR then keeps that expiry.
      const out = await pipeline(keys.flatMap((k) => [['SET', k, 0, 'EX', ttl, 'NX'], ['INCR', k]]));
      return keys.map((_, i) => Number(out[i * 2 + 1]?.result ?? 0));
    },
    async note(set, member, ttl) {
      await pipeline([['SADD', set, member], ['EXPIRE', set, ttl]]);
    },
  };
}

/** Upstash when its settings are there (either naming Vercel uses), else memory. */
export function counterFromEnv(env: Record<string, string | undefined>): Counter {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  return url && token ? upstashCounter(url, token) : memoryCounter();
}
