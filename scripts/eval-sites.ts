// How often Stashd sorts sites right: runs the test set (tests/fixtures/sites-eval.ts) through the real
// sorting (src/main/sites.ts) with the real on-device model, then, with --ai, Stashd AI for what's left.
//   npx tsx scripts/eval-sites.ts [--ai] [--set dev|test|all] [--misses]
// --ai sends the test set's sites and titles (made-up examples, nothing of yours) to Stashd's server,
// about 20 requests from a throwaway install id.

import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isBreakItem, setLearnedBreakSites } from '../src/main/breaks';
import { STASHD_AI } from '../src/main/brief/stashd';
import { WordPiece } from '../src/main/meaning/tokenizer';
import type { Meaning } from '../src/main/meaning';
import { SiteSorter } from '../src/main/sites';
import type { Item } from '../src/shared/types';
import { evalUrl, SITES, type EvalSite } from '../tests/fixtures/sites-eval';

const args = process.argv.slice(2);
const useAi = args.includes('--ai');
const set = args[args.indexOf('--set') + 1] ?? 'all';
const showMisses = args.includes('--misses');
const sites = SITES.filter((s) => set === 'all' || s.set === set);

const { load, embed } = createRequire(import.meta.url)('../embedder/embed.cjs');
const session = load('embedder/model');
const wp = new WordPiece(readFileSync('embedder/model/vocab.txt', 'utf8'));
const meaning: Meaning = {
  warm() {},
  async vectors(texts) {
    const vs: number[][] = await embed(await session, texts.map((t) => wp.encode(t)));
    return new Map(texts.map((t, i) => [t, vs[i]]));
  },
};

const install = randomUUID();
let calls = 0;
const ai = async (content: string) => {
  calls++;
  const res = await fetch(STASHD_AI, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ install, kind: 'sites', content, v: 'eval' }) });
  const out = (await res.json()) as { text?: string };
  if (!res.ok || !out.text) throw new Error(`Stashd AI said ${res.status}`);
  return out.text;
};

const tabs = (s: EvalSite): Item[] =>
  s.titles.map((t, n) => ({ key: `tab:${evalUrl(s.site, n)}`, kind: 'tab', label: t, detail: '', app: 'Google Chrome', url: evalUrl(s.site, n), browser: 'chrome' }));

function score(label: string, saysBreak: (s: EvalSite) => boolean) {
  const right = sites.filter((s) => saysBreak(s) === (s.truth === 'B'));
  const breaks = sites.filter((s) => s.truth === 'B');
  const work = sites.filter((s) => s.truth !== 'B');
  const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(1)}%`;
  console.log(`\n${label}: ${pct(right.length, sites.length)} right (${right.length}/${sites.length})`);
  console.log(`  break sites caught: ${pct(breaks.filter(saysBreak).length, breaks.length)} (${breaks.filter(saysBreak).length}/${breaks.length})`);
  console.log(`  work sites kept as work: ${pct(work.filter((s) => !saysBreak(s)).length, work.length)} (${work.filter((s) => !saysBreak(s)).length}/${work.length})`);
  if (showMisses) for (const s of sites.filter((x) => !right.includes(x))) console.log(`  ✗ ${s.truth} ${s.site}  "${s.titles[0]}"`);
}

(async () => {
  console.log(`${sites.length} sites (${set})`);
  const before = (s: EvalSite) => tabs(s).some(isBreakItem);
  score('Before (the built-in list only)', before);

  const sorter = new SiteSorter(mkdtempSync(path.join(tmpdir(), 'stashd-eval-')), { meaning: () => meaning, ai: () => null });
  setLearnedBreakSites([]);
  for (const s of sites) await sorter.look(tabs(s));
  const unsure = (await Promise.all(sites.map(async (s) => ((await sorter.kindOf(s.site.split('/')[0])) ? null : s)))).filter(Boolean);
  score("The Mac's own model", (s) => tabs(s).some(isBreakItem));
  console.log(`  left unsure (would go to Stashd AI): ${unsure.length}`);

  if (useAi) {
    // The same sorter, now with Stashd AI, asked for every unsure site (no hourly wait in a test).
    const withAi = sorter as unknown as { deps: { ai: () => typeof ai; now: () => number }; lastAi: number; askAi: () => Promise<void> };
    withAi.deps.ai = () => ai;
    for (let i = 0; i < 30; i++) {
      withAi.lastAi = 0;
      const n = calls;
      await withAi.askAi();
      if (calls === n) break;
    }
    score('Model + Stashd AI', (s) => tabs(s).some(isBreakItem));
    console.log(`  Stashd AI requests: ${calls}`);
  }
})();
