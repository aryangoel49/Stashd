// Decides which browser tab addresses are kept, and cleans the ones that are.

import type { Item } from '../shared/types';
import { redactUrlString } from './redact';

export interface UrlOptions {
  keepQueryStrings: boolean;
  excludedDomains: string[];
}

/** True if the URL matches an excluded domain (entries with a dot) or keyword (entries without one). */
export function isExcluded(url: URL, excluded: string[]): boolean {
  const host = url.hostname.toLowerCase();
  // A keyword like "bank" or "login" must be a whole part of the address (login.example.com, /bank/login,
  // /login.php), never inside another word, so worldbank.org and /author/ pages are kept.
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep it as it is
  }
  const parts = new Set(`${host}/${path}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  return excluded.some((raw) => {
    const e = raw.trim().toLowerCase();
    if (!e) return false;
    if (e.includes('.')) return host === e || host.endsWith('.' + e);
    return parts.has(e);
  });
}

// Query parts that say which page it is: a YouTube video, a search, a forum thread. They are kept even
// with query strings off, so two different videos are never saved as the same address.
const PAGE_PARAMS = new Set(['v', 'list', 'id', 'p', 'page', 'q', 'query', 'search', 'item', 'story', 'article', 'doc', 'docid', 'pid', 'product', 'tab', 'topic', 'thread', 't']);

/**
 * Returns a cleaned URL to save, or null if the tab should be dropped.
 * Only http and https pages are kept, plus PDFs from this Mac opened in the browser
 * (no chrome://, about:, other file:// pages and so on).
 */
export function cleanTabUrl(raw: string, opts: UrlOptions): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol === 'file:') return /\.pdf$/i.test(u.pathname) ? u.href : null;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (isExcluded(u, opts.excludedDomains)) return null;
  u.username = '';
  u.password = '';
  if (!opts.keepQueryStrings) {
    const kept = [...u.searchParams].filter(([k]) => PAGE_PARAMS.has(k.toLowerCase()));
    u.search = '';
    for (const [k, v] of kept) u.searchParams.append(k, v);
    u.hash = '';
  }
  return redactUrlString(u.toString());
}

/** Shortened form for display, like "github.com/me/repo". */
export function displayUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname === '/' ? '' : u.pathname;
    return (u.hostname.replace(/^www\./, '') + path).slice(0, 80);
  } catch {
    return raw.slice(0, 80);
  }
}

/**
 * The same tab or file, even if its address changed a little after reopening (http → https, www.,
 * a trailing slash or #section), so a folder you opened yourself still shows as open.
 */
export function looseKey(item: Item): string {
  if (item.kind !== 'tab' || !item.url) return item.key;
  try {
    const u = new URL(item.url);
    const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return `tab:${host}${path}${u.search}`;
  } catch {
    return item.key;
  }
}
