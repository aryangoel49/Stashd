// How well ⌃S decides on the test desks: which folder the work goes in, and what gets ticked.
// Each piece of work was saved earlier with its first half; then everything is open and you press ⌃S on
// one of its newer things. A report, not a gate, so it only runs when asked:
//   SAVE_BENCH=<file> npx vitest run tests/save-bench.test.ts                    (this Mac's own model)
//   SAVE_VIA=server SAVE_BENCH=<file> npx vitest run tests/save-bench.test.ts    (Claude, through Stashd AI; a few cents)

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' }, shell: {} }));
import type { Item, Job } from '../src/shared/types';
import { classify, suggestName } from '../src/main/jobs/match';
import { acceptPlacement, placePayload } from '../src/main/jobs/placeai';
import { FIT_SUGGEST, jobFit, jobProfile, meaningText, profileTexts } from '../src/main/jobs/relevance';
import { WordPiece } from '../src/main/meaning/tokenizer';
import { DEFAULT_SETTINGS } from '../src/shared/validate';
import { DESKS, shuffled, type Desk } from './sort-desks';

const out = process.env.SAVE_BENCH;
const viaServer = process.env.SAVE_VIA === 'server';
const ready = existsSync(`embedder/node_modules/onnxruntime-node/bin/napi-v6/darwin/${process.arch}`) && existsSync('embedder/model/model.onnx');
const job = (name: string): Job => ({ id: name, name, createdAt: '', updatedAt: '', done: false, prefs: { hide: {}, add: {} } }) as unknown as Job;
const pct = (a: number, b: number) => `${Math.round((100 * a) / Math.max(1, b))}%`;

/** The folders a desk already has: each piece's first half, named the way Stashd names without AI. */
function savedFolders(d: Desk) {
  return d.work.map((piece) => {
    const half = piece.slice(0, Math.max(1, Math.floor(piece.length / 2)));
    return { piece, half, rest: piece.filter((i) => !half.includes(i)), name: suggestName(half, half[0].key) };
  });
}

class Tally {
  add = { hit: 0, want: 0, wrong: 0 };
  fresh = { hit: 0, want: 0, wrong: 0 };
  pick = { right: 0, wrongFolder: 0, none: 0 };
  lines(who: string): string[] {
    const cases = this.pick.right + this.pick.wrongFolder + this.pick.none;
    return [
      `${who}:`,
      `  which folder (${cases} cases): right ${this.pick.right}, wrong folder ${this.pick.wrongFolder}, a new folder offered instead ${this.pick.none}`,
      `  adding to a folder you have: ticked ${this.add.hit}/${this.add.want} of what belongs (${pct(this.add.hit, this.add.want)}), ${this.add.wrong} wrong things ticked`,
      `  a new folder: ticked ${this.fresh.hit}/${this.fresh.want} of what belongs (${pct(this.fresh.hit, this.fresh.want)}), ${this.fresh.wrong} wrong things ticked`,
    ];
  }
}

describe.skipIf(!out || viaServer || !ready)('⌃S accuracy, on this Mac', () => {
  it('scores every desk', async () => {
    const { load, embed } = createRequire(import.meta.url)('../embedder/embed.cjs');
    const session = await load('embedder/model');
    const wp = new WordPiece(readFileSync('embedder/model/vocab.txt', 'utf8'));
    const cache = new Map<string, number[]>();
    const need = async (texts: string[]) => {
      const t = [...new Set(texts)].filter((x) => x && !cache.has(x));
      if (!t.length) return;
      const vs: number[][] = await embed(session, t.map((x) => wp.encode(x)));
      t.forEach((x, i) => cache.set(x, vs[i]));
    };
    const lookup = (t: string) => cache.get(t);
    const t = new Tally();
    for (const d of DESKS) {
      const all = shuffled(d);
      await need(all.map(meaningText).filter((x): x is string => !!x));
      const saved = savedFolders(d);
      for (const s of saved) await need(profileTexts(jobProfile(s.name, '', s.half)));
      for (const s of saved) {
        if (!s.rest.length) continue;
        const front = s.rest[0];
        const fits = saved.map((x) => ({ x, fit: jobFit(all, jobProfile(x.name, '', x.half), lookup, front.key) })).sort((a, b) => b.fit - a.fit);
        if (fits[0].fit < FIT_SUGGEST) t.pick.none++;
        else if (fits[0].x === s) t.pick.right++;
        else t.pick.wrongFolder++;
        const c = classify({ items: all, job: job(s.name), previous: s.half, name: s.name, settings: DEFAULT_SETTINGS, frontKey: front.key, meaning: lookup });
        const sure = new Set(c.sure.map((i) => i.key));
        t.add.want += s.rest.length;
        t.add.hit += s.rest.filter((i) => sure.has(i.key)).length;
        t.add.wrong += c.sure.filter((i) => !s.piece.includes(i)).length;
      }
      for (const piece of d.work) {
        const c = classify({ items: all, job: null, previous: [], name: '', settings: DEFAULT_SETTINGS, frontKey: piece[0].key, meaning: lookup });
        const sure = new Set(c.sure.map((i) => i.key));
        t.fresh.want += piece.length;
        t.fresh.hit += piece.filter((i) => sure.has(i.key)).length;
        t.fresh.wrong += c.sure.filter((i) => !piece.includes(i)).length;
      }
    }
    writeFileSync(out!, t.lines("This Mac's own model").join('\n') + '\n');
    expect(t.pick.wrongFolder).toBeGreaterThanOrEqual(0);
  }, 180_000);
});

describe.skipIf(!out || !viaServer)('⌃S accuracy, with Claude', () => {
  /** One place request through Stashd AI, checked the way the app checks it. */
  async function place(open: Item[], frontKey: string, folders: { id: string; name: string; items: Item[] }[], target: string | null) {
    const req = placePayload(open, frontKey, folders.map((f) => ({ ...f, note: '', open: false })), target);
    const res = await fetch(process.env.SAVE_SERVER ?? 'https://getstashd.vercel.app/api/brief', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ install: randomUUID(), kind: 'place', content: JSON.stringify(req.payload) }),
    });
    const body = (await res.json()) as { text?: string; message?: string };
    if (!res.ok || !body.text) throw new Error(`Stashd AI: ${res.status} ${body.message ?? ''}`);
    return acceptPlacement(JSON.parse(body.text), req);
  }

  it('scores every desk', async () => {
    const t = new Tally();
    const misses: string[] = [];
    for (const d of DESKS) {
      const all = shuffled(d);
      const saved = savedFolders(d);
      const folders = saved.map((s) => ({ id: s.name, name: s.name, items: s.half }));
      for (const s of saved) {
        if (!s.rest.length) continue;
        const p = await place(all, s.rest[0].key, folders, null);
        if (!p || p.jobId === null) t.pick.none++;
        else if (p.jobId === s.name) t.pick.right++;
        else t.pick.wrongFolder++;
        const keys = p?.keys ?? new Set<string>();
        t.add.want += s.rest.length;
        t.add.hit += s.rest.filter((i) => keys.has(i.key)).length;
        const wrong = all.filter((i) => keys.has(i.key) && !s.piece.includes(i));
        t.add.wrong += wrong.length;
        if (p?.jobId !== s.name || wrong.length || s.rest.some((i) => !keys.has(i.key)))
          misses.push(`  ${d.name} / ${s.name}: folder ${p?.jobId ?? 'new'}; missed ${s.rest.filter((i) => !keys.has(i.key)).map((i) => i.label).join(' | ') || '-'}; wrong ${wrong.map((i) => i.label).join(' | ') || '-'}`);
      }
      for (const piece of d.work) {
        const p = await place(all, piece[0].key, [], 'new');
        const keys = p?.keys ?? new Set<string>();
        t.fresh.want += piece.length;
        t.fresh.hit += piece.filter((i) => keys.has(i.key)).length;
        t.fresh.wrong += all.filter((i) => keys.has(i.key) && !piece.includes(i)).length;
      }
    }
    appendFileSync(out!, [...t.lines('Claude, through Stashd AI'), ...(misses.length ? ['  where it differed:', ...misses] : [])].join('\n') + '\n');
    expect(t.pick.right).toBeGreaterThan(0);
  }, 600_000);
});
