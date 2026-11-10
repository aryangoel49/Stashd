// How well Smart Tidy all sorts real-looking desks, scored with the real on-device model (skipped if
// `npm run embedder` hasn't been run). Each desk lists its pieces of work and its clutter. The score:
//   precision: of the things put together, how many really belong together (mixing work is the worst mistake)
//   recall:    of the things that belong together, how many were put together
//   clutter:   clutter saved into a folder (should be 0)
//   lost:      work closed without being saved anywhere
// Run with SORT_BENCH=<file> to write the table there.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { Item } from '../src/shared/types';
import { sortIntoWorks, sortText } from '../src/main/jobs/sort';
import { WordPiece } from '../src/main/meaning/tokenizer';

let n = 0;
const tab = (url: string, label: string, window = 1): Item => ({ key: `tab:${url}#${n++}`, kind: 'tab', label, detail: '', app: 'Google Chrome', url, browser: 'chrome', window });
const doc = (p: string, app = 'Microsoft Word'): Item => ({ key: `doc:${p}`, kind: 'doc', label: p.split('/').pop()!, detail: '', app, path: p });
const chat = (title: string): Item => ({ key: `chat:${title}`, kind: 'app', label: 'Claude', detail: '', app: 'Claude', chat: { title } } as Item);

interface Desk {
  name: string;
  work: Item[][];
  clutter: Item[];
}

const clutterSet = () => [
  tab('https://www.reddit.com/r/aww/comments/1', 'My dog learned a new trick : r/aww', 9),
  tab('https://www.amazon.com/dp/B0', 'Amazon.com: Sony WH-1000XM6 Wireless Headphones', 9),
  tab('https://twitter.com/elonmusk/status/1', 'Elon Musk on X: "..."', 9),
  tab('https://www.allrecipes.com/recipe/1/banana-bread', 'Banana Banana Bread Recipe | Allrecipes', 9),
  tab('https://www.espn.com/nba/game/_/gameId/1', 'Lakers vs. Celtics - Game Recap - ESPN', 9),
];

const DESKS: Desk[] = [
  {
    name: 'Two clients, same kinds of documents',
    work: [
      [doc('/Users/a/Clients/Acme/Proposal.docx'), doc('/Users/a/Clients/Acme/Budget.xlsx', 'Microsoft Excel'), tab('https://acme.com/about', 'About Acme Corp | Industrial Supplies')],
      [doc('/Users/a/Clients/Globex/Proposal.docx'), doc('/Users/a/Clients/Globex/Budget.xlsx', 'Microsoft Excel'), tab('https://globex.com/team', 'Our Team - Globex Corporation')],
    ],
    clutter: clutterSet().slice(0, 2),
  },
  {
    name: 'Coding: one app, plus an unrelated bug hunt',
    work: [
      [
        tab('https://github.com/me/recipe-app', 'GitHub - me/recipe-app: Share recipes with friends'),
        tab('https://github.com/me/recipe-app/pull/12', 'Add search bar by me · Pull Request #12 · me/recipe-app'),
        tab('https://react.dev/reference/react/useState', 'useState – React'),
        tab('https://stackoverflow.com/questions/1/react-usestate-not-updating', 'React useState not updating immediately - Stack Overflow'),
      ],
      [
        tab('https://github.com/me/payments-api/issues/40', 'Stripe webhook returns 400 · Issue #40 · me/payments-api', 2),
        tab('https://stripe.com/docs/webhooks', 'Receive Stripe events in your webhook endpoint | Stripe Documentation', 2),
        tab('https://stackoverflow.com/questions/2/stripe-webhook-signature', 'Stripe webhook signature verification failed - Stack Overflow', 2),
      ],
    ],
    clutter: clutterSet().slice(1, 4),
  },
  {
    name: 'A trip with no shared words between tabs',
    work: [
      [
        tab('https://www.google.com/travel/flights/search?q=lisbon', 'Flights to Lisbon - Google Flights'),
        tab('https://www.airbnb.com/rooms/1', 'Alfama loft with river view - Airbnb'),
        tab('https://www.timeout.com/lisbon/restaurants', 'The 30 best restaurants in Lisbon right now'),
        tab('https://www.visitportugal.com/en/content/sintra', 'Sintra | Visit Portugal'),
      ],
    ],
    clutter: clutterSet(),
  },
  {
    name: 'Only clutter',
    work: [],
    clutter: [...clutterSet(), tab('https://www.youtube.com/watch?v=1', 'lofi hip hop radio - beats to relax/study to', 9), tab('https://news.ycombinator.com/item?id=1', 'Show HN: A tiny database | Hacker News', 9)],
  },
  {
    name: 'School: two courses at once',
    work: [
      [
        doc('/Users/a/Documents/School/BIO 101/Lab report 3.docx'),
        tab('https://en.wikipedia.org/wiki/Photosynthesis', 'Photosynthesis - Wikipedia'),
        tab('https://www.khanacademy.org/science/biology/photosynthesis', 'Photosynthesis | Biology | Khan Academy'),
      ],
      [
        doc('/Users/a/Documents/School/HIST 210/Essay - French Revolution.docx'),
        tab('https://en.wikipedia.org/wiki/French_Revolution', 'French Revolution - Wikipedia'),
        tab('https://www.britannica.com/event/Reign-of-Terror', 'Reign of Terror | Definition, History, & Facts | Britannica'),
      ],
    ],
    clutter: clutterSet().slice(2),
  },
  {
    name: 'AI chats with their work',
    work: [
      [chat('Help me write a cover letter for a data analyst job'), doc('/Users/a/Documents/Job hunt/Cover letter - Shopify.docx'), tab('https://www.shopify.com/careers/data-analyst', 'Data Analyst - Shopify Careers')],
      [chat('Plan a 5 day Japan itinerary'), tab('https://www.japan-guide.com/e/e2164.html', 'Kyoto Travel Guide - japan-guide.com'), tab('https://www.jrpass.com/', 'Japan Rail Pass | JR Pass')],
    ],
    clutter: clutterSet().slice(0, 3),
  },
  {
    name: 'Shopping research is a task, a single tab is not',
    work: [
      [
        tab('https://www.rtings.com/laptop/reviews/best/by-usage/programming', 'The 6 Best Laptops For Programming - Winter 2026: Reviews - RTINGS.com'),
        tab('https://www.apple.com/macbook-air/', 'MacBook Air 13- and 15-inch with M5 - Apple'),
        tab('https://www.theverge.com/laptop-review/1', 'Dell XPS 14 review: the laptop to beat - The Verge'),
      ],
    ],
    clutter: [tab('https://www.amazon.com/dp/B1', 'Amazon.com: Stanley Quencher Tumbler 40 oz', 9), ...clutterSet().slice(2)],
  },
  {
    name: 'A big messy desk: five pieces of work, mixed windows',
    work: [
      [tab('https://docs.google.com/document/d/1/edit', 'Q3 marketing plan - Google Docs'), tab('https://analytics.google.com/analytics/web/#/report', 'Reports snapshot - Analytics'), tab('https://www.hubspot.com/marketing-statistics', '2026 Marketing Statistics, Trends & Data - HubSpot')],
      [tab('https://www.zillow.com/homedetails/1', '12 Oak St, Austin, TX | Zillow', 2), tab('https://www.bankrate.com/mortgages/mortgage-calculator/', 'Mortgage Calculator | Bankrate', 2), tab('https://www.redfin.com/TX/Austin/home/2', '45 Elm Ave, Austin, TX 78704 | Redfin')],
      [tab('https://www.figma.com/design/1/Onboarding', 'Onboarding flow – Figma', 2), tab('https://www.figma.com/design/2/Onboarding-v2', 'Onboarding v2 – Figma'), tab('https://mobbin.com/flows/onboarding', 'Onboarding flows | Mobbin', 2)],
      [doc('/Users/a/Documents/Taxes 2026/W-2.pdf', 'Preview'), doc('/Users/a/Documents/Taxes 2026/1099-INT.pdf', 'Preview'), tab('https://www.irs.gov/filing', 'File Your Taxes for Free | Internal Revenue Service')],
      [tab('https://www.coursera.org/learn/machine-learning/lecture/1', 'Gradient Descent - Supervised Machine Learning | Coursera'), tab('https://www.youtube.com/watch?v=sDv4f4s2SB8', 'Gradient Descent, Step-by-Step - YouTube', 2)],
    ],
    clutter: clutterSet(),
  },
];

const ready = existsSync(`embedder/node_modules/onnxruntime-node/bin/napi-v6/darwin/${process.arch}`) && existsSync('embedder/model/model.onnx');

describe.skipIf(!ready)('Smart Tidy all accuracy', () => {
  it('scores every desk', async () => {
    const { load, embed } = createRequire(import.meta.url)('../embedder/embed.cjs');
    const session = await load('embedder/model');
    const wp = new WordPiece(readFileSync('embedder/model/vocab.txt', 'utf8'));
    let tp = 0, fp = 0, fn = 0, clutterSaved = 0, lost = 0, workTotal = 0, clutterTotal = 0;
    const rows: string[] = [];
    for (const d of DESKS) {
      const all = [...d.work.flat(), ...d.clutter].sort(() => 0); // order as listed
      const interleaved = all.map((x, i) => ({ x, k: (i * 7) % all.length })).sort((a, b) => a.k - b.k).map((a) => a.x);
      const texts = [...new Set(interleaved.map(sortText).filter((x): x is string => !!x))];
      const vs: number[][] = await embed(session, texts.map((x) => wp.encode(x)));
      const map = new Map(texts.map((x, i) => [x, vs[i]]));
      const works = sortIntoWorks(interleaved, (x) => map.get(x));
      const truth = new Map<Item, number>();
      d.work.forEach((w, g) => w.forEach((i) => truth.set(i, g)));
      const got = new Map<Item, number>();
      works.forEach((w, g) => w.forEach((i) => got.set(i, g)));
      let dtp = 0, dfp = 0, dfn = 0;
      for (let i = 0; i < interleaved.length; i++)
        for (let j = i + 1; j < interleaved.length; j++) {
          const a = interleaved[i], b = interleaved[j];
          const same = truth.has(a) && truth.get(a) === truth.get(b);
          const put = got.has(a) && got.get(a) === got.get(b);
          if (same && put) dtp++;
          else if (put) dfp++;
          else if (same) dfn++;
        }
      const dClutter = d.clutter.filter((c) => got.has(c)).length;
      const dLost = d.work.flat().filter((w) => !got.has(w)).length;
      tp += dtp; fp += dfp; fn += dfn; clutterSaved += dClutter; lost += dLost;
      workTotal += d.work.flat().length; clutterTotal += d.clutter.length;
      if (process.env.SORT_BENCH) rows.push(...works.map((w) => '   [' + w.map((i) => i.label.slice(0, 28)).join(' | ') + ']'));
      rows.push(`${d.name.padEnd(52)} folders ${works.length}/${d.work.length}  mixed pairs ${dfp}  missed pairs ${dfn}  clutter saved ${dClutter}  work lost ${dLost}`);
    }
    const precision = tp / Math.max(1, tp + fp);
    const recall = tp / Math.max(1, tp + fn);
    const f1 = (2 * precision * recall) / Math.max(1e-9, precision + recall);
    if (process.env.SORT_BENCH) {
      writeFileSync(process.env.SORT_BENCH, rows.join("\n") + "\n");
      appendFileSync(process.env.SORT_BENCH, `precision ${(precision * 100).toFixed(0)}%  recall ${(recall * 100).toFixed(0)}%  F1 ${(f1 * 100).toFixed(0)}%  clutter saved ${clutterSaved}/${clutterTotal}  work lost ${lost}/${workTotal}`);
    }
    expect(f1).toBeGreaterThan(0); // a report, not a gate
  }, 120_000);
});
