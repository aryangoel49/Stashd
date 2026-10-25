// The same real-life scenarios, now with the on-device meaning model switched on.
// Uses the real model (skipped if `npm run embedder` hasn't been run).

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { learn, learnedAvoid, classify } from '../src/main/jobs/match';
import { group, jobFit, jobProfile, meaningText, profileTexts, FIT_SUGGEST, type MeaningLookup, type Profile } from '../src/main/jobs/relevance';
import { WordPiece } from '../src/main/meaning/tokenizer';
import type { Item, Job } from '../src/shared/types';

const ready = existsSync('embedder/node_modules/onnxruntime-node') && existsSync('embedder/model/model.onnx');

const tab = (url: string, title: string, window = 1): Item => ({ key: `tab:${url}`, kind: 'tab', label: title, detail: '', app: 'Google Chrome', url, browser: 'chrome', window });
const doc = (p: string, app = 'Microsoft Word'): Item => ({ key: `doc:${p}`, kind: 'doc', label: p.split('/').pop()!, detail: '', app, path: p });
const app = (name: string): Item => ({ key: `app:${name}`, kind: 'app', label: name, detail: 'App', app: name });
const labels = (xs: Item[]) => xs.map((i) => i.label).sort();

// Soccer
const streamKing = tab('https://streamking.cc/', 'StreamKing - Free NBA, NFL, NHL, MLB, Soccer Streams');
const ovo = tab('https://www.google.com/search?q=ovo+goal', 'ovo goal - Google Search');
const madrid = tab('https://totalsportek.pro/real-madrid', 'Watch Real Madrid at Barcelona Live Stream | TotalSportek');
const streamEast = tab('https://streameast.zip/', 'StreamEast.zip');
const nba = tab('https://www.espn.com/nba', 'NBA Scores and Standings - ESPN', 8);
const premier = tab('https://www.bbc.com/sport/football/tables', 'Premier League Table - BBC Sport', 8);
// AI research
const aiDoc = doc('/Users/a/Documents/ai research.docx');
const aiTab1 = tab('https://www.microsoft.com/en-us/ai/augmentation', 'AI Augmentation: The Key to Uplifting Employees | Microsoft', 2);
const nvidia = tab('https://www.nvidia.com/en-us/lp/ai/blueprint', 'Blueprint for AI Success eBook | Download & Build | NVIDIA', 2);
const ml = tab('https://hbr.org/ml-workplace', 'How machine learning is changing the workplace | HBR', 3);
const automation = tab('https://www.mckinsey.com/automation', 'Automation and the future of jobs | McKinsey', 3);
// Climate
const essay = doc('/Users/a/Documents/School/Climate essay.docx');
const jstor1 = tab('https://www.jstor.org/stable/1', 'Sea level rise in coastal cities | JSTOR', 3);
const jakarta = tab('https://www.bbc.com/news/1', 'Jakarta is sinking', 3);
const glaciers = tab('https://www.nationalgeographic.com/glaciers', 'Why the glaciers are melting faster | National Geographic', 4);
// Toronto
const flights = tab('https://www.expedia.ca/flights', 'Cheap Flights to Toronto | Expedia', 5);
const cnTower = tab('https://www.cntower.ca/tickets', 'CN Tower Tickets', 6);
const hotels = tab('https://www.booking.com/union-station', 'Hotels near Union Station', 6);
// Clutter
const dogs = tab('https://www.reddit.com/r/aww', 'Cute dogs : aww', 9);
const earbuds = tab('https://www.amazon.ca/x', 'Amazon.ca: Wireless Earbuds', 9);
const linkedin = tab('https://www.linkedin.com/jobs', 'Jobs | LinkedIn', 9);
const canva = tab('https://www.canva.com/design', 'Untitled design - Canva', 9);
const quest = tab('https://www.uwaterloo.ca/quest', 'Quest - University of Waterloo', 9);
const recipe = tab('https://www.allrecipes.com/pasta', 'Easy Weeknight Pasta Recipe | Allrecipes', 9);
const preview = app('Preview');
const textEdit = app('TextEdit');
const clutter = [dogs, earbuds, linkedin, canva, quest, recipe];

let vectors = new Map<string, number[]>();
const lookup: MeaningLookup = (t) => vectors.get(t);

async function embedAll(texts: string[]) {
  const { load, embed } = createRequire(import.meta.url)('../embedder/embed.cjs');
  const session = await load('embedder/model');
  const wp = new WordPiece(readFileSync('embedder/model/vocab.txt', 'utf8'));
  const todo = [...new Set(texts)].filter((t) => !vectors.has(t));
  if (!todo.length) return;
  const vs: number[][] = await embed(session, todo.map((t) => wp.encode(t)));
  todo.forEach((t, i) => vectors.set(t, vs[i]));
}
const texts = (items: Item[], profile?: Profile | null) => [...items.map(meaningText).filter((t): t is string => !!t), ...(profile ? profileTexts(profile) : [])];

async function sort(items: Item[], profile: Profile | null, frontKey: string) {
  await embedAll(texts(items, profile));
  const g = group({ candidates: items, profile, frontKey, meaning: lookup });
  return { sure: labels(g.sure), likely: labels(g.likely), maybe: labels(g.maybe), why: g.why };
}

describe.skipIf(!ready)('with the meaning model', () => {
  beforeAll(() => {
    vectors = new Map();
  });

  it('soccer: Real Madrid and StreamEast join, sports elsewhere is "probably related", the rest is not', async () => {
    const r = await sort([streamKing, ovo, madrid, streamEast, nba, premier, ...clutter, preview, textEdit], null, streamKing.key);
    console.log('soccer', r);
    // NBA shares "NBA" with the StreamKing tab you were on, so it's in too, and the Premier League
    // table is close in meaning to the matches being streamed.
    expect(r.sure).toEqual(expect.arrayContaining(labels([streamKing, madrid, streamEast, nba])));
    expect(r.sure.concat(r.likely)).toEqual(expect.arrayContaining(labels([ovo, premier])));
    for (const c of [...clutter, preview, textEdit]) expect(r.sure.concat(r.likely)).not.toContain(c.label);
  });

  it('ai research: AI tabs join, and articles about machine learning and automation are spotted with no shared words', async () => {
    const p = jobProfile('ai research', '', [aiDoc]);
    const r = await sort([aiDoc, aiTab1, nvidia, ml, automation, ...clutter, preview], p, aiDoc.key);
    console.log('ai', r);
    expect(r.sure).toEqual(expect.arrayContaining(labels([aiDoc, aiTab1, nvidia])));
    expect(r.sure.concat(r.likely)).toEqual(expect.arrayContaining(labels([ml, automation])));
    for (const c of clutter) expect(r.sure).not.toContain(c.label);
  });

  it('climate essay: Jakarta sinking and melting glaciers are recognised as the same topic', async () => {
    const p = jobProfile('Climate essay', 'need 2 more sea level sources', [essay, jstor1]);
    const r = await sort([essay, jstor1, jakarta, glaciers, ...clutter], p, essay.key);
    console.log('climate', r);
    expect(r.sure.concat(r.likely)).toEqual(expect.arrayContaining(labels([jakarta, glaciers])));
    for (const c of clutter) expect(r.sure.concat(r.likely)).not.toContain(c.label);
  });

  it('toronto trip: CN Tower belongs, without saying "Toronto"', async () => {
    const p = jobProfile('Toronto trip', '', [flights]);
    const r = await sort([flights, cnTower, hotels, ...clutter], p, flights.key);
    console.log('toronto', r);
    expect(r.sure.concat(r.likely)).toContain(cnTower.label);
    // "Hotels near Union Station" is too subtle for the small model (it doesn't know Union Station is in Toronto).
    expect(r.maybe).toContain(hotels.label);
    for (const c of clutter) expect(r.sure).not.toContain(c.label);
  });

  it('picks the right job from meaning alone', async () => {
    const jobs = {
      ai: jobProfile('ai research', '', [aiDoc]),
      soccer: jobProfile('Soccer Streams', '', [streamKing]),
      climate: jobProfile('Climate essay', '', [essay, jstor1]),
      toronto: jobProfile('Toronto trip', '', [flights]),
    };
    const best = async (open: Item[]) => {
      await embedAll([...texts(open), ...Object.values(jobs).flatMap((p) => profileTexts(p))]);
      return Object.entries(jobs).map(([k, p]) => [k, jobFit(open, p, lookup)] as const).sort((a, b) => b[1] - a[1]);
    };
    const s = await best([madrid, nba, premier]);
    console.log('fit sport', s);
    expect(s[0][0]).toBe('soccer');
    expect((await best([ml, automation]))[0][0]).toBe('ai');
    expect((await best([jakarta, glaciers]))[0][0]).toBe('climate');
    expect((await best([cnTower, flights]))[0][0]).toBe('toronto');
    const none = await best([dogs, recipe, earbuds]);
    console.log('fit clutter', none);
    expect(none[0][1]).toBeLessThan(FIT_SUGGEST);
  });

  it('learns from what you leave out: similar titles and the same site start unticked', async () => {
    const job: Job = { id: 'ai', name: 'ai research', createdAt: '', updatedAt: '', done: false, prefs: { hide: {}, add: {} } } as unknown as Job;
    const settings = { lifestyleApps: [], lifestyleSites: [] };
    const indeed = tab('https://ca.indeed.com/jobs', 'Software developer jobs in Waterloo | Indeed', 9);
    const linkedin2 = tab('https://www.linkedin.com/jobs/view/2', 'AI Engineer jobs | LinkedIn', 9);
    // Twice, you leave the LinkedIn jobs tab out of "ai research".
    for (let i = 0; i < 2; i++) {
      const offered = classify({ items: [aiDoc, aiTab1, linkedin], job, previous: [aiDoc], name: job.name, settings, frontKey: aiDoc.key, meaning: lookup });
      await embedAll(texts([aiDoc, aiTab1, linkedin]));
      job.prefs = learn(job.prefs, offered, [aiDoc.key, aiTab1.key]);
    }
    expect(job.prefs.leftOut).toContain('Jobs | LinkedIn');
    expect(learnedAvoid(job.prefs).avoidHosts).toEqual(['linkedin.com']);
    const p = jobProfile('ai research', '', [aiDoc, aiTab1], learnedAvoid(job.prefs));
    const r = await sort([aiDoc, aiTab1, indeed, linkedin2], p, aiDoc.key);
    console.log('learned', r);
    expect(r.sure).not.toContain(indeed.label);
    expect(r.sure).not.toContain(linkedin2.label);
    expect(r.why[linkedin2.key]).toMatch(/leave out linkedin\.com/);
  });
});
