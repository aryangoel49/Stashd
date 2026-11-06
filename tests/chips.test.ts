// Do both builds sort work the same way? Runs the meaning model shipped in two builds and compares the
// results. Skipped unless scripts/compare-chips.mjs (npm run check:chips) says which two to run.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { group, jobFit, jobProfile, meaningText, profileTexts, type MeaningLookup, type Profile } from '../src/main/jobs/relevance';
import { WordPiece } from '../src/main/meaning/tokenizer';
import type { Item } from '../src/shared/types';
import { aiDoc, aiTab1, automation, canva, clutter, cnTower, dogs, earbuds, essay, flights, glaciers, hotels, jakarta, jstor1, labels, linkedin, madrid, ml, nba, nvidia, ovo, premier, preview, quest, recipe, streamEast, streamKing, textEdit } from './meaning-fixtures';

/** "<Electron path>|<embedder folder>" for each build. */
const A = process.env.STASHD_CHIP_A;
const B = process.env.STASHD_CHIP_B;

const scenarios: { name: string; items: Item[]; profile: Profile | null; front: Item }[] = [
  { name: 'soccer', items: [streamKing, ovo, madrid, streamEast, nba, premier, ...clutter, preview, textEdit], profile: null, front: streamKing },
  { name: 'ai research', items: [aiDoc, aiTab1, nvidia, ml, automation, ...clutter, preview], profile: jobProfile('ai research', '', [aiDoc]), front: aiDoc },
  { name: 'climate essay', items: [essay, jstor1, jakarta, glaciers, ...clutter], profile: jobProfile('Climate essay', 'need 2 more sea level sources', [essay, jstor1]), front: essay },
  { name: 'toronto trip', items: [flights, cnTower, hotels, ...clutter], profile: jobProfile('Toronto trip', '', [flights]), front: flights },
];
const jobs = {
  ai: jobProfile('ai research', '', [aiDoc]),
  soccer: jobProfile('Soccer Streams', '', [streamKing]),
  climate: jobProfile('Climate essay', '', [essay, jstor1]),
  toronto: jobProfile('Toronto trip', '', [flights]),
};
const opens = [[madrid, nba, premier], [ml, automation], [jakarta, glaciers], [cnTower, flights], [dogs, recipe, earbuds], [linkedin, canva, quest]];

const textsOf = (items: Item[]) => items.map(meaningText).filter((t): t is string => !!t);
const allTexts = [...new Set([...scenarios.flatMap((s) => [...textsOf(s.items), ...(s.profile ? profileTexts(s.profile) : [])]), ...Object.values(jobs).flatMap((p) => profileTexts(p)), ...opens.flatMap(textsOf)])];

function runBuild(spec: string): { arch: string; vectors: Map<string, number[]> } {
  const [electron, embedder] = spec.split('|');
  const wp = new WordPiece(readFileSync(`${embedder}/model/vocab.txt`, 'utf8'));
  const out = execFileSync(electron, ['scripts/embed-dump.cjs', embedder], {
    input: JSON.stringify(allTexts.map((t) => wp.encode(t))),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
    encoding: 'utf8',
  });
  const r = JSON.parse(out) as { arch: string; vectors: number[][] };
  return { arch: r.arch, vectors: new Map(allTexts.map((t, i) => [t, r.vectors[i]])) };
}

describe.skipIf(!A || !B)('both builds match', () => {
  let a: ReturnType<typeof runBuild>;
  let b: ReturnType<typeof runBuild>;
  const lookup = (v: Map<string, number[]>): MeaningLookup => (t) => v.get(t);

  beforeAll(() => {
    a = runBuild(A!);
    b = runBuild(B!);
    console.log(`comparing ${a.arch} with ${b.arch}, ${allTexts.length} texts`);
  }, 240_000);

  it('give nearly the same meaning vectors', () => {
    let worst = 0;
    let lowest = 1;
    for (const t of allTexts) {
      const [x, y] = [a.vectors.get(t)!, b.vectors.get(t)!];
      expect(x).toHaveLength(384);
      expect(y).toHaveLength(384);
      lowest = Math.min(lowest, x.reduce((sum, n, i) => sum + n * y[i], 0));
      for (const [i, n] of x.entries()) worst = Math.max(worst, Math.abs(n - y[i]));
    }
    console.log(`largest difference in one number: ${worst}; lowest similarity: ${lowest}`);
    expect(lowest).toBeGreaterThan(0.999);
  });

  it.each(scenarios)('sort "$name" into the same groups', ({ items, profile, front }) => {
    const sorted = (v: Map<string, number[]>) => {
      const g = group({ candidates: items, profile, frontKey: front.key, meaning: lookup(v) });
      return { sure: labels(g.sure), likely: labels(g.likely), maybe: labels(g.maybe) };
    };
    expect(sorted(b.vectors)).toEqual(sorted(a.vectors));
  });

  it('pick the same folder for what is open', () => {
    const ranking = (v: Map<string, number[]>, open: Item[]) => Object.entries(jobs).map(([k, p]) => [k, jobFit(open, p, lookup(v))] as const).sort((x, y) => y[1] - x[1]);
    for (const open of opens) {
      const [x, y] = [ranking(a.vectors, open), ranking(b.vectors, open)];
      expect(y.map(([k]) => k)).toEqual(x.map(([k]) => k));
      for (const [i, [, fit]] of x.entries()) expect(Math.abs(fit - y[i][1])).toBeLessThan(0.01);
    }
  });
});
