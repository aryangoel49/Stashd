// Decides which browser tab addresses are kept, and cleans the ones that are.

import { redactUrlString } from './redact';

export interface UrlOptions {
  keepQueryStrings: boolean;
  excludedDomains: string[];
}

/** True if the URL matches an excluded domain (entries with a dot) or keyword (entries without one). */
export function isExcluded(url: URL, excluded: string[]): boolean {
  const host = url.hostname.toLowerCase();
  const hostAndPath = (host + url.pathname).toLowerCase();
  return excluded.some((raw) => {
    const e = raw.trim().toLowerCase();
    if (!e) return false;
    if (e.includes('.')) return host === e || host.endsWith('.' + e);
    return hostAndPath.includes(e);
  });
}

/**
 * Returns a cleaned URL to save, or null if the tab should be dropped.
 * Only http and https pages are kept (no chrome://, file://, about: and so on).
 */
export function cleanTabUrl(raw: string, opts: UrlOptions): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (isExcluded(u, opts.excludedDomains)) return null;
  u.username = '';
  u.password = '';
  if (!opts.keepQueryStrings) {
    u.search = '';
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
