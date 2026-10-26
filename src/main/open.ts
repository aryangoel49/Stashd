// Reopens a job's items. It only opens things; it never closes or changes anything.

import { promises as fs } from 'node:fs';
import { shell } from 'electron';
import type { Item, OpenResult, Settings } from '../shared/types';
import { BROWSERS } from '../shared/validate';
import { BROWSER_APPS, collectTabs } from './collectors/browsers';
import { run } from './exec';
import { looseKey } from './urls';

async function openUrl(item: Item): Promise<void> {
  const u = new URL(item.url ?? '');
  const pdf = u.protocol === 'file:' && /\.pdf$/i.test(u.pathname);
  if (u.protocol !== 'http:' && u.protocol !== 'https:' && !pdf) throw new Error('Only web addresses can be reopened');
  if (item.browser) {
    try {
      await run('open', ['-a', BROWSER_APPS[item.browser].appName, u.toString()], { timeoutMs: 10_000 });
      return;
    } catch {
      // browser not installed any more: use the default one
    }
  }
  await shell.openExternal(u.toString());
}

// Bundles look like folders but launch when opened.
const BUNDLE_RE = /\.(app|bundle|framework|plugin|kext|pkg|mpkg|workflow|prefpane)$/i;

/**
 * Reopens a document or folder in the app that had it open, never with the file's default handler:
 * a .command or .app that was only being read or browsed must not run on Unpack.
 * If that app is gone, the file is shown in Finder instead.
 */
async function openPath(item: Item): Promise<void> {
  const p = item.path ?? '';
  if (item.kind === 'folder' && BUNDLE_RE.test(p)) {
    await run('open', ['-R', p], { timeoutMs: 10_000 });
    return;
  }
  try {
    await run('open', ['-a', item.kind === 'folder' ? 'Finder' : item.app, p], { timeoutMs: 15_000 });
  } catch {
    await run('open', ['-R', p], { timeoutMs: 10_000 });
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Opens items in order, with the front item last so it ends up in front. */
export async function openItems(items: Item[], frontKey: string | null, settings: Settings): Promise<OpenResult> {
  const result: OpenResult = { opened: 0, alreadyOpen: 0, missing: [], failed: [] };

  // Tabs that are already open are not opened twice.
  let openUrls = new Set<string>();
  if (items.some((i) => i.kind === 'tab')) {
    try {
      const { tabs } = await collectTabs(
        BROWSERS.filter((b) => settings.browsers[b]),
        { keepQueryStrings: settings.keepQueryStrings, excludedDomains: settings.excludedDomains },
      );
      // Matched loosely: a tab that redirected (https, www., trailing slash) still counts as open.
      openUrls = new Set(tabs.map((t) => looseKey({ key: `tab:${t.url}`, kind: 'tab', label: '', detail: '', app: '', url: t.url })));
    } catch {
      // can't tell: open everything
    }
  }

  const ordered = [...items.filter((i) => i.key !== frontKey), ...items.filter((i) => i.key === frontKey)];

  // Tabs go to each browser in one go (one `open` per browser, not one per tab), so Unpack is quick.
  const tabsByBrowser = new Map<string, Item[]>();
  for (const item of ordered) {
    if (item.kind !== 'tab') continue;
    if (item.url && openUrls.has(looseKey(item))) {
      result.alreadyOpen++;
      continue;
    }
    const b = item.browser ? BROWSER_APPS[item.browser].appName : '';
    tabsByBrowser.set(b, [...(tabsByBrowser.get(b) ?? []), item]);
  }
  for (const [app, group] of tabsByBrowser) {
    const urls = group.map((i) => i.url).filter((u): u is string => !!u && /^(https?:|file:.*\.pdf$)/i.test(u));
    try {
      if (!app || !urls.length) throw new Error('one by one');
      await run('open', ['-a', app, ...urls], { timeoutMs: 20_000 });
      result.opened += urls.length;
      result.failed.push(...group.filter((i) => !i.url || !urls.includes(i.url)).map((i) => i.label));
    } catch {
      for (const item of group) {
        try {
          await openUrl(item);
          result.opened++;
        } catch {
          result.failed.push(item.label);
        }
      }
    }
  }

  for (const item of ordered) {
    try {
      if (item.kind === 'tab') {
        continue;
      } else if (item.kind === 'doc' && !item.path && item.url) {
        // A OneDrive or SharePoint document: ask its app to open the address.
        await run('open', ['-a', item.app, item.url], { timeoutMs: 15_000 });
      } else if (item.kind === 'doc' || item.kind === 'folder') {
        if (!item.path) {
          result.missing.push(`${item.label} (never saved)`);
          continue;
        }
        if (!(await exists(item.path))) {
          result.missing.push(item.label);
          continue;
        }
        await openPath(item);
      } else {
        await run('open', ['-a', item.app], { timeoutMs: 10_000 });
      }
      result.opened++;
    } catch {
      result.failed.push(item.label);
    }
  }
  return result;
}
