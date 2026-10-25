// The on-device meaning model, run in its own process (embedder/worker.cjs).
// Free, offline and private: titles never leave this Mac. If anything goes wrong it quietly
// switches off and job sorting carries on with word matching alone.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { app, utilityProcess, type UtilityProcess } from 'electron';
import { WordPiece } from './tokenizer';

export interface Meaning {
  /** Meaning vectors for these texts, or null if the model isn't available right now. */
  vectors(texts: string[], timeoutMs?: number): Promise<Map<string, number[]> | null>;
  /** Start the model in the background so the first save isn't slower. */
  warm(): void;
}

const BATCH = 32;
const CACHE_MAX = 4000;
const GIVE_UP_AFTER = 3;

export function embedderDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'embedder') : path.join(app.getAppPath(), 'embedder');
}

export function createMeaning(dir = embedderDir()): Meaning {
  let child: UtilityProcess | null = null;
  let tokenizer: WordPiece | null = null;
  let failures = 0;
  let nextId = 1;
  const waiting = new Map<number, { resolve: (v: number[][]) => void; reject: (e: Error) => void }>();
  const cache = new Map<string, number[]>();

  const fail = (why: string) => {
    failures++;
    for (const w of waiting.values()) w.reject(new Error(why));
    waiting.clear();
    child?.kill();
    child = null;
  };

  const start = (): UtilityProcess => {
    if (child) return child;
    tokenizer ??= new WordPiece(readFileSync(path.join(dir, 'model', 'vocab.txt'), 'utf8'));
    const c = utilityProcess.fork(path.join(dir, 'worker.cjs'), [path.join(dir, 'model')], { serviceName: 'Where Was I meaning model', stdio: 'ignore' });
    c.on('message', (m: { id: number; vectors?: number[][]; error?: string }) => {
      const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      if (m.vectors) w.resolve(m.vectors);
      else w.reject(new Error(m.error ?? 'no answer'));
    });
    c.on('exit', () => {
      if (child === c) fail('the meaning model stopped');
    });
    child = c;
    return c;
  };

  const run = (batch: number[][]) =>
    new Promise<number[][]>((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      start().postMessage({ id, batch });
    });

  return {
    warm() {
      if (failures >= GIVE_UP_AFTER) return;
      void this.vectors(['warm up']).catch(() => undefined);
    },

    async vectors(texts, timeoutMs = 4000) {
      if (failures >= GIVE_UP_AFTER) return null;
      const missing = [...new Set(texts)].filter((t) => !cache.has(t));
      try {
        const work = (async () => {
          start();
          for (let i = 0; i < missing.length; i += BATCH) {
            const chunk = missing.slice(i, i + BATCH);
            const vecs = await run(chunk.map((t) => tokenizer!.encode(t)));
            chunk.forEach((t, j) => cache.set(t, vecs[j]));
          }
        })();
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('the meaning model took too long')), timeoutMs);
        });
        try {
          await Promise.race([work, timeout]);
        } finally {
          clearTimeout(timer);
        }
        failures = 0;
      } catch (e) {
        console.warn('Meaning model unavailable:', e instanceof Error ? e.message : e);
        fail(String(e));
        return null;
      }
      // Keep the cache bounded: forget the oldest.
      for (const k of cache.keys()) {
        if (cache.size <= CACHE_MAX) break;
        cache.delete(k);
      }
      return new Map(texts.filter((t) => cache.has(t)).map((t) => [t, cache.get(t)!]));
    },
  };
}
