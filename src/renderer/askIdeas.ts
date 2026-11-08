// Questions to try in Ask Stashd: a bank of them, filled in with your own folder names, shown one at a time
// and changing as you go. Every one is something Ask Stashd can really answer (folders, what's open, this
// week's time) or do (pin, add a tab). A few are meant to make you smile. Kept short enough (about 38
// characters before a folder name) to fit on one line in the menu bar panel.

import type { JobSummary } from '../shared/types';

/** {a} and {b} are two of your folders; a question that needs one is skipped when you don't have it. */
const BANK = [
  'What was I even doing in {a}?',
  'Be honest: did I touch {a} this week?',
  'Which folder have I been ignoring?',
  'Where’s that tab I swore I’d read?',
  'What did I actually do this week?',
  'How long did I spend on {a} this week?',
  'What’s in {b} again?',
  'Which of my folders is gathering dust?',
  'Why are all these tabs open?',
  'What was I on before the rabbit hole?',
  'Did I finish anything? Be gentle.',
  'Does anything open belong in {a}?',
  'Which folder got most of my week?',
  'What should I pick back up today?',
  'Is {b} done? Asking for a friend.',
  'What did I leave half finished?',
  'Pin {a}. It’s my favourite now.',
  'Add this tab to {a}',
  'When did I last open {b}?',
  'What was I up to yesterday?',
  'Which folder hoards the most tabs?',
  'Quick, what’s {a} about?',
] as const;

const SEEN_KEY = 'stashd.askIdeas.seen';

function fill(t: string, a?: string, b?: string): string | null {
  if (t.includes('{a}') && !a) return null;
  if (t.includes('{b}') && !b) return null;
  return t.replace('{a}', a ?? '').replace('{b}', b ?? '');
}

/** Ones shown least recently first, so the bank keeps changing from one day to the next. */
function seen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

export function markSeen(template: string): void {
  try {
    const s = seen();
    s[template] = Date.now();
    localStorage.setItem(SEEN_KEY, JSON.stringify(s));
  } catch {
    // only a nicety
  }
}

export interface Idea {
  q: string;
  template: string;
}

/** Up to n questions, using your two most recent open folders, the least recently shown first (ties shuffled). */
export function pickIdeas(jobs: JobSummary[], n: number): Idea[] {
  const [a, b] = jobs.filter((j) => !j.done).map((j) => j.name);
  const s = seen();
  return BANK.map((template) => ({ template, q: fill(template, a, b ?? a), at: s[template] ?? 0, r: Math.random() }))
    .filter((x): x is { template: (typeof BANK)[number]; q: string; at: number; r: number } => !!x.q)
    .sort((x, y) => x.at - y.at || x.r - y.r)
    .slice(0, n)
    .map(({ q, template }) => ({ q, template }));
}
