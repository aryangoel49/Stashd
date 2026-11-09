// Finding a place to add on the Break page: type a few letters and pick an app on this Mac or a
// well-known site, or type any web address. An app place is kept as a file:// address to its .app.

export interface PlaceOption {
  name: string;
  url: string;
  kind: 'app' | 'site' | 'address';
}

/** Well-known places for a break, with other words people type for them. */
export const PLACE_SITES: { name: string; url: string; also?: string[] }[] = [
  { name: 'YouTube', url: 'https://www.youtube.com/', also: ['yt'] },
  { name: 'YouTube Music', url: 'https://music.youtube.com/' },
  { name: 'Netflix', url: 'https://www.netflix.com/' },
  { name: 'Spotify', url: 'https://open.spotify.com/' },
  { name: 'Twitch', url: 'https://www.twitch.tv/' },
  { name: 'Kick', url: 'https://kick.com/' },
  { name: 'Prime Video', url: 'https://www.primevideo.com/', also: ['amazon'] },
  { name: 'Disney+', url: 'https://www.disneyplus.com/', also: ['disney plus'] },
  { name: 'Hulu', url: 'https://www.hulu.com/' },
  { name: 'Max', url: 'https://www.max.com/', also: ['hbo'] },
  { name: 'Apple TV+', url: 'https://tv.apple.com/', also: ['apple tv'] },
  { name: 'Apple Music', url: 'https://music.apple.com/' },
  { name: 'Crunchyroll', url: 'https://www.crunchyroll.com/', also: ['anime'] },
  { name: 'SoundCloud', url: 'https://soundcloud.com/' },
  { name: 'Reddit', url: 'https://www.reddit.com/' },
  { name: 'X', url: 'https://x.com/', also: ['twitter'] },
  { name: 'Instagram', url: 'https://www.instagram.com/' },
  { name: 'TikTok', url: 'https://www.tiktok.com/' },
  { name: 'Facebook', url: 'https://www.facebook.com/' },
  { name: 'Pinterest', url: 'https://www.pinterest.com/' },
  { name: 'Letterboxd', url: 'https://letterboxd.com/' },
  { name: 'IMDb', url: 'https://www.imdb.com/' },
  { name: 'ESPN', url: 'https://www.espn.com/', also: ['sports'] },
  { name: 'NBA', url: 'https://www.nba.com/' },
  { name: 'Cricbuzz', url: 'https://www.cricbuzz.com/', also: ['cricket'] },
  { name: 'Chess.com', url: 'https://www.chess.com/', also: ['chess'] },
  { name: 'Lichess', url: 'https://lichess.org/', also: ['chess'] },
  { name: 'Steam', url: 'https://store.steampowered.com/', also: ['games'] },
  { name: 'Pocket Casts', url: 'https://play.pocketcasts.com/', also: ['podcasts'] },
  { name: 'Hacker News', url: 'https://news.ycombinator.com/', also: ['hn'] },
];

/** The file:// address an app place is kept as. */
export function appPlaceUrl(appPath: string): string {
  return `file://${appPath.split('/').map(encodeURIComponent).join('/')}`;
}

/** The .app a place opens, or null when it's a web address. */
export function appPathOf(url: string): string | null {
  if (!url.startsWith('file://')) return null;
  try {
    const p = decodeURIComponent(new URL(url).pathname).replace(/\/+$/, '');
    return p.endsWith('.app') ? p : null;
  } catch {
    return null;
  }
}

/** What you typed, as a web address, when it looks like one ("kick.com", "https://…"). */
export function typedAddress(text: string): string | null {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (!/^https?:$/.test(u.protocol) || !/^[^.]+(\.[^.]+)+$/.test(u.hostname) || /\.$/.test(u.hostname)) return null;
    if (!/^[a-z]{2,}$/i.test(u.hostname.split('.').pop() ?? '')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** A short name for a web address: "open.spotify.com" → "Spotify". */
export function nameOfAddress(url: string): string {
  try {
    const parts = new URL(url).hostname.replace(/^(www|m|open|play)\./, '').split('.');
    const main = parts.length > 2 && parts[parts.length - 2].length <= 3 ? parts[parts.length - 3] : parts[0];
    return main.replace(/^./, (c) => c.toUpperCase());
  } catch {
    return url;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+]/g, '');

/** How well a name fits what you typed: 0 for no match, higher is better. */
function score(text: string, name: string, also: string[] = []): number {
  const q = norm(text);
  if (!q) return 0;
  let best = 0;
  for (const [i, n] of [name, ...also].entries()) {
    const words = n.toLowerCase().split(/[\s.+-]+/).map(norm).filter(Boolean);
    const whole = norm(n);
    const s = whole === q ? 4 : whole.startsWith(q) ? 3 : words.some((w) => w.startsWith(q)) ? 2 : q.length >= 3 && whole.includes(q) ? 1 : 0;
    best = Math.max(best, i === 0 ? s : Math.min(s, 2));
  }
  return best;
}

/**
 * Up to `max` options for what you typed: apps on this Mac first, then well-known sites, then the
 * address you typed if it is one. Anything already in your places is left out.
 */
export function searchPlaces(text: string, apps: { name: string; path: string }[], taken: string[], max = 6): PlaceOption[] {
  const have = new Set(taken);
  const out: (PlaceOption & { s: number })[] = [];
  for (const a of apps) {
    const s = score(text, a.name);
    const url = appPlaceUrl(a.path);
    if (s && !have.has(url)) out.push({ name: a.name, url, kind: 'app', s: s + 0.5 });
  }
  for (const site of PLACE_SITES) {
    const s = score(text, site.name, site.also);
    if (s && !have.has(site.url)) out.push({ name: site.name, url: site.url, kind: 'site', s });
  }
  out.sort((x, y) => y.s - x.s || x.name.length - y.name.length || x.name.localeCompare(y.name));
  const picked: PlaceOption[] = out.slice(0, max).map(({ name, url, kind }) => ({ name, url, kind }));
  const typed = typedAddress(text);
  if (typed && !have.has(typed) && !picked.some((p) => p.url === typed)) {
    const known = PLACE_SITES.find((s) => new URL(s.url).hostname.replace(/^www\./, '') === new URL(typed).hostname.replace(/^www\./, ''));
    picked.unshift({ name: known?.name ?? nameOfAddress(typed), url: typed, kind: 'address' });
  }
  return picked.slice(0, max);
}
