// The test desks for Smart Tidy all: realistic mixes of pieces of work and clutter, and how a sorting is
// scored against them. Used by the on-device score (sort-bench) and the Claude score (sort-claude).

import type { Item } from '../src/shared/types';

let n = 0;
const tab = (url: string, label: string, window = 1): Item => ({ key: `tab:${url}#${n++}`, kind: 'tab', label, detail: '', app: 'Google Chrome', url, browser: 'chrome', window });
const doc = (p: string, app = 'Microsoft Word'): Item => ({ key: `doc:${p}`, kind: 'doc', label: p.split('/').pop()!, detail: '', app, path: p });
const chat = (title: string): Item => ({ key: `chat:${title}`, kind: 'app', label: 'Claude', detail: '', app: 'Claude', chat: { title } } as Item);

export interface Desk {
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

export const DESKS: Desk[] = [
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

// Aryan's own test desk (9 Nov), as it was captured.
DESKS.push({
  name: "Aryan's test desk (9 Nov)",
  work: [
    [tab('https://github.com/aryangoel49/Stashd', 'GitHub - aryangoel49/Stashd: Save your work and pick it up later'), tab('https://github.com/aryangoel49/Stashd/releases', 'Releases · aryangoel49/Stashd'), tab('https://github.com/aryangoel49/Stashd/issues', 'Issues · aryangoel49/Stashd')],
    [tab('https://en.wikipedia.org/wiki/Toronto', 'Toronto - Wikipedia', 2), tab('https://www.booking.com/city/ca/toronto.html', '10 Best Toronto Hotels, Canada (From CAD 139)', 2), tab('https://www.tripadvisor.ca/Attractions-g155019-Activities-Toronto_Ontario.html', 'THE 15 BEST Things to Do in Toronto (2026) - Must-See Attractions', 2)],
    [tab('https://en.wikipedia.org/wiki/Sea_level_rise', 'Sea level rise - Wikipedia', 2), tab('https://en.wikipedia.org/wiki/Effects_of_climate_change_on_oceans', 'Effects of climate change on oceans - Wikipedia', 2), doc('/Users/a/Documents/Stashd test desk/School/Climate essay.docx')],
    [doc('/Users/a/Documents/Stashd test desk/Clients/Acme/Acme budget.docx'), doc('/Users/a/Documents/Stashd test desk/Clients/Acme/Acme proposal.docx')],
  ],
  clutter: [tab('https://www.reddit.com/r/aww/', 'Aww: cute animals'), tab('https://www.youtube.com/', 'YouTube'), tab('https://www.allrecipes.com/recipe/11973/spaghetti-italian/', 'Spaghetti Italian Recipe', 2), tab('https://www.amazon.ca/s?k=wireless+earbuds', 'Amazon.ca : wireless earbuds', 2), tab('https://science.nasa.gov/earth/explore/sea-level/', 'Page not found - NASA Science', 2)],
});

/** A desk's things in a mixed-up order, as a real desk would be. */
export function shuffled(d: Desk): Item[] {
  const all = [...d.work.flat(), ...d.clutter];
  return all.map((x, i) => ({ x, k: (i * 7) % all.length })).sort((a, b) => a.k - b.k).map((a) => a.x);
}

export interface Score {
  tp: number;
  fp: number;
  fn: number;
  clutterSaved: number;
  lost: number;
  work: number;
  clutter: number;
}

/** Scores one sorting of a desk: pairs put together rightly (tp) and wrongly (fp), pairs missed (fn). */
export function scoreDesk(d: Desk, works: Item[][]): Score {
  const items = shuffled(d);
  const truth = new Map<Item, number>();
  d.work.forEach((w, g) => w.forEach((i) => truth.set(i, g)));
  const got = new Map<Item, number>();
  works.forEach((w, g) => w.forEach((i) => got.set(i, g)));
  const s: Score = { tp: 0, fp: 0, fn: 0, clutterSaved: 0, lost: 0, work: d.work.flat().length, clutter: d.clutter.length };
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      const same = truth.has(a) && truth.get(a) === truth.get(b);
      const put = got.has(a) && got.get(a) === got.get(b);
      if (same && put) s.tp++;
      else if (put) s.fp++;
      else if (same) s.fn++;
    }
  s.clutterSaved = d.clutter.filter((c) => got.has(c)).length;
  s.lost = d.work.flat().filter((w) => !got.has(w)).length;
  return s;
}

/** Adds the scores up: precision (nothing mixed), recall (kept together), F1, clutter saved, work lost. */
export function summary(scores: Score[]): string {
  const t = scores.reduce((a, s) => ({ tp: a.tp + s.tp, fp: a.fp + s.fp, fn: a.fn + s.fn, clutterSaved: a.clutterSaved + s.clutterSaved, lost: a.lost + s.lost, work: a.work + s.work, clutter: a.clutter + s.clutter }));
  const p = t.tp / Math.max(1, t.tp + t.fp);
  const r = t.tp / Math.max(1, t.tp + t.fn);
  const f1 = (2 * p * r) / Math.max(1e-9, p + r);
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  return `precision ${pct(p)}  recall ${pct(r)}  F1 ${pct(f1)}  clutter saved ${t.clutterSaved}/${t.clutter}  work lost ${t.lost}/${t.work}`;
}

export const row = (d: Desk, works: Item[][], s: Score) =>
  [
    `${d.name.padEnd(52)} folders ${works.length}/${d.work.length}  mixed pairs ${s.fp}  missed pairs ${s.fn}  clutter saved ${s.clutterSaved}  work lost ${s.lost}`,
    ...works.map((w) => '   [' + w.map((i) => i.label.slice(0, 28)).join(' | ') + ']'),
  ].join('\n');
