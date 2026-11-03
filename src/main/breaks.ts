// The Break shelf: what you watch and listen to, kept apart from your work. Ctrl+S never puts break
// things in a folder (unless they're clearly about the project, like a tutorial). Tidy all puts the break
// tabs that are open on the shelf, and the menu bar panel's Break side opens them again in the browser
// you picked.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BreakItem, BreakPlace, BreakShelf, BrowserName, Item } from '../shared/types';
import { writeFileAtomic } from './store';
import { looseKey } from './urls';

/** Sites for watching, listening, sport and games. A page on one of these is a break, unless it's about your work. */
export const BREAK_SITES = [
  'youtube.com', 'youtu.be', 'netflix.com', 'primevideo.com', 'disneyplus.com', 'hulu.com', 'max.com', 'hbomax.com',
  'tv.apple.com', 'crave.ca', 'hotstar.com', 'jiocinema.com', 'peacocktv.com', 'paramountplus.com', 'crunchyroll.com',
  'twitch.tv', 'kick.com', 'espn.com', 'nba.com', 'nfl.com', 'fifa.com', 'cricbuzz.com', 'espncricinfo.com',
  'soundcloud.com', 'music.apple.com', 'store.steampowered.com', 'chess.com', 'lichess.org', 'nytimes.com/games',
  'imdb.com', 'letterboxd.com', '9gag.com', 'instagram.com', 'tiktok.com', 'x.com', 'twitter.com', 'facebook.com',
];

export function isBreakItem(item: Item): boolean {
  if (item.kind !== 'tab' || !item.url) return false;
  try {
    const u = new URL(item.url);
    const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
    const hp = `${host}${u.pathname}`;
    return BREAK_SITES.some((s) => (s.includes('/') ? hp.startsWith(s) : host === s || host.endsWith(`.${s}`)));
  } catch {
    return false;
  }
}

const DAY = 24 * 60 * 60_000;

/**
 * How long something stays on the shelf without you touching it. A clip you watched once and never came
 * back to goes after a week. A show (several episodes here) or something you've reopened stays for a month,
 * because people often pause a show for a week or two. You can always remove anything yourself.
 */
export function keepFor(item: BreakItem, all: BreakItem[]): number {
  const show = showName(item.label);
  const episodes = show ? all.filter((i) => showName(i.label)?.toLowerCase() === show.toLowerCase()).length : 0;
  return (item.opens ?? 0) >= 1 || episodes >= 2 ? 30 * DAY : 7 * DAY;
}

/** Your places to start with: where most breaks begin. */
const DEFAULT_PLACES: BreakPlace[] = [
  { name: 'YouTube', url: 'https://www.youtube.com/' },
  { name: 'Netflix', url: 'https://www.netflix.com/' },
  { name: 'Spotify', url: 'https://open.spotify.com/' },
];

const MAX_SHELF = 30;

export class BreakStore {
  private file: string;
  private cache: BreakShelf | null = null;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'break.json');
  }

  async get(): Promise<BreakShelf> {
    if (this.cache) {
      if (this.expire(this.cache)) await this.save(this.cache);
      return this.cache;
    }
    let raw: Partial<BreakShelf> = {};
    try {
      raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<BreakShelf>;
    } catch {
      // first time
    }
    const shelf: BreakShelf = {
      items: Array.isArray(raw.items) ? raw.items.filter((i) => i && typeof i.key === 'string' && typeof i.url === 'string') : [],
      places: Array.isArray(raw.places) ? raw.places.filter((p) => p && typeof p.name === 'string' && typeof p.url === 'string') : DEFAULT_PLACES,
      browser: raw.browser ?? null,
    };
    this.cache = shelf;
    if (this.expire(shelf)) await this.save(shelf);
    return shelf;
  }

  private async save(shelf: BreakShelf): Promise<void> {
    this.cache = shelf;
    await writeFileAtomic(this.file, JSON.stringify(shelf, null, 2));
  }

  /** Newest first; the same page again moves to the top (keeping how often you've opened it). */
  async add(items: Item[]): Promise<void> {
    const shelf = await this.get();
    const now = new Date().toISOString();
    const before = new Map(shelf.items.map((i) => [looseKey(i), i]));
    const fresh: BreakItem[] = items
      .filter((i) => i.url)
      .map((i) => {
        const had = before.get(looseKey(i));
        return { ...i, active: false, notOpen: undefined, group: undefined, savedAt: now, openedAt: had?.openedAt, opens: had?.opens };
      });
    const keys = new Set(fresh.map(looseKey));
    shelf.items = [...fresh, ...shelf.items.filter((i) => !keys.has(looseKey(i)))].slice(0, MAX_SHELF);
    await this.save(shelf);
  }

  /** You opened it from the shelf: it moves to the top, and counts as something you come back to. */
  async opened(url: string): Promise<void> {
    const shelf = await this.get();
    const key = looseKey({ key: `tab:${url}`, kind: 'tab', label: '', detail: '', app: '', url });
    const it = shelf.items.find((i) => looseKey(i) === key);
    if (!it) return;
    const now = new Date().toISOString();
    Object.assign(it, { openedAt: now, savedAt: now, opens: (it.opens ?? 0) + 1 });
    shelf.items = [it, ...shelf.items.filter((i) => i !== it)];
    await this.save(shelf);
  }

  /** Clears out what you've moved on from (see keepFor). Returns whether anything went. */
  private expire(shelf: BreakShelf, now = Date.now()): boolean {
    const kept = shelf.items.filter((i) => {
      const at = Date.parse(i.openedAt ?? i.savedAt ?? '');
      return Number.isNaN(at) || now - at < keepFor(i, shelf.items);
    });
    const changed = kept.length !== shelf.items.length;
    shelf.items = kept;
    return changed;
  }

  /** Take a page off the shelf by its loose key (any address variant of it). */
  async removeLoose(loose: string): Promise<void> {
    const shelf = await this.get();
    const kept = shelf.items.filter((i) => looseKey(i) !== loose);
    if (kept.length === shelf.items.length) return;
    shelf.items = kept;
    await this.save(shelf);
  }

  async remove(key: string): Promise<void> {
    const shelf = await this.get();
    shelf.items = shelf.items.filter((i) => i.key !== key);
    await this.save(shelf);
  }

  async setBrowser(browser: BrowserName | 'window'): Promise<void> {
    const shelf = await this.get();
    shelf.browser = browser;
    await this.save(shelf);
  }

  async addPlace(place: BreakPlace): Promise<void> {
    const shelf = await this.get();
    shelf.places = [...shelf.places.filter((p) => p.url !== place.url), place].slice(0, 12);
    await this.save(shelf);
  }

  async removePlace(url: string): Promise<void> {
    const shelf = await this.get();
    shelf.places = shelf.places.filter((p) => p.url !== url);
    await this.save(shelf);
  }
}

/**
 * Episodes of the same show sit together on the shelf: "Shark Tank S10E4" and "Shark Tank S10E5" share
 * the words before the episode marker. Returns the show's name, or null for a one-off.
 */
export function showName(title: string): string | null {
  const t = title.replace(/\s+[-–|·]\s+(YouTube|Netflix|Twitch|Prime Video|Disney\+)$/i, '').trim();
  const m = /^(.{3,40}?)\s*(?:[-–|:·,]\s*)?(?:S\d{1,2}\s*E\d{1,3}|Season\s+\d+|Episode\s+\d+|Ep\.?\s*\d+|Part\s+\d+|#\d+)\b/i.exec(t);
  return m ? m[1].replace(/[-–|:·,\s]+$/, '').trim() : null;
}
