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

/**
 * Up to n questions, the least recently shown first (ties shuffled). Folder questions take turns across
 * your open folders, each folder used once (twice when you have only one), and they alternate with general
 * questions, so the same folder name never comes up again and again.
 */
export function pickIdeas(jobs: JobSummary[], n: number, random: () => number = Math.random): Idea[] {
  const folders = jobs.filter((j) => !j.done).map((j) => j.name).slice(0, 8);
  // Start the turns at a random folder, so the newest (or pinned) one isn't always first.
  const start = folders.length ? Math.floor(random() * folders.length) : 0;
  const turns = folders.length === 1 ? [folders[0], folders[0]] : [...folders.slice(start), ...folders.slice(0, start)];
  const s = seen();
  const order = BANK.map((template) => ({ template, at: s[template] ?? 0, r: random() })).sort((x, y) => x.at - y.at || x.r - y.r);
  const general: Idea[] = [];
  const named: Idea[] = [];
  let next = 0;
  for (const { template } of order) {
    const needsTwo = template.includes('{a}') && template.includes('{b}');
    if (!template.includes('{a}') && !template.includes('{b}')) {
      general.push({ template, q: template });
      continue;
    }
    if (next >= turns.length || (needsTwo && next + 1 >= turns.length)) continue;
    const a = turns[next++];
    const b = needsTwo ? turns[next++] : a;
    const q = fill(template, a, b);
    if (q) named.push({ template, q });
  }
  // General, folder, general, folder… so a folder name never shows twice in a row.
  const out: Idea[] = [];
  while ((general.length || named.length) && out.length < n) {
    const g = general.shift();
    if (g) out.push(g);
    const f = named.shift();
    if (f && out.length < n) out.push(f);
  }
  return out;
}
