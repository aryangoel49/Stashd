// Reopens a job's items. It only opens things; it never closes or changes anything.

import { promises as fs } from 'node:fs';
import { shell } from 'electron';
import type { Item, OpenResult, Settings } from '../shared/types';
import { BROWSERS } from '../shared/validate';
import { BROWSER_APPS, collectTabs } from './collectors/browsers';
import { run } from './exec';

async function openUrl(item: Item): Promise<void> {
  const u = new URL(item.url ?? '');
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only web addresses can be reopened');
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
      openUrls = new Set(tabs.map((t) => t.url));
    } catch {
      // can't tell: open everything
    }
  }

  const ordered = [...items.filter((i) => i.key !== frontKey), ...items.filter((i) => i.key === frontKey)];
  for (const item of ordered) {
    try {
      if (item.kind === 'tab') {
        if (item.url && openUrls.has(item.url)) {
          result.alreadyOpen++;
          continue;
        }
        await openUrl(item);
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
