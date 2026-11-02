// Real Finder icons for what's in a folder: a file's own icon, an app's icon, and for a tab the
// browser it lives in. All read from this Mac through the helper; nothing goes online.

import type { Helper } from './helper';

export { iconSource } from '../shared/icons';

export class IconCache {
  private cache = new Map<string, string | null>();

  constructor(private readonly helper: Helper) {}

  /** Icons as PNG data URLs, null where there's none. Fetched once, then kept. */
  async get(sources: string[]): Promise<(string | null)[]> {
    const missing = [...new Set(sources.filter((s) => s && !this.cache.has(s)))];
    if (missing.length) {
      const icons = await this.helper.icons(missing).catch(() => missing.map(() => null));
      missing.forEach((s, i) => this.cache.set(s, icons[i] ?? null));
    }
    return sources.map((s) => this.cache.get(s) ?? null);
  }

  /** Only what's already fetched (for animations that can't wait). */
  peek(source: string): string | null {
    return this.cache.get(source) ?? null;
  }
}
