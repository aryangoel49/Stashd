import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { Item } from '../src/shared/types';
import { sortIntoWorks } from '../src/main/jobs/sort';
import { meaningText } from '../src/main/jobs/relevance';
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
  const texts = [...new Set(items.map(meaningText).filter((x): x is string => !!x))];
  const vs: number[][] = await embed(session, texts.map((x) => wp.encode(x)));
  const vectors = new Map(texts.map((x, i) => [x, vs[i]]));
  return (x: string) => vectors.get(x);
}
const sorted = (xs: Item[]) => xs.map((i) => i.label).sort();

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
    expect(works.map(sorted).sort()).toEqual([sorted(climate), sorted(stashd), sorted(trip)].sort());
  }, 60_000);

  it('another desk: AI research and the trip, with clutter in between', async () => {
    const ai = [aiDoc, aiTab1, nvidia, ml, automation];
    const desk = [aiTab1, dogs, flights, nvidia, earbuds, cnTower, aiDoc, linkedin, ml, hotels, recipe, automation, quest];
    const works = sortIntoWorks(desk, await vectorsFor(desk));
    expect(works.map(sorted).sort()).toEqual([sorted(ai), sorted(trip)].sort());
  }, 60_000);
});
