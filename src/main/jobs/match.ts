// Deciding what belongs to a job. All pure functions, so they are easy to test.
//
// Every open item ends up in one of three places in the save box:
//   sure    ticked: clearly part of this job
//   maybe   unticked, one click to add ("Not sure about these")
//   hidden  not shown: everyday apps and sites, and things you keep leaving out

import type { Item, Job, LearnedPrefs, Settings } from '../../shared/types';

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
  maybe: Item[];
  hidden: Item[];
}

export interface ClassifyInput {
  items: Item[];
  /** The job being updated, or null for a brand-new job. */
  job: Job | null;
  /** Items from the job's latest save. */
  previous: Item[];
  /** The job name and note so far, to match titles against. */
  name: string;
  settings: Pick<Settings, 'lifestyleApps' | 'lifestyleSites'>;
  learnedLifestyleApps?: string[];
}

export function classify(input: ClassifyInput): Classified {
  const { items, job, previous } = input;
  const prefs: LearnedPrefs = job?.prefs ?? { hide: {}, add: {} };
  const out: Classified = { sure: [], maybe: [], hidden: [] };
  const prevKeys = new Set(previous.map((p) => p.key));
  const prevHosts = new Map<string, Set<string>>();
  for (const p of previous) {
    const h = host(p);
    if (!h) continue;
    const set = prevHosts.get(h) ?? new Set<string>();
    for (const w of words(p.label)) set.add(w);
    prevHosts.set(h, set);
  }
  const prevDirs = new Set(previous.filter((p) => p.path).map((p) => p.path!.split('/').slice(0, -1).join('/')));
  const jobWords = words(input.name);

  for (const it of items) {
    if (isLifestyle(it, input.settings, input.learnedLifestyleApps)) {
      out.hidden.push(it);
      continue;
    }
    if ((prefs.hide[it.key] ?? 0) >= 2) {
      out.hidden.push(it);
      continue;
    }
    if (!job) {
      out.sure.push(it);
      continue;
    }
    const itWords = words(it.label);
    const h = host(it);
    const sameSiteSimilar = h !== null && prevHosts.has(h) && overlap(itWords, prevHosts.get(h)!) >= 1;
    const sameFolder = it.path !== undefined && prevDirs.has(it.path.split('/').slice(0, -1).join('/'));
    const mentions = overlap(itWords, jobWords) >= 1;
    if (prevKeys.has(it.key) || (prefs.add[it.key] ?? 0) >= 2 || sameSiteSimilar || sameFolder || mentions) out.sure.push(it);
    else out.maybe.push(it);
  }
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

/**
 * Update a job's learned preferences after a save.
 * Unticked twice in a row: hidden next time. Added from "Not sure" twice: sure next time.
 */
export function learn(prefs: LearnedPrefs, offered: Classified, chosenKeys: string[]): LearnedPrefs {
  const chosen = new Set(chosenKeys);
  const next: LearnedPrefs = { hide: { ...prefs.hide }, add: { ...prefs.add } };
  for (const it of [...offered.sure, ...offered.maybe]) {
    if (chosen.has(it.key)) {
      delete next.hide[it.key];
      if (offered.maybe.some((m) => m.key === it.key)) next.add[it.key] = (next.add[it.key] ?? 0) + 1;
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

/** A name for a new job: a saved document's name if there is one (that's usually the work),
 *  otherwise the tab you were on, cut down to a short phrase. */
export function suggestName(items: Item[], frontKey: string | null): string {
  const front = items.find((i) => i.key === frontKey);
  const isDoc = (i?: Item) => !!i && (i.kind === 'doc' || i.kind === 'folder') && !i.untitled;
  const pick = (isDoc(front) ? front : items.find((i) => isDoc(i))) ?? front ?? items[0];
  if (!pick) return 'New job';
  let name = pick.label;
  if (pick.kind === 'doc' || pick.kind === 'folder') name = name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  if (pick.kind === 'tab') name = shortTitle(name);
  name = name.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name || /^(document|untitled|new tab)\s*\d*$/i.test(name)) return 'New job';
  return name.slice(0, 60);
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

/** How alike two sets of items are (0 to 1), by shared items, files, sites and words. */
export function similarity(a: Item[], b: Item[]): number {
  if (!a.length || !b.length) return 0;
  const keysB = new Set(b.map((i) => i.key));
  const hostsB = new Set(b.map(host).filter(Boolean));
  const wordsB = new Set(b.flatMap((i) => [...words(i.label)]));
  let score = 0;
  for (const it of a) {
    if (keysB.has(it.key)) score += 1;
    else if (host(it) && hostsB.has(host(it))) score += 0.4;
    else if ([...words(it.label)].some((w) => wordsB.has(w))) score += 0.3;
  }
  return Math.min(1, score / Math.min(a.length, b.length));
}

export const MATCH_THRESHOLD = 0.6;
