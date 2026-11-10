// How well Smart Tidy all sorts the test desks on this Mac, with the real on-device model (skipped if
// `npm run embedder` hasn't been run). Run with SORT_BENCH=<file> to write the table there.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { sortIntoWorks, sortText } from '../src/main/jobs/sort';
import { WordPiece } from '../src/main/meaning/tokenizer';
import { DESKS, row, scoreDesk, shuffled, summary } from './sort-desks';

const ready = existsSync(`embedder/node_modules/onnxruntime-node/bin/napi-v6/darwin/${process.arch}`) && existsSync('embedder/model/model.onnx');

describe.skipIf(!ready)('Smart Tidy all accuracy, on this Mac', () => {
  it('scores every desk', async () => {
    const { load, embed } = createRequire(import.meta.url)('../embedder/embed.cjs');
    const session = await load('embedder/model');
    const wp = new WordPiece(readFileSync('embedder/model/vocab.txt', 'utf8'));
    const rows: string[] = [];
    const scores = [];
    for (const d of DESKS) {
      const items = shuffled(d);
      const texts = [...new Set(items.map(sortText).filter((x): x is string => !!x))];
      const vs: number[][] = await embed(session, texts.map((x) => wp.encode(x)));
      const map = new Map(texts.map((x, i) => [x, vs[i]]));
      const works = sortIntoWorks(items, (x) => map.get(x));
      const s = scoreDesk(d, works);
      scores.push(s);
      rows.push(row(d, works, s));
    }
    if (process.env.SORT_BENCH) {
      writeFileSync(process.env.SORT_BENCH, rows.join('\n') + '\n');
      appendFileSync(process.env.SORT_BENCH, `On this Mac: ${summary(scores)}\n`);
    }
    expect(scores.length).toBe(DESKS.length); // a report, not a gate
  }, 120_000);
});
