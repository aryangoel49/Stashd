// Deciding what belongs to a job. All pure functions, so they are easy to test.
//
// Every open item ends up in one of three places in the save box:
//   sure    ticked: clearly part of this job
//   maybe   unticked, one click to add ("Not sure about these")
//   hidden  not shown: everyday apps and sites, and things you keep leaving out

import type { Item, Job, LearnedPrefs, Settings } from '../../shared/types';
import { group, hostOf, isGeneralHost, itemTokens, jobProfile, meaningText, textTokens, type MeaningLookup } from './relevance';

const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'have', 'what', 'when', 'where', 'will', 'into', 'about',
  'google', 'docs', 'sheets', 'slides', 'document', 'untitled', 'home', 'page', 'search', 'new', 'tab', 'microsoft', 'word',
  'excel', 'powerpoint', 'pages', 'numbers', 'keynote', 'preview', 'pdf', 'docx', 'xlsx', 'pptx', 'https', 'http', 'www', 'com',
]);

/** Meaningful lowercase words (4+ letters) from a title, name or note. */
export function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/\.[a-z0-9]{2,5}$/, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)),
  );
}

export function host(item: Item): string | null {
  if (!item.url) return null;
  try {
    return new URL(item.url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function siteMatches(h: string, entry: string): boolean {
  const e = entry.trim().toLowerCase();
  if (!e) return false;
  return e.includes('.') ? h === e || h.endsWith(`.${e}`) : h.includes(e);
}

export function isLifestyle(item: Item, settings: Pick<Settings, 'lifestyleApps' | 'lifestyleSites'>, learnedApps: string[] = []): boolean {
  const apps = new Set([...settings.lifestyleApps, ...learnedApps].map((a) => a.toLowerCase()));
  if (item.kind === 'tab') {
    const h = host(item);
    return h !== null && settings.lifestyleSites.some((s) => siteMatches(h, s));
  }
  return apps.has(item.app.toLowerCase());
}

export interface Classified {
  sure: Item[];
  /** Probably related (opened since unpacking, or a partial match): highlighted for one-click adding. */
  likely: Item[];
  maybe: Item[];
  hidden: Item[];
  /** Why each item was placed where it was, in plain words (for tooltips). */
  why: Record<string, string>;
}

export interface ClassifyInput {
  items: Item[];
  /** The job being updated, or null for a brand-new job. */
  job: Job | null;
  /** Items from the job's latest save. */
  previous: Item[];
  /** The job name so far, to match titles against. */
  name: string;
  /** The job's last note. */
  note?: string;
  settings: Pick<Settings, 'lifestyleApps' | 'lifestyleSites'>;
  learnedLifestyleApps?: string[];
  /** What was open right after the job was unpacked. Anything not in it was opened since. */
  baseline?: Set<string>;
  /** What you were on last (seeds a new job). */
  frontKey?: string | null;
  /** Meaning vectors from the on-device model, when it's available. */
  meaning?: MeaningLookup;
}

/** Sites left out of a job this many saves in a row count against new tabs from them. */
export const SITE_OUT_AFTER = 2;

/** What a job has learned to avoid, ready for its profile. */
export function learnedAvoid(prefs: LearnedPrefs | undefined): { avoidTexts: string[]; avoidHosts: string[] } {
  return {
    avoidTexts: prefs?.leftOut ?? [],
    avoidHosts: Object.entries(prefs?.sitesOut ?? {}).filter(([, n]) => n >= SITE_OUT_AFTER).map(([h]) => h),
  };
}

/** Sort open items into: in this job / probably related / probably not / everyday (hidden). */
export function classify(input: ClassifyInput): Classified {
  const { items, job } = input;
  const prefs: LearnedPrefs = job?.prefs ?? { hide: {}, add: {} };
  const hidden: Item[] = [];
  const candidates: Item[] = [];
  for (const it of items) {
    if (isLifestyle(it, input.settings, input.learnedLifestyleApps) || (prefs.hide[it.key] ?? 0) >= 2) hidden.push(it);
    else candidates.push(it);
  }
  const profile = job ? jobProfile(input.name || job.name, input.note ?? '', input.previous, learnedAvoid(prefs)) : null;
  const g = group({
    candidates,
    profile,
    frontKey: input.frontKey ?? null,
    baseline: job ? input.baseline : undefined,
    // A brand-new unsaved document is almost always what you're working on, and so is
    // anything you've added to this job by hand twice.
    alwaysSure: (it) => it.untitled === true || (prefs.add[it.key] ?? 0) >= 2,
    meaning: input.meaning,
  });
  return { sure: g.sure, likely: g.likely, maybe: g.maybe, hidden, why: g.why };
}

/**
 * Update a job's learned preferences after a save.
 * Unticked twice in a row: hidden next time. Added from "Not sure" twice: sure next time.
 */
export function learn(prefs: LearnedPrefs, offered: Classified, chosenKeys: string[]): LearnedPrefs {
  const chosen = new Set(chosenKeys);
  const next: LearnedPrefs = { hide: { ...prefs.hide }, add: { ...prefs.add } };
  // Titles and sites you leave out teach the job what it isn't about.
  let leftOut = [...(prefs.leftOut ?? [])];
  const sitesOut = { ...(prefs.sitesOut ?? {}) };
  const all = [...offered.sure, ...offered.likely, ...offered.maybe].filter((it) => it.kind !== 'app');
  // General sites (Google, YouTube…) are used for everything, so leaving one out says nothing.
  const siteOf = (it: Item) => {
    const h = hostOf(it);
    return h && !isGeneralHost(h) ? h : null;
  };
  const keptHosts = new Set(all.filter((it) => chosen.has(it.key)).map(siteOf).filter((h): h is string => !!h));
  for (const it of all) {
    const text = meaningText(it);
    if (chosen.has(it.key)) {
      if (text) leftOut = leftOut.filter((t) => t !== text);
    } else if (text) {
      leftOut = [...leftOut.filter((t) => t !== text), text];
    }
  }
  const outHosts = new Set(all.filter((it) => !chosen.has(it.key)).map(siteOf).filter((h): h is string => !!h && !keptHosts.has(h)));
  for (const h of outHosts) sitesOut[h] = (sitesOut[h] ?? 0) + 1;
  for (const h of keptHosts) delete sitesOut[h];
  next.leftOut = leftOut.slice(-40);
  next.sitesOut = Object.fromEntries(Object.entries(sitesOut).slice(-100));
  const optional = new Set([...offered.maybe, ...offered.likely].map((m) => m.key));
  for (const it of [...offered.sure, ...offered.likely, ...offered.maybe]) {
    if (chosen.has(it.key)) {
      delete next.hide[it.key];
      if (optional.has(it.key)) next.add[it.key] = (next.add[it.key] ?? 0) + 1;
    } else {
      next.hide[it.key] = (next.hide[it.key] ?? 0) + 1;
      delete next.add[it.key];
    }
  }
  // Keep the file small: forget the oldest entries beyond 400.
  for (const k of ['hide', 'add'] as const) {
    const keys = Object.keys(next[k]);
    for (const key of keys.slice(0, Math.max(0, keys.length - 400))) delete next[k][key];
  }
  return next;
}

/** Apps the user unticked in this many different jobs are treated as everyday apps. */
export const LIFESTYLE_AFTER_JOBS = 3;

export function learnedLifestyleApps(appUnticks: Record<string, string[]>): string[] {
  return Object.entries(appUnticks)
    .filter(([, jobs]) => new Set(jobs).size >= LIFESTYLE_AFTER_JOBS)
    .map(([app]) => app);
}

export function recordAppUnticks(appUnticks: Record<string, string[]>, jobId: string, offered: Item[], chosenKeys: string[]): Record<string, string[]> {
  const chosen = new Set(chosenKeys);
  const next = { ...appUnticks };
  for (const it of offered) {
    if (it.kind !== 'app' || chosen.has(it.key)) continue;
    next[it.app] = [...new Set([...(next[it.app] ?? []), jobId])].slice(-10);
  }
  return next;
}

/** A name for a new job. First choice: the topic shared by everything in the job (tab titles,
 *  document and folder names). Otherwise a saved document's name, then the tab you were on. */
export function suggestName(items: Item[], frontKey: string | null): string {
  const topic = topicName(items);
  if (topic) return topic;
  const front = items.find((i) => i.key === frontKey);
  const isDoc = (i?: Item) => !!i && (i.kind === 'doc' || i.kind === 'folder') && !i.untitled;
  const pick = (isDoc(front) ? front : items.find((i) => isDoc(i))) ?? front ?? items[0];
  if (!pick) return 'New folder';
  let name = pick.label;
  if (pick.kind === 'doc' || pick.kind === 'folder') name = name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  if (pick.kind === 'tab') name = conciseTitle(shortTitle(name));
  name = name.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name || /^(document|untitled|new tab)\s*\d*$/i.test(name)) return 'New folder';
  return name.slice(0, 60);
}

/**
 * A tab title is a sentence, not a name: "What exactly is a AI Researcher" becomes "AI Researcher".
 * Filler words are dropped from both ends and at most four words are kept.
 */
const FILLER = new Set(['a', 'an', 'the', 'and', 'for', 'with', 'what', 'when', 'where', 'which', 'is', 'are', 'i', 'me', 'your', 'this', 'that']);

function conciseTitle(title: string): string {
  const out = trimFiller(title.split(/\s+/).filter(Boolean)).join(' ');
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** Drops filler words from both ends and keeps at most four words. */
function trimFiller(input: string[]): string[] {
  let words = input;
  const filler = (w: string) => {
    const l = w.toLowerCase().replace(/[^a-z]/g, '');
    return !l || TOPIC_STOP.has(l) || FILLER.has(l);
  };
  while (words.length > 1 && filler(words[0])) words = words.slice(1);
  words = words.slice(0, 4);
  while (words.length > 1 && filler(words[words.length - 1])) words = words.slice(0, -1);
  return words;
}

/** Words that say nothing about the topic. */
const TOPIC_STOP = new Set([
  ...STOP,
  'of', 'to', 'in', 'on', 'an', 'at', 'by', 'is', 'it', 'or', 'as', 'be', 'we', 'us', 'my', 'do', 'go', 'no', 'so', 'up', 'vs', 'how', 'why',
  'are', 'you', 'our', 'can', 'all', 'its', 'not', 'but', 'out', 'who', 'did', 'has', 'was', 'one', 'two', 'top', 'get', 'use', 'via',
  'download', 'report', 'guide', 'best', 'latest', 'news', 'analysis', 'official', 'site', 'ebook', 'free', 'online', 'trends', 'blog', 'article',
  'video', 'youtube', 'wikipedia', 'reddit', 'medium', 'review', 'reviews', 'introduction', 'overview', 'complete', 'ultimate', 'list', 'notes',
  'draft', 'final', 'copy', 'file', 'files', 'folder', 'downloads', 'desktop', 'documents', 'just', 'exactly', 'really', 'what', 'they', 'them',
]);

/** "ai augmentation" -> "AI Augmentation". Short words that are acronyms become capitals. */
function titleCase(phrase: string): string {
  return phrase
    .split(/\s+/)
    .map((w, i) => {
      if (/^[a-z]{2}$/.test(w) && !TOPIC_STOP.has(w)) return w.toUpperCase();
      if (i > 0 && ['and', 'of', 'the', 'for', 'in', 'on', 'to', 'a', 'an', 'vs'].includes(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

/** The topic everything in the job shares, like "AI Augmentation" or "Soccer Streams", or null if there's no clear one.
 *  Uses the same word matching as the relevance engine; looks at every part of every title. */
export function topicName(items: Item[]): string | null {
  const content = items.filter((i) => i.kind !== 'app' && !i.untitled);
  if (content.length < 2) return null;

  // How many items mention each word.
  const df = new Map<string, number>();
  for (const it of content) for (const t of itemTokens(it)) df.set(t, (df.get(t) ?? 0) + 1);
  const shared = new Set([...df].filter(([, n]) => n >= 2).map(([t]) => t));
  if (!shared.size) return null;

  // Candidate phrases: each part of each title ("Site - Part | Part"), as original words.
  type Cand = { words: string[]; hits: number; weight: number };
  const cands: Cand[] = [];
  for (const it of content) {
    let label = it.label.replace(/^\(\d+\)\s*/, '');
    if (it.kind !== 'tab') label = label.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/_+/g, ' ');
    for (const part of label.split(/\s[-–—|·•:]\s|:\s/)) {
      const words = part.split(/\s+/).filter(Boolean);
      const toks = new Set(words.flatMap((w) => textTokens(w)));
      const hit = [...toks].filter((t) => shared.has(t));
      if (!hit.length) continue;
      cands.push({ words, hits: hit.length, weight: hit.reduce((a, t) => a + (df.get(t) ?? 0), 0) });
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.hits - a.hits || b.weight - a.weight || a.words.length - b.words.length);
  const best = cands[0];

  // The shortest stretch of that part that covers its shared words.
  const isHit = (w: string) => textTokens(w).some((t) => shared.has(t));
  const idx = best.words.map((w, i) => (isHit(w) ? i : -1)).filter((i) => i >= 0);
  let phrase = best.words.slice(idx[0], idx[idx.length - 1] + 1);
  if (phrase.length > 5) phrase = phrase.filter(isHit).slice(0, 4);
  phrase = phrase.map((w) => w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')).filter(Boolean);
  // Folder names stay short: three words at most, never ending on a filler word.
  phrase = trimFiller(trimFiller(phrase).slice(0, 3));
  // A single word is only a good name when most things mention it.
  if (phrase.length === 1 && (df.get(textTokens(phrase[0])[0] ?? '') ?? 0) < 3) return null;
  const text = phrase.join(' ');
  if (!text) return null;
  return (text === text.toLowerCase() ? titleCase(text) : text).slice(0, 60);
}

/** "What exactly is a AI Researcher, are they just Data Scientists? : r/learnprogramming"
 *  becomes "What exactly is a AI Researcher". */
export function shortTitle(title: string, max = 40): string {
  let t = title.replace(/^\(\d+\)\s*/, '').split(/\s[-–—|·•]\s|\s:\s/)[0].trim();
  const firstClause = t.split(/[,?!:;]/)[0].trim();
  if (firstClause.split(/\s+/).length >= 2) t = firstClause;
  if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, '');
  return t.replace(/[\s,.;:!?-]+$/, '');
}

