// Deciding what belongs together. Pure functions, no AI needed.
//
// Every item (tab, document, folder) is turned into meaningful words ("tokens"). A job gets a
// "profile": weighted tokens from its name, your note and everything already in it, plus its
// sites, folders and items. Each open item is scored against the profile:
//   - the same item as before: certain
//   - shared words, weighted by how rare they are among what's open (a word every tab shares
//     says little; a word only two tabs share says a lot)
//   - the same website (except general ones like Google), the same folder, the same browser window
// A second pass adds what was just matched to the profile, so related things pull each other in.
//
// Meaning: a small model on this Mac (see src/main/meaning) turns each title into a "meaning vector".
// Titles about the same thing get close vectors even with no words in common ("Real Madrid at
// Barcelona" and "Soccer Streams"). When it's available, closeness in meaning adds to the score;
// when it isn't, everything above still works on its own.

import type { Item } from '../../shared/types';
import { looseKey } from '../urls';

// ---------- tokens ----------

/** Words that say nothing about what the work is. */
const STOP = new Set(
  `the and for with that this from your have what when where will into about are you our can all its not but out who did has was
  one two get use via how why been being were their there these those then than them they she him her his hers its it's also just
  more most some such only very really exactly what's here new old now today vs of to in on an at by is it or as be we us my do go
  no so up if me i a
  google search docs sheets slides document documents untitled home page pages tab tabs microsoft word excel powerpoint keynote numbers
  preview pdf docx doc xlsx pptx txt rtf https http www com org net html
  free watch live online official site website blog article video videos youtube wikipedia reddit medium quora news latest
  best top guide guides complete ultimate list review reviews report reports download downloads ebook pdf overview introduction intro
  key things thing way ways tips help app apps login sign account dashboard inbox settings
  draft final copy file files folder desktop notes note untitled
  season seasons episode episodes ep full tv show shows series part trailer clip clips`.split(/\s+/).filter(Boolean),
);

/** Websites used for everything; sharing one says nothing about the topic. */
const GENERAL_HOSTS = [
  'google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com', 'youtube.com', 'wikipedia.org', 'reddit.com', 'medium.com',
  'docs.google.com', 'drive.google.com', 'chatgpt.com', 'claude.ai', 'perplexity.ai', 'notion.so', 'github.com', 'x.com', 'twitter.com',
];

export function stem(w: string): string {
  let l = w.toLowerCase();
  if (l.length > 5 && l.endsWith('ing')) l = l.slice(0, -3);
  else if (l.length > 4 && l.endsWith('ies')) l = `${l.slice(0, -3)}y`;
  else if (l.length > 4 && l.endsWith('es') && /(ss|x|ch|sh)es$/.test(l)) l = l.slice(0, -2);
  else if (l.length > 3 && l.endsWith('s') && !l.endsWith('ss')) l = l.slice(0, -1);
  return l;
}

/** "StreamEast.zip – Watch NBA Live" -> ["stream", "east", "nba"]. Short words like "AI" count. */
export function textTokens(text: string): string[] {
  const words = text
    .replace(/([a-z])([A-Z])/g, '$1 $2') // StreamEast -> Stream East
    .replace(/\.[a-z0-9]{2,5}\b/gi, ' ') // file extensions and .zip/.com style endings
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (/^\d+$/.test(w)) continue;
    const l = w.toLowerCase();
    if (STOP.has(l)) continue;
    if (l.length < 2 || (l.length === 2 && !/^\p{L}{2}$/u.test(l))) continue;
    out.push(stem(l));
  }
  return out;
}

export function hostOf(item: Item): string | null {
  if (!item.url) return null;
  try {
    return new URL(item.url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

export function isGeneralHost(h: string): boolean {
  return GENERAL_HOSTS.some((g) => h === g || h.endsWith(`.${g}`)) || /^(www\.)?google\.[a-z.]+$/.test(h);
}

/** Tokens for an item: its title (minus app names), plus the site's own name for special-purpose sites. */
export function itemTokens(item: Item): string[] {
  if (item.kind === 'app') return [];
  let text = item.label;
  if (item.kind === 'doc' || item.kind === 'folder') text = text.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/_+/g, ' ');
  if (item.untitled && /^(document|book|workbook|presentation|untitled)\s*\d*$/i.test(text)) text = '';
  const tokens = textTokens(text);
  const h = hostOf(item);
  if (h && !isGeneralHost(h)) {
    const site = h.split('.').slice(-2, -1)[0];
    if (site && site.length >= 3) tokens.push(...textTokens(site));
  }
  return [...new Set(tokens)];
}

/** The text the meaning model reads for an item: its title, without file endings and search-engine noise. */
export function meaningText(item: Item): string | null {
  if (item.kind === 'app') return null;
  if (item.untitled && /^(document|book|workbook|presentation|untitled)\s*\d*$/i.test(item.label)) return null;
  let t = item.label;
  if (item.kind === 'doc' || item.kind === 'folder') t = t.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[_-]+/g, ' ');
  t = t.replace(/\s+[-–|·]\s+(Google Search|Bing|DuckDuckGo)$/i, '').trim();
  // Drop filler ("Full Episode", "Live on TV", "Season") so the model compares what it's actually about.
  const kept = t.split(/\s+/).filter((w) => {
    const bare = w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    return bare && !STOP.has(bare);
  });
  if (kept.length) t = kept.join(' ');
  return t.length >= 2 ? t : null;
}

/** Looks up an item's meaning vector (normalised, so a dot product is the similarity, -1 to 1). */
export type MeaningLookup = (text: string) => number[] | undefined;

function similarity(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Below this similarity the meaning model counts two titles as different topics. */
const UNRELATED = 0.25;

/** Below this, two titles are no more alike than random ones (measured: unrelated titles score -0.05 to 0.21,
 *  related ones 0.29 to 0.65). */
export const MEANING_FLOOR = 0.2;
/** Points per unit of similarity above the floor: 0.29 -> 0.6 (probably related), 0.42 -> 1.5 (in the job). */
const MEANING_WEIGHT = 7;
const MEANING_MAX = 2;

function dirOf(item: Item): string | null {
  return item.path ? item.path.split('/').slice(0, -1).join('/') : null;
}

// ---------- profiles ----------

export interface Profile {
  tokens: Map<string, number>;
  keys: Set<string>;
  /** The same items, matched loosely (a tab whose address changed a little after reopening). */
  loose: Set<string>;
  hosts: Set<string>;
  dirs: Set<string>;
  /** Texts to compare meaning against (the job name, your note, titles in the job), with a label for tooltips. */
  refs: Map<string, string>;
  /** Learned from you: titles you left out of this job before, and sites you keep leaving out. */
  avoidTexts: string[];
  avoidHosts: Set<string>;
}

export function emptyProfile(): Profile {
  return { tokens: new Map(), keys: new Set(), loose: new Set(), hosts: new Set(), dirs: new Set(), refs: new Map(), avoidTexts: [], avoidHosts: new Set() };
}

function addTokens(p: Profile, tokens: string[], weight: number, cap = 4): void {
  for (const t of tokens) p.tokens.set(t, Math.min(cap, (p.tokens.get(t) ?? 0) + weight));
}

/** Add an item (its words, site, folder) to a profile. `asMember: false` adds what it's about, without saying it was in the job. */
export function addItem(p: Profile, item: Item, weight = 1, asMember = true): void {
  if (asMember) {
    p.keys.add(item.key);
    p.loose.add(looseKey(item));
  }
  addTokens(p, itemTokens(item), weight);
  const h = hostOf(item);
  if (h && !isGeneralHost(h)) p.hosts.add(h);
  const d = dirOf(item);
  if (d) p.dirs.add(d);
  const t = meaningText(item);
  if (t) p.refs.set(t, item.label);
}

/** A job's profile: its name and note count double, then everything that was in it. */
export function jobProfile(name: string, note: string, items: Item[], learned?: { avoidTexts?: string[]; avoidHosts?: string[] }): Profile {
  const p = emptyProfile();
  addTokens(p, textTokens(name), 2);
  addTokens(p, textTokens(note), 1.5);
  if (name.trim()) p.refs.set(name.trim(), name.trim());
  if (note.trim()) p.refs.set(note.trim(), 'your note');
  for (const it of items) addItem(p, it, 1);
  p.avoidTexts = learned?.avoidTexts ?? [];
  for (const h of learned?.avoidHosts ?? []) if (!p.hosts.has(h)) p.avoidHosts.add(h);
  return p;
}

/** Every text a profile needs a meaning vector for. */
export function profileTexts(p: Profile): string[] {
  return [...p.refs.keys(), ...p.avoidTexts];
}

function short(label: string): string {
  const first = label.replace(/\.[A-Za-z0-9]{1,5}$/, '').split(/\s+[-–|·:]\s+/)[0];
  return first.length > 40 ? `${first.slice(0, 38)}…` : first;
}

// ---------- scoring ----------

/** How many of the open items mention each token (rare shared words matter more). */
export function documentFrequency(items: Item[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const it of items) for (const t of itemTokens(it)) df.set(t, (df.get(t) ?? 0) + 1);
  return df;
}

export interface Score {
  score: number;
  /** Plain-language reasons, shown as a tooltip. */
  why: string[];
}

export function scoreItem(item: Item, p: Profile, df: Map<string, number>, frontWindow: number | null = null, meaning?: MeaningLookup): Score {
  if (p.keys.has(item.key) || p.loose.has(looseKey(item))) return { score: 10, why: ['was in this job'] };
  let score = 0;
  const why: string[] = [];
  const shared: string[] = [];
  for (const t of itemTokens(item)) {
    const w = p.tokens.get(t);
    if (!w) continue;
    score += w / Math.sqrt(df.get(t) ?? 1);
    shared.push(t);
  }
  if (shared.length) why.push(`mentions ${shared.slice(0, 3).join(', ')}`);
  const h = hostOf(item);
  if (h && p.hosts.has(h)) {
    score += 1.5;
    why.push(`same site (${h})`);
  }
  const d = dirOf(item);
  if (d && p.dirs.has(d)) {
    score += 2;
    why.push('same folder');
  }
  const sameWindow = frontWindow !== null && item.kind === 'tab' && item.window === frontWindow;
  if (sameWindow) {
    score += 1;
    why.push('same browser window');
  }

  // Meaning: how close is this title to the closest thing in the job?
  const text = meaningText(item);
  const v = text && meaning ? meaning(text) : undefined;
  let best = 0;
  if (v && text) {
    let bestLabel = '';
    for (const [ref, label] of p.refs) {
      if (ref === text) continue;
      const rv = meaning!(ref);
      if (!rv) continue;
      const sim = similarity(v, rv);
      if (sim > best) {
        best = sim;
        bestLabel = label;
      }
    }
    // One-word titles ("Netflix") are too vague to judge by meaning, so they count for less.
    const vague = text.split(/\s+/).length < 2 ? 0.5 : 1;
    const pts = Math.min(MEANING_MAX, Math.max(0, best - MEANING_FLOOR) * MEANING_WEIGHT * vague);
    if (pts > 0) score += pts;
    if (pts >= 0.5 && !shared.length) why.push(`about the same thing as “${short(bestLabel)}”`);
    else if (pts >= 0.5) why.push('similar topic');

    // The meaning model says it's a different topic: being in the same browser window isn't
    // enough on its own (a Shark Tank episode next to soccer scores).
    if (bestLabel && best < UNRELATED && sameWindow) {
      score -= 1;
      why.splice(why.indexOf('same browser window'), 1);
      if (!shared.length) why.push('different topic');
    }

    // Learned: much more like something you left out of this job before.
    let avoid = 0;
    for (const t of p.avoidTexts) {
      const av = meaning!(t);
      if (av) avoid = Math.max(avoid, similarity(v, av));
    }
    if (avoid >= 0.6 && avoid > best + 0.1) {
      score -= 1.5;
      why.push("like things you've left out of this job");
    }
  }
  if (h && p.avoidHosts.has(h)) {
    score -= 1;
    why.push(`you usually leave out ${h}`);
  }
  return { score, why };
}

export const SURE = 1.5;
export const LIKELY = 0.6;

// ---------- grouping a capture ----------

export interface Grouped {
  sure: Item[];
  likely: Item[];
  maybe: Item[];
  why: Record<string, string>;
}

/**
 * Split candidates (everyday things already removed) into sure / likely / maybe.
 * With a job: scored against its profile. Without one (a new job): seeded from what you were on last.
 * `baseline` (keys open right after unpacking): new things that aren't clear matches become "likely".
 */
export function group(opts: {
  candidates: Item[];
  profile: Profile | null;
  frontKey: string | null;
  baseline?: Set<string>;
  alwaysSure?: (it: Item) => boolean;
  meaning?: MeaningLookup;
}): Grouped {
  const { candidates } = opts;
  const df = documentFrequency(candidates);
  const front = candidates.find((i) => i.key === opts.frontKey) ?? null;
  const frontWindow = front?.kind === 'tab' ? (front.window ?? null) : null;

  let profile: Profile;
  let isNew = false;
  if (opts.profile) {
    profile = opts.profile;
  } else {
    // New job: start from what you were on last.
    isNew = true;
    profile = emptyProfile();
    if (front) addItem(profile, front, 2);
    if (profile.tokens.size === 0 && profile.hosts.size === 0 && profile.dirs.size === 0 && profile.refs.size === 0) {
      // Nothing to go on (an untitled document, say): everything that isn't a bare app is the job.
      const sure = candidates.filter((i) => i.kind !== 'app');
      return { sure, likely: [], maybe: candidates.filter((i) => i.kind === 'app'), why: {} };
    }
  }

  const why: Record<string, string> = {};
  const scores = new Map<string, number>();
  const run = (settled: Set<string>) => {
    for (const it of candidates) {
      if (settled.has(it.key)) continue;
      const s = scoreItem(it, profile, df, isNew ? frontWindow : null, opts.meaning);
      scores.set(it.key, s.score);
      if (s.why.length) why[it.key] = s.why.join(', ');
    }
  };
  run(new Set());
  // Second pass: what clearly matched joins the profile, so related things pull each other in.
  // (What already matched keeps its first score and reason, so it isn't matched against itself.)
  const settled = new Set(candidates.filter((it) => (scores.get(it.key) ?? 0) >= SURE && it.kind !== 'app').map((it) => it.key));
  for (const it of candidates) if (settled.has(it.key)) addItem(profile, it, 0.75, false);
  run(settled);

  const out: Grouped = { sure: [], likely: [], maybe: [], why };
  for (const it of candidates) {
    const s = scores.get(it.key) ?? 0;
    if (it.key === opts.frontKey && isNew) out.sure.push(it);
    else if (opts.alwaysSure?.(it)) out.sure.push(it);
    else if (it.kind === 'app' && s < 10) out.maybe.push(it); // a bare app is never ticked on its own
    else if (s >= SURE) out.sure.push(it);
    else if (s >= LIKELY || (opts.baseline && !opts.baseline.has(it.key))) out.likely.push(it);
    else out.maybe.push(it);
  }
  return out;
}

/** How well a set of open items fits a job (0 = not at all). Used to suggest and rank jobs. */
export function jobFit(candidates: Item[], profile: Profile, meaning?: MeaningLookup): number {
  const df = documentFrequency(candidates);
  const scored = candidates.filter((i) => i.kind !== 'app').map((i) => Math.max(0, Math.min(scoreItem(i, profile, df, null, meaning).score, 4)));
  if (!scored.length) return 0;
  // Clear matches count fully, "probably related" ones half.
  const strong = scored.reduce((n, s) => n + (s >= SURE ? 1 : s >= LIKELY ? 0.5 : 0), 0);
  return (scored.reduce((a, b) => a + b, 0) / scored.length) * (strong / scored.length);
}

/** A fit above this suggests the job automatically. */
export const FIT_SUGGEST = 0.5;
