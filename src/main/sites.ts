// Which sites are for breaks (watching, listening, playing) beyond the ones Stashd knows from the start
// (BREAK_SITES in breaks.ts), so a streaming site Stashd has never heard of doesn't end up in a work folder.
//
// 1. The Mac's own meaning model compares each page title with short descriptions of break pages and work
//    pages. Free, offline and private. It settles most sites at once ("1Flex - Stream Movies, TV Shows").
// 2. Sites it can't tell, only if you turned Stashd AI on: a few at a time go to Stashd AI (the site and up
//    to three page titles, nothing else), at most once an hour.
// Answers are kept in sites.json, so each site is looked at once. A site that shows both kinds of page
// (a work title and a break title) counts as "mixed": its pages stay with your work, like before.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Item } from '../shared/types';
import type { Meaning } from './meaning';
import { isListedBreak, setLearnedBreakSites, siteOfUrl } from './breaks';
import { readJsonSafely } from './safety';
import { writeFileKeepingLast } from './store';

export type SiteKind = 'break' | 'work' | 'mixed';

interface Site {
  kind?: SiteKind;
  by?: 'model' | 'ai';
  /** Up to three page titles seen there, each with how much it leans to a break (see leaning). */
  seen: { title: string; lean: number }[];
  askedAt?: number;
}

interface SitesFile {
  v: 1;
  sites: Record<string, Site>;
}

const BREAK_MEANINGS = [
  'watch movies and tv shows online',
  'stream free movies, series and anime episodes',
  'live sports stream and match scores',
  'online games to play for fun',
  'music, songs and podcasts to listen to',
  'celebrity gossip, memes and funny videos',
  'social media feed',
];
const WORK_MEANINGS = [
  'code, docs and developer tools',
  'project management, tasks and issues',
  'email, calendar and documents',
  'online course, lecture and study notes',
  'research paper and technical article',
  'spreadsheet, design and analytics dashboard',
  'shopping, banking and account settings',
];

/** How far a title must lean to count. Measured on real titles: streaming sites lean +0.16 to +0.63, work sites -0.02 to -0.2. */
export const BREAK_LEAN = 0.14;
export const WORK_LEAN = -0.05;

const MAX_TITLES = 3;
const AI_BATCH = 12;
const AI_EVERY = 60 * 60_000;
const AI_AGAIN = 24 * 60 * 60_000;
const MAX_SITES = 2000;

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

/** How much a page leans to a break: its closest break description minus its closest work description. */
export function leaning(v: number[], breaks: number[][], works: number[][]): number {
  return Math.max(...breaks.map((b) => dot(v, b))) - Math.max(...works.map((w) => dot(v, w)));
}

/** What the titles seen on a site say, or undefined if they don't say enough yet. */
export function kindFromTitles(seen: { lean: number }[]): SiteKind | undefined {
  const isBreak = seen.some((s) => s.lean >= BREAK_LEAN);
  const isWork = seen.some((s) => s.lean <= WORK_LEAN);
  if (isBreak && isWork) return 'mixed';
  if (isBreak) return 'break';
  if (isWork) return 'work';
  return undefined;
}

/** Sites worth sorting: real websites, not this Mac or a local network address. */
function sortable(host: string): boolean {
  return host.includes('.') && !/^[\d.]+$/.test(host) && !host.includes(':') && !host.endsWith('.local') && !host.endsWith('.localhost');
}

export class SiteSorter {
  private data: SitesFile | null = null;
  private queue: Promise<void> = Promise.resolve();
  private lastAi = 0;
  private file: string;

  constructor(
    dataDir: string,
    private readonly deps: {
      meaning: () => Meaning | undefined;
      /** Stashd AI, when it's on: sends the content and returns the model's JSON text. */
      ai: () => ((content: string) => Promise<string>) | null;
      now?: () => number;
    },
  ) {
    this.file = path.join(dataDir, 'sites.json');
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private async load(): Promise<SitesFile> {
    if (this.data) return this.data;
    const raw = readJsonSafely(path.dirname(this.file), 'sites.json') as Partial<SitesFile> | null;
    this.data = raw && raw.v === 1 && raw.sites && typeof raw.sites === 'object' ? (raw as SitesFile) : { v: 1, sites: {} };
    this.publish();
    return this.data;
  }

  private publish(): void {
    setLearnedBreakSites(Object.entries(this.data?.sites ?? {}).filter(([, s]) => s.kind === 'break').map(([h]) => h));
  }

  private async save(): Promise<void> {
    if (!this.data) return;
    const sites = this.data.sites;
    const hosts = Object.keys(sites);
    if (hosts.length > MAX_SITES) for (const h of hosts.filter((x) => !sites[x].kind).slice(0, hosts.length - MAX_SITES)) delete sites[h];
    await writeFileKeepingLast(this.file, JSON.stringify(this.data));
  }

  /** What Stashd has learned about a site (for tests and Ask). */
  async kindOf(host: string): Promise<SiteKind | undefined> {
    return (await this.load()).sites[host]?.kind;
  }

  /** Read sites.json at startup, so learned break sites count from the first save. */
  async start(): Promise<void> {
    await this.load();
  }

  /**
   * Look at what's open. Waits only for the Mac's own model (quick); Stashd AI, if needed, carries on
   * in the background and counts from the next save.
   */
  look(items: Item[]): Promise<void> {
    const run = this.queue.then(() => this.lookNow(items)).catch(() => undefined);
    this.queue = run;
    return run;
  }

  private async lookNow(items: Item[]): Promise<void> {
    const data = await this.load();
    // New titles on sites that aren't settled yet (Stashd AI's answer is final; "mixed" can't change).
    const fresh = new Map<string, string>();
    for (const i of items) {
      if (i.kind !== 'tab' || !i.url || isListedBreak(i.url)) continue;
      const host = siteOfUrl(i.url);
      const title = i.label.trim().slice(0, 120);
      if (!host || !sortable(host) || title.length < 3) continue;
      const s = data.sites[host];
      if (s && (s.by === 'ai' || s.kind === 'mixed' || s.seen.length >= MAX_TITLES || s.seen.some((x) => x.title === title))) continue;
      fresh.set(`${host}: ${title}`, host);
    }

    let changed = false;
    const meaning = this.deps.meaning();
    if (fresh.size && meaning) {
      const texts = [...fresh.keys()];
      const v = await meaning.vectors([...BREAK_MEANINGS, ...WORK_MEANINGS, ...texts], 8000).catch(() => null);
      const breaks = BREAK_MEANINGS.map((t) => v?.get(t)).filter((x): x is number[] => !!x);
      const works = WORK_MEANINGS.map((t) => v?.get(t)).filter((x): x is number[] => !!x);
      if (v && breaks.length === BREAK_MEANINGS.length && works.length === WORK_MEANINGS.length) {
        for (const text of texts) {
          const vec = v.get(text);
          if (!vec) continue;
          const host = fresh.get(text)!;
          const s = (data.sites[host] ??= { seen: [] });
          s.seen.push({ title: text.slice(host.length + 2), lean: Math.round(leaning(vec, breaks, works) * 1000) / 1000 });
          const kind = kindFromTitles(s.seen);
          if (kind) {
            s.kind = kind;
            s.by = 'model';
          }
          changed = true;
        }
      }
    }
    if (changed) {
      this.publish();
      await this.save();
    }
    void this.askAi().catch(() => undefined);
  }

  /** Sites the Mac's model couldn't settle go to Stashd AI, a few at a time, at most once an hour. */
  private async askAi(): Promise<void> {
    const ai = this.deps.ai();
    const now = this.now();
    if (!ai || now - this.lastAi < AI_EVERY) return;
    const data = await this.load();
    const unsure = Object.entries(data.sites)
      .filter(([, s]) => !s.kind && s.seen.length && now - (s.askedAt ?? 0) >= AI_AGAIN)
      .slice(0, AI_BATCH);
    if (!unsure.length) return;
    this.lastAi = now;
    for (const [, s] of unsure) s.askedAt = now;
    await this.save();
    const text = await ai(JSON.stringify({ sites: unsure.map(([site, s]) => ({ site, titles: s.seen.map((x) => x.title) })) }));
    const answers = (JSON.parse(text) as { sites?: unknown }).sites;
    if (!Array.isArray(answers)) return;
    const asked = new Set(unsure.map(([h]) => h));
    for (const a of answers as { site?: unknown; kind?: unknown }[]) {
      if (typeof a?.site !== 'string' || !asked.has(a.site)) continue;
      if (a.kind !== 'break' && a.kind !== 'work' && a.kind !== 'mixed') continue;
      // The Mac's model may have settled it while Stashd AI was thinking; its answer stands.
      const s = data.sites[a.site];
      if (!s || s.kind) continue;
      s.kind = a.kind;
      s.by = 'ai';
    }
    this.publish();
    await this.save();
  }

  /** Forget my history: forget every site too. */
  async forget(): Promise<void> {
    await this.queue;
    this.data = { v: 1, sites: {} };
    this.publish();
    await fs.rm(this.file, { force: true });
    await fs.rm(`${this.file}.bak`, { force: true });
  }
}
