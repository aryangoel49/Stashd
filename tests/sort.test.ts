import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { Item } from '../src/shared/types';
import { likeness, sortIntoWorks, sortText } from '../src/main/jobs/sort';
import { WordPiece } from '../src/main/meaning/tokenizer';
import { aiDoc, aiTab1, automation, canva, cnTower, dogs, earbuds, essay, flights, glaciers, hotels, jakarta, jstor1, linkedin, ml, nvidia, quest, recipe, tab } from './meaning-fixtures';

const t = (label: string, url: string, extra: Partial<Item> = {}): Item => ({ key: `tab:${url}`, kind: 'tab', label, detail: '', app: 'Google Chrome', url, browser: 'chrome', ...extra });
const doc = (p: string): Item => ({ key: `doc:${p}`, kind: 'doc', label: p.split('/').pop()!, detail: '', app: 'Pages', path: p });
const names = (works: Item[][]) => works.map((w) => w.map((i) => i.label).sort());

describe('sortIntoWorks', () => {
  it('splits two pieces of work by shared words', () => {
    const works = sortIntoWorks([
      t('Sea level rise and climate change', 'https://a.com/1'),
      t('Javascript promises explained', 'https://b.com/2'),
      t('Climate change sea level data', 'https://c.com/3'),
      t('Javascript async promises guide', 'https://d.com/4'),
    ]);
    expect(names(works)).toEqual([
      ['Climate change sea level data', 'Sea level rise and climate change'],
      ['Javascript async promises guide', 'Javascript promises explained'],
    ]);
  });

  it('keeps a Chrome tab group together and files of one folder together', () => {
    const works = sortIntoWorks([
      t('Flights to Rome', 'https://x.com/a', { group: 'Trip' }),
      doc('/Users/me/Clients/Acme/brief.pages'),
      t('Hotel near Colosseum', 'https://y.com/b', { group: 'Trip' }),
      doc('/Users/me/Clients/Acme/invoice.pages'),
    ]);
    expect(works.map((w) => w.length)).toEqual([2, 2]);
  });

  it('saves nothing that fits with nothing else, or is just a front page', () => {
    expect(sortIntoWorks([t('Weather Rome', 'https://w.com/1'), t('Kubernetes pods', 'https://k.com/2'), t('Banana bread recipe', 'https://r.com/3')])).toEqual([]);
    expect(sortIntoWorks([t('Gmail', 'https://mail.google.com/'), t('Inbox (3) - Gmail', 'https://mail.google.com/')])).toEqual([]);
    expect(sortIntoWorks([t('Only one', 'https://o.com/x')])).toEqual([]);
  });
});

// The real case, with the real on-device model (skipped if `npm run embedder` hasn't been run): three pieces
// of work open at once, plus clutter. Each piece becomes its own folder; the clutter goes in none.
const ready = existsSync(`embedder/node_modules/onnxruntime-node/bin/napi-v6/darwin/${process.arch}`) && existsSync('embedder/model/model.onnx');

async function vectorsFor(items: Item[]) {
  const { load, embed } = createRequire(import.meta.url)('../embedder/embed.cjs');
  const session = await load('embedder/model');
  const wp = new WordPiece(readFileSync('embedder/model/vocab.txt', 'utf8'));
  const texts = [...new Set(items.map(sortText).filter((x): x is string => !!x))];
  const vs: number[][] = await embed(session, texts.map((x) => wp.encode(x)));
  const vectors = new Map(texts.map((x, i) => [x, vs[i]]));
  return (x: string) => vectors.get(x);
}
const sorted = (xs: Item[]) => xs.map((i) => i.label).sort();
/** Every folder made holds only one piece of work (never two mixed, never clutter), and every piece is found. */
function neverMixes(works: Item[][], pieces: Item[][]) {
  for (const w of works) expect(pieces.some((p) => w.every((i) => p.includes(i)))).toBe(true);
  for (const p of pieces) expect(works.some((w) => w.some((i) => p.includes(i)))).toBe(true);
}

describe.skipIf(!ready)('sorting a real desk, with the meaning model', () => {
  const stashd = [
    tab('https://github.com/aryangoel49/Stashd/pulls', 'Pull requests · aryangoel49/Stashd', 1),
    tab('https://vercel.com/aryangoel49/stashd/deployments', 'Deployments – stashd – Vercel', 1),
    tab('https://getstashd.vercel.app/install', 'Install Stashd', 1),
  ];
  const trip = [flights, cnTower, hotels];
  const climate = [essay, jstor1, jakarta, glaciers];
  const clutter = [dogs, earbuds, linkedin, canva, quest, recipe, tab('https://www.youtube.com/', 'YouTube', 9)];

  it('finds Stashd, the Toronto trip and the climate essay, and leaves the clutter out', async () => {
    const desk = [...clutter.slice(0, 3), ...trip, ...stashd, ...clutter.slice(3), ...climate];
    const works = sortIntoWorks(desk, await vectorsFor(desk));
    neverMixes(works, [climate, stashd, trip]);
    expect(works.map(sorted)).toContainEqual(sorted(stashd));
    expect(works.map(sorted)).toContainEqual(sorted(trip));
  }, 60_000);

  it('another desk: AI research and the trip, with clutter in between', async () => {
    const ai = [aiDoc, aiTab1, nvidia, ml, automation];
    const desk = [aiTab1, dogs, flights, nvidia, earbuds, cnTower, aiDoc, linkedin, ml, hotels, recipe, automation, quest];
    const works = sortIntoWorks(desk, await vectorsFor(desk));
    neverMixes(works, [ai, trip]);
  }, 60_000);

  it("Aryan's test desk (9 Nov): Stashd, Toronto, the climate essay and Acme apart; clutter and a 404 in none", async () => {
    const d = (p: string): Item => ({ key: `doc:${p}`, kind: 'doc', label: p.split('/').pop()!, detail: '', app: 'Microsoft Word', path: p });
    const desk = '/Users/a/Documents/Stashd test desk';
    const stashd = [
      tab('https://github.com/aryangoel49/Stashd', 'GitHub - aryangoel49/Stashd: Save your work and pick it up later', 1),
      tab('https://github.com/aryangoel49/Stashd/releases', 'Releases · aryangoel49/Stashd', 1),
      tab('https://github.com/aryangoel49/Stashd/issues', 'Issues · aryangoel49/Stashd', 1),
    ];
    const toronto = [
      tab('https://en.wikipedia.org/wiki/Toronto', 'Toronto - Wikipedia', 2),
      tab('https://www.booking.com/city/ca/toronto.html', '10 Best Toronto Hotels, Canada (From CAD 139)', 2),
      tab('https://www.tripadvisor.ca/Attractions-g155019-Activities-Toronto_Ontario.html', 'THE 15 BEST Things to Do in Toronto (2026) - Must-See Attractions', 2),
    ];
    const climate = [
      tab('https://en.wikipedia.org/wiki/Sea_level_rise', 'Sea level rise - Wikipedia', 2),
      tab('https://en.wikipedia.org/wiki/Effects_of_climate_change_on_oceans', 'Effects of climate change on oceans - Wikipedia', 2),
      d(`${desk}/School/Climate essay.docx`),
    ];
    const acme = [d(`${desk}/Clients/Acme/Acme budget.docx`), d(`${desk}/Clients/Acme/Acme proposal.docx`)];
    const junk = [
      tab('https://www.reddit.com/r/aww/', 'Aww: cute animals', 1),
      tab('https://www.youtube.com/', 'YouTube', 1),
      tab('https://www.allrecipes.com/recipe/11973/spaghetti-italian/', 'Spaghetti Italian Recipe', 2),
      tab('https://www.amazon.ca/s?k=wireless+earbuds', 'Amazon.ca : wireless earbuds', 2),
      tab('https://science.nasa.gov/earth/explore/sea-level/', 'Page not found - NASA Science', 2),
    ];
    const all = [stashd[0], junk[0], stashd[1], stashd[2], junk[1], toronto[0], climate[0], junk[2], toronto[1], junk[4], toronto[2], junk[3], climate[1], ...acme, climate[2]];
    const look = await vectorsFor(all);
    const works = sortIntoWorks(all, look);
    if (process.env.SORT_DEBUG) console.log(all.map((a) => a.label.slice(0, 16).padEnd(16) + all.map((b) => likeness(a, b, look).toFixed(2)).join(' ')).join('\n'));
    expect(works.map(sorted).sort()).toEqual([sorted(acme), sorted(climate), sorted(stashd), sorted(toronto)].sort());
  }, 60_000);
});

describe('whatsIn', async () => {
  const { whatsIn } = await import('../src/main/tidyflow');
  it('says what a new folder holds in plain words', () => {
    const tab1 = t('A', 'https://a.com/1');
    expect(whatsIn([tab1, t('B', 'https://b.com/2'), t('C', 'https://c.com/3')])).toBe('3 tabs');
    expect(whatsIn([tab1, t('B', 'https://b.com/2'), doc('/x/y.pages')])).toBe('2 tabs and a document');
  });
});
