// Everyday scenarios for "what belongs to this job", scored end to end: the everyday-app filter,
// word matching and the real on-device meaning model (skipped if `npm run embedder` hasn't been run).
// Each scenario says what the job is, what's related, and what's other work or clutter.
//
// Scoring, per item:
//   job item ticked: right; highlighted ("probably related"): half right; in "Not sure": missed
//   other item ticked: wrong (the worst mistake: it gets saved and closed); highlighted: noise

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { classify } from '../src/main/jobs/match';
import { jobProfile, meaningText, profileTexts, type MeaningLookup } from '../src/main/jobs/relevance';
import { WordPiece } from '../src/main/meaning/tokenizer';
import { DEFAULT_SETTINGS } from '../src/shared/validate';
import type { Item, Job } from '../src/shared/types';

const ready = existsSync('embedder/node_modules/onnxruntime-node') && existsSync('embedder/model/model.onnx');

const tab = (url: string, title: string, window = 1, active = false): Item => ({
  key: `tab:${url}`, kind: 'tab', label: title, detail: '', app: 'Google Chrome', url, browser: 'chrome', window, active,
});
const doc = (p: string, app = 'Microsoft Word', active = false): Item => ({ key: `doc:${p}`, kind: 'doc', label: p.split('/').pop()!, detail: '', app, path: p, active });
const untitled = (name: string, app = 'Microsoft Word', active = false): Item => ({ key: `untitled:${app}:${name}`, kind: 'doc', label: name, detail: '', app, untitled: true, active });
const app = (name: string): Item => ({ key: `app:${name}`, kind: 'app', label: name, detail: 'App', app: name });

export interface Scenario {
  name: string;
  /** Apps front to back (the first is where you were last). */
  appOrder: string[];
  /** For updating a saved job: its name, note and what it held last time. */
  saved?: { name: string; note?: string; items: Item[] };
  job: Item[];
  /** Fine either way (ticked or highlighted). */
  related?: Item[];
  other: Item[];
}

// ---------- the scenarios ----------

const sports = [
  tab('https://streameast.zip/', 'StreamEast.zip', 4),
  tab('https://totalsportek.pro/real-madrid', 'Watch Real Madrid at Barcelona Live Stream | TotalSportek', 4),
];
const netflix = tab('https://www.netflix.com/browse', 'Netflix', 5);
const amazon = tab('https://www.amazon.ca/x', 'Amazon.ca: Wireless Earbuds', 5);
const gmail = tab('https://mail.google.com/mail/u/0/#inbox', 'Inbox (3) - aryan@gmail.com - Gmail', 5);
const dogs = tab('https://www.reddit.com/r/aww', 'Cute dogs : aww', 5);
const insta = tab('https://www.instagram.com/', 'Instagram', 5);
const ytHome = tab('https://www.youtube.com/', 'YouTube', 5);

const econLecture = doc('/Users/a/Documents/School/ECON101_Lecture5.pdf', 'Preview');
const econLearn = tab('https://learn.uwaterloo.ca/d2l/home/1234', 'ECON 101 - Introduction to Microeconomics - Learn', 3);
const khan = tab('https://www.khanacademy.org/economics/supply-demand', 'Supply and demand | Khan Academy', 3);

const lisbonFlights = tab('https://www.google.com/travel/flights?q=yyz-lis', 'Toronto to Lisbon | Google Flights', 1, true);

export const SCENARIOS: Scenario[] = [
  {
    name: 'AI essay in a new Word document (never saved), with sports in another window',
    appOrder: ['Microsoft Word', 'Google Chrome', 'TextEdit', 'Preview'],
    job: [
      untitled('Document1', 'Microsoft Word', true),
      tab('https://www.google.com/search?q=ai+augmentation', 'ai augmentation - Google Search', 1, true),
      tab('https://www.microsoft.com/en-us/ai/augmentation', 'AI Augmentation: The Key to Uplifting Employees | Microsoft', 1),
      tab('https://www.consultancy.eu/what-is-ai-augmentation', 'What is AI Augmentation? | Consultancy.eu', 1),
      tab('https://sloanreview.mit.edu/ai-human-work', 'How AI Is Changing Human Work | MIT Sloan Management Review', 1),
    ],
    other: [...sports, netflix, untitled('Untitled', 'TextEdit'), doc('/Users/a/Desktop/Screenshot 2026-10-24 at 3.12.40 PM.png', 'Preview')],
  },
  {
    name: 'Planning a trip to Lisbon, with school work in another window',
    appOrder: ['Google Chrome', 'Preview'],
    job: [
      lisbonFlights,
      tab('https://www.google.com/maps/place/Lisbon', 'Lisbon, Portugal - Google Maps', 1),
      tab('https://www.tripadvisor.ca/Attractions-Lisbon', 'THE 15 BEST Things to Do in Lisbon (2026) - Tripadvisor', 1),
      tab('https://www.torrebelem.gov.pt/en/tickets', 'Belém Tower – Tickets and Opening Hours', 1),
      tab('https://www.booking.com/hotel/pt/avenida-palace', 'Hotel Avenida Palace, Lisbon – Updated 2026 Prices', 1),
      tab('https://www.google.com/search?q=pasteis+de+belem', 'pastéis de belém - Google Search', 1),
    ],
    related: [tab('https://www.amazon.ca/adapter', 'Amazon.ca: Universal Travel Adapter for Europe', 1), tab('https://www.timeanddate.com/weather/portugal/lisbon/ext', 'Lisbon 14 Day Extended Forecast', 1)],
    other: [econLecture, econLearn, khan, ytHome, gmail],
  },
  {
    name: 'Updating a saved internship application',
    appOrder: ['Google Chrome', 'Microsoft Word'],
    saved: {
      name: 'Shopify internship',
      items: [doc('/Users/a/Documents/Jobs/Aryan_Goel_Resume.docx'), tab('https://boards.greenhouse.io/shopify/1', 'Software Engineer Intern (Winter 2027) - Shopify | Greenhouse', 1)],
    },
    job: [
      doc('/Users/a/Documents/Jobs/Aryan_Goel_Resume.docx'),
      tab('https://boards.greenhouse.io/shopify/1', 'Software Engineer Intern (Winter 2027) - Shopify | Greenhouse', 1),
      doc('/Users/a/Documents/Jobs/Cover Letter - Shopify.docx', 'Microsoft Word', true),
      tab('https://www.glassdoor.ca/Interview/Shopify', 'Shopify Interview Questions | Glassdoor', 1, true),
      tab('https://www.linkedin.com/company/shopify', 'Shopify: Overview | LinkedIn', 1),
    ],
    related: [
      tab('https://www.indeed.com/career-advice/tell-me-about-yourself', 'How To Answer "Tell Me About Yourself" | Indeed.com', 1),
      tab('https://www.google.com/search?q=star+method+examples', 'star method examples - Google Search', 1),
    ],
    other: [netflix, amazon, lisbonFlights, ...sports],
  },
  {
    name: 'Apartment hunting, starting from a budget spreadsheet',
    appOrder: ['Numbers', 'Google Chrome'],
    job: [
      doc('/Users/a/Documents/Moving budget.numbers', 'Numbers', true),
      tab('https://www.kijiji.ca/b-apartments-condos/waterloo/2-bedroom', '2 Bedroom Apartments for Rent in Waterloo | Kijiji', 1, true),
      tab('https://rentals.ca/waterloo', 'Waterloo, ON Apartments for Rent - 412 Rentals | rentals.ca', 1),
      tab('https://www.google.com/search?q=average+utility+costs+ontario', 'average utility costs ontario - Google Search', 1),
      tab('https://www.ontario.ca/page/guide-ontarios-standard-lease', "Guide to Ontario's Standard Lease | ontario.ca", 1),
      tab('https://www.squareone.ca/tenant-insurance', 'Tenant Insurance Quote | Square One', 1),
    ],
    other: [...sports, insta, tab('https://chatgpt.com/', 'ChatGPT', 2)],
  },
  {
    name: 'Studying for an economics midterm (saved job, new study tabs)',
    appOrder: ['Google Chrome', 'Preview'],
    saved: { name: 'ECON 101 midterm', items: [econLecture, econLearn] },
    job: [
      econLecture,
      econLearn,
      tab('https://www.youtube.com/watch?v=elasticity', 'Price Elasticity of Demand Explained - YouTube', 3, true),
      tab('https://quizlet.com/econ101-midterm', 'ECON 101 Midterm Practice Flashcards | Quizlet', 3),
      khan,
    ],
    related: [tab('https://chatgpt.com/c/123', 'Elasticity vs Slope', 3)],
    other: [lisbonFlights, ...sports, dogs],
  },
  {
    name: 'Climate essay (saved), with tabs from a trip open too',
    appOrder: ['Microsoft Word', 'Google Chrome'],
    saved: {
      name: 'Climate essay',
      note: 'need 2 more sea level sources',
      items: [doc('/Users/a/Documents/School/Climate essay.docx'), tab('https://www.jstor.org/stable/1', 'Sea level rise in coastal cities | JSTOR', 3)],
    },
    job: [
      doc('/Users/a/Documents/School/Climate essay.docx', 'Microsoft Word', true),
      tab('https://www.jstor.org/stable/1', 'Sea level rise in coastal cities | JSTOR', 3),
      tab('https://www.ipcc.ch/report/ar6/syr/', 'AR6 Synthesis Report: Summary for Policymakers — IPCC', 3, true),
      tab('https://www.nytimes.com/miami-flooding', 'Miami Is Flooding More Often. Here’s Why. - The New York Times', 3),
    ],
    other: [
      tab('https://www.expedia.ca/flights', 'Cheap Flights to Toronto | Expedia', 5),
      tab('https://www.cntower.ca/tickets', 'CN Tower Tickets', 5),
      amazon,
    ],
  },
  {
    name: 'Watching soccer, with a receipt in Preview and a TextEdit scratch note',
    appOrder: ['Google Chrome', 'Preview', 'TextEdit', 'Calculator'],
    job: [
      tab('https://streameast.zip/', 'StreamEast.zip', 1, true),
      tab('https://totalsportek.pro/real-madrid', 'Watch Real Madrid at Barcelona Live Stream | TotalSportek', 1),
      tab('https://streamking.cc/', 'StreamKing - Free NBA, NFL, NHL, MLB, Soccer Streams', 1),
      tab('https://www.google.com/search?q=ovo+goal', 'ovo goal - Google Search', 1),
    ],
    related: [tab('https://www.bbc.com/sport/football/tables', 'Premier League Table - BBC Sport', 1)],
    other: [doc('/Users/a/Downloads/receipt-4471.pdf', 'Preview'), untitled('Untitled', 'TextEdit'), app('Calculator'), dogs],
  },
  {
    name: 'A marketing plan in Google Docs',
    appOrder: ['Google Chrome'],
    job: [
      tab('https://docs.google.com/document/d/abc/edit', 'Q4 Marketing Plan - Google Docs', 1, true),
      tab('https://blog.hootsuite.com/instagram-engagement-rate', 'Instagram Engagement Rate Benchmarks for 2026 | Hootsuite', 1),
      tab('https://blog.hubspot.com/marketing/marketing-plan', 'How to Write a Marketing Plan (+ Free Template) | HubSpot', 1),
      tab('https://www.canva.com/design/xyz', 'Q4 Instagram posts - Canva', 1),
      tab('https://docs.google.com/spreadsheets/d/def/edit', 'Competitor analysis - Google Sheets', 1),
    ],
    other: [tab('https://www.expedia.ca/flights', 'Cheap Flights to Toronto | Expedia', 2), tab('https://www.espn.com/nba', 'NBA Scores and Standings - ESPN', 2), dogs],
  },
  {
    name: 'Birthday gift shopping, with school and sports open',
    appOrder: ['Google Chrome', 'Preview'],
    job: [
      tab('https://www.google.com/search?q=birthday+gift+ideas+for+mom', 'birthday gift ideas for mom - Google Search', 1, true),
      tab('https://ca.pandora.net/en/charms', 'Charms for Bracelets | Pandora CA', 1),
      tab('https://www.etsy.com/listing/1/personalized-necklace', 'Personalized Name Necklace - Etsy Canada', 1),
      tab('https://www.indigo.ca/cookbooks', 'Bestselling Cookbooks | Indigo', 1),
    ],
    related: [amazon],
    other: [econLecture, econLearn, ...sports],
  },
  {
    name: 'A saved job with a Word file that was renamed and a new Google search',
    appOrder: ['Microsoft Word', 'Google Chrome'],
    saved: {
      name: 'AI augmentation essay',
      items: [untitled('Document1'), tab('https://www.microsoft.com/en-us/ai/augmentation', 'AI Augmentation: The Key to Uplifting Employees | Microsoft', 1)],
    },
    job: [
      doc('/Users/a/Documents/AI augmentation.docx', 'Microsoft Word', true),
      tab('https://www.microsoft.com/en-us/ai/augmentation', 'AI Augmentation: The Key to Uplifting Employees | Microsoft', 1),
      tab('https://www.google.com/search?q=human+in+the+loop+examples', 'human in the loop examples - Google Search', 1, true),
      tab('https://hbr.org/2018/07/collaborative-intelligence', 'Collaborative Intelligence: Humans and AI Are Joining Forces | HBR', 1),
    ],
    other: [...sports, netflix, insta],
  },
];

// ---------- running and scoring ----------

const vectors = new Map<string, number[]>();
const lookup: MeaningLookup = (t) => vectors.get(t);
let embedder: { session: unknown; wp: WordPiece; embed: (s: unknown, b: number[][]) => Promise<number[][]> } | null = null;

async function embedAll(texts: string[]) {
  if (!embedder) {
    const { load, embed } = createRequire(import.meta.url)('../embedder/embed.cjs');
    embedder = { session: await load('embedder/model'), wp: new WordPiece(readFileSync('embedder/model/vocab.txt', 'utf8')), embed };
  }
  const todo = [...new Set(texts)].filter((t) => !vectors.has(t));
  for (let i = 0; i < todo.length; i += 32) {
    const chunk = todo.slice(i, i + 32);
    const vs = await embedder.embed(embedder.session, chunk.map((t) => embedder!.wp.encode(t)));
    chunk.forEach((t, j) => vectors.set(t, vs[j]));
  }
}

export async function runScenario(s: Scenario) {
  const items = [...s.job, ...(s.related ?? []), ...s.other];
  // Same order as a real capture: by app, front app first.
  const rank = (a: string) => (s.appOrder.indexOf(a) + 1 || 99);
  items.sort((a, b) => rank(a.app) - rank(b.app));
  const job: Job | null = s.saved ? ({ id: 'j', name: s.saved.name, createdAt: '', updatedAt: '', done: false, prefs: { hide: {}, add: {} } } as unknown as Job) : null;
  const profile = s.saved ? jobProfile(s.saved.name, s.saved.note ?? '', s.saved.items) : null;
  await embedAll([...items.map(meaningText).filter((t): t is string => !!t), ...(profile ? profileTexts(profile) : [])]);
  const { frontItemKey } = await import('../src/main/capture');
  const r = classify({
    items,
    job,
    previous: s.saved?.items ?? [],
    name: s.saved?.name ?? '',
    note: s.saved?.note ?? '',
    settings: DEFAULT_SETTINGS,
    frontKey: frontItemKey(items, s.appOrder),
    meaning: lookup,
  });
  const place = (it: Item) => (r.sure.includes(it) ? 'sure' : r.likely.includes(it) ? 'likely' : r.maybe.includes(it) ? 'maybe' : 'hidden');
  const missed = s.job.filter((i) => place(i) === 'maybe').map((i) => i.label);
  const weak = s.job.filter((i) => place(i) === 'likely').map((i) => i.label);
  const wrong = s.other.filter((i) => place(i) === 'sure').map((i) => i.label);
  const noise = s.other.filter((i) => place(i) === 'likely').map((i) => i.label);
  const score = s.job.length + s.other.length - missed.length - 0.5 * weak.length - 1.5 * wrong.length - 0.25 * noise.length;
  return { missed, weak, wrong, noise, score: score / (s.job.length + s.other.length), why: r.why, place };
}

describe.skipIf(!ready)('everyday scenarios', () => {
  const results: { name: string; score: number }[] = [];
  for (const s of SCENARIOS) {
    it(s.name, async () => {
      const r = await runScenario(s);
      results.push({ name: s.name, score: r.score });
      const lines = [`\n## ${s.name}: ${(r.score * 100).toFixed(0)}%`];
      if (r.missed.length) lines.push(`  missed: ${r.missed.join(' / ')}`);
      if (r.weak.length) lines.push(`  only highlighted: ${r.weak.join(' / ')}`);
      if (r.wrong.length) lines.push(`  WRONGLY ticked: ${r.wrong.map((l) => `${l} (${r.why[[...s.other].find((i) => i.label === l)!.key] ?? ''})`).join(' / ')}`);
      if (r.noise.length) lines.push(`  highlighted but unrelated: ${r.noise.join(' / ')}`);
      console.log(lines.join('\n'));
      expect(r.score).toBeGreaterThan(-10);
    });
  }
  it('overall', () => {
    const avg = results.reduce((a, b) => a + b.score, 0) / results.length;
    console.log(`\nOVERALL ${(avg * 100).toFixed(1)}%`);
  });
});
