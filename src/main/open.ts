// Reopens a job's items. It only opens things; it never closes or changes anything.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app, shell } from 'electron';
import type { BrowserName, Item, OpenResult, Settings } from '../shared/types';
import { BROWSERS } from '../shared/validate';
import { BROWSER_APPS, collectTabs, isChromium, isRunning } from './collectors/browsers';
import { run } from './exec';
import { videoKey } from './breaks';
import { looseKey, matchKeys } from './urls';

/**
 * The link that opens a saved chat in its app: claude.ai/chat/<id> -> claude://claude.ai/chat/<id>.
 * Only exact Claude chat and Claude Code addresses qualify (the file on disk could be edited by anyone).
 */
export function chatLink(item: Item): string | null {
  if (item.kind !== 'app' || item.app !== 'Claude' || !item.chat?.url) return null;
  const m = /^https:\/\/claude\.ai\/(chat|epitaxy|project)\/([A-Za-z0-9_-]{6,80})$/.exec(item.chat.url);
  return m ? `claude://claude.ai/${m[1]}/${m[2]}` : null;
}

async function openUrl(item: Item): Promise<void> {
  const u = new URL(item.url ?? '');
  const pdf = u.protocol === 'file:' && /\.pdf$/i.test(u.pathname);
  if (u.protocol !== 'http:' && u.protocol !== 'https:' && !pdf)
    throw new Error('Only web addresses can be reopened');
  if (item.browser) {
    try {
      await run(
        'open',
        ['-a', BROWSER_APPS[item.browser].appName, u.toString()],
        { timeoutMs: 10_000 },
      );
      return;
    } catch {
      // browser not installed any more: use the default one
    }
  }
  await shell.openExternal(u.toString());
}

// Bundles look like folders but launch when opened.
const BUNDLE_RE =
  /\.(app|bundle|framework|plugin|kext|pkg|mpkg|workflow|prefpane)$/i;

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
    await run('open', ['-a', item.kind === 'folder' ? 'Finder' : item.app, p], {
      timeoutMs: 15_000,
    });
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

/** When Stashd last opened something, so what it opened is never mistaken for something you opened yourself. */
let lastOpening = 0;
let openingNow = 0;
export function openedRecently(ms: number): boolean {
  return openingNow > 0 || Date.now() - lastOpening < ms;
}

/**
 * A folder's tabs open together in a new window of the browser they came from, a moment apart,
 * the one you were on last ending up in front. Arc has no windows to speak of, so it isn't grouped.
 */
export function newWindowScript(browser: BrowserName): string | null {
  const id = BROWSER_APPS[browser].bundleId;
  const rest = `
    repeat with wwiI from 2 to count of wwiUrls
      delay ${GAP_MS / 1000}
      tell wwiWin to make new tab at end of tabs with properties {URL:(item wwiI of wwiUrls)}
    end repeat
    activate`;
  if (isChromium(browser))
    return `on run wwiUrls
  tell application id "${id}"
    set wwiWin to make new window
    set URL of active tab of wwiWin to (item 1 of wwiUrls)${rest}
  end tell
end run`;
  if (browser === 'safari')
    return `on run wwiUrls
  tell application id "${id}"
    make new document with properties {URL:(item 1 of wwiUrls)}
    set wwiWin to front window${rest}
  end tell
end run`;
  return null;
}

// ---------- Chrome tab groups ----------
// Chrome doesn't let other apps make tab groups, so Stashd ships a tiny extension (assets/chrome-extension)
// that does. Its id is fixed by the key in its manifest.
export const CHROME_HELPER_ID = 'ledhbdmigicjkhlpchllagcmkpmldjfb';

/** The extension's page that opens these tabs in a group of this name, then closes itself. */
export function groupPageUrl(name: string, urls: string[], action?: 'ungroup' | 'regroup'): string {
  return `chrome-extension://${CHROME_HELPER_ID}/open.html#${encodeURIComponent(JSON.stringify(action ? { action, name, urls } : { name, urls }))}`;
}

// Opens the extension's page and waits a moment: it either closes itself (it opened the group) or shows
// "Stashd" while it works. Without the extension it's an error page, which is closed again.
// (macOS doesn't let other apps read Chrome's settings, so trying is the only way to know it's there.)
const GROUP_SCRIPT = `on run wwiArgs
  tell application id "com.google.Chrome"
    if (count of windows) is 0 then make new window
    set wwiId to id of (make new tab at end of tabs of front window with properties {URL:(item 1 of wwiArgs)})
    activate
    repeat 30 times
      delay 0.1
      set wwiFound to false
      repeat with wwiW in windows
        repeat with wwiT in tabs of wwiW
          if id of wwiT is wwiId then
            set wwiFound to true
            if title of wwiT is "Stashd" then return "ok"
          end if
        end repeat
      end repeat
      if not wwiFound then return "ok"
    end repeat
    repeat with wwiW in windows
      repeat with wwiT in tabs of wwiW
        if id of wwiT is wwiId then close wwiT
      end repeat
    end repeat
    return "missing"
  end tell
end run`;

/** After finding the extension missing, don't try again for a while (each try flashes an error tab). */
const RETRY_HELPER_MS = 10 * 60_000;
let helperMissingAt = 0;

/** Opens the tabs in a Chrome tab group through Stashd's extension. False if it isn't installed. */
/**
 * A tab taken out of a folder leaves the folder's Chrome tab group (it stays open); Undo puts it back.
 * Quietly does nothing without Chrome or Stashd's extension, and never brings Chrome to the front.
 */
export async function changeChromeGroup(action: 'ungroup' | 'regroup', name: string, urls: string[]): Promise<void> {
  const web = urls.filter((u) => /^https?:/i.test(u));
  if (!web.length || Date.now() - helperMissingAt < RETRY_HELPER_MS || !(await isRunning('chrome'))) return;
  const script = GROUP_SCRIPT.replace('    activate\n', '');
  await run('osascript', ['-e', script, '--', groupPageUrl(name, web, action)], { timeoutMs: 20_000 }).catch(() => undefined);
}

/**
 * What Stashd's Chrome extension last handed over (assets/chrome-extension/background.js): how far into each
 * video you got, and which named tab group each tab is in. The extension sends it through Chrome's native
 * messaging to Stashd's helper, which keeps it in chrome.json; nothing is opened in Chrome to get it.
 */
async function fromChrome(): Promise<{ videos: unknown[]; groups: unknown[] }> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'chrome.json'), 'utf8')) as { videos?: unknown; groups?: unknown };
    return { videos: Array.isArray(raw.videos) ? raw.videos : [], groups: Array.isArray(raw.groups) ? raw.groups : [] };
  } catch {
    return { videos: [], groups: [] };
  }
}

/**
 * Which Chrome tab group each grouped tab is in, by the tab's loose key ("tab:host/path"). Empty without
 * Chrome or Stashd's extension. A tab in a group named after a folder very likely belongs to it.
 */
export async function chromeTabGroups(clean: (url: string) => string | null): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const p of (await fromChrome()).groups) {
    if (!Array.isArray(p) || typeof p[0] !== 'string' || typeof p[1] !== 'string') continue;
    const url = clean(p[0]);
    if (url) out.set(looseKey({ key: `tab:${url}`, kind: 'tab', label: '', detail: '', app: '', url }), p[1].slice(0, 60));
  }
  return out;
}

/**
 * How far into each video you got, from Stashd's extension (it notes the position and length every few
 * seconds on video sites): video key (see videoKey) -> { t: seconds watched, d: length, 0 for a live
 * stream }. Empty without it.
 */
export async function videoProgress(clean: (url: string) => string | null): Promise<Map<string, { t: number; d: number }>> {
  const out = new Map<string, { t: number; d: number }>();
  // The most recent position of each video, whatever time the address started at.
  const when = new Map<string, number>();
  for (const row of (await fromChrome()).videos) {
    if (!Array.isArray(row) || typeof row[0] !== 'string' || typeof row[1] !== 'number' || typeof row[2] !== 'number') continue;
    const url = clean(row[0]);
    if (!url) continue;
    const k = videoKey(url);
    const at = typeof row[3] === 'number' ? row[3] : 0;
    if ((when.get(k) ?? -1) > at) continue;
    when.set(k, at);
    out.set(k, { t: row[1], d: row[2] });
  }
  return out;
}

/** Watched to the end (or as good as: 95%, or under 20 seconds left). */
export function finished(p: { t: number; d: number } | undefined): boolean {
  return !!p && p.d > 0 && (p.t / p.d >= 0.95 || p.d - p.t <= 20);
}

async function openChromeGroup(name: string, urls: string[]): Promise<boolean> {
  if (Date.now() - helperMissingAt < RETRY_HELPER_MS) return false;
  const r = await run('osascript', ['-e', GROUP_SCRIPT, '--', groupPageUrl(name, urls)], { timeoutMs: 20_000 });
  if (r.stdout.trim() === 'ok') return true;
  helperMissingAt = Date.now();
  return false;
}

/**
 * Opens a break thing where you chose: a browser, or a clean window of its own (a Chrome app window,
 * with no tabs or address bar around it). Falls back to your Mac's default browser.
 */
export async function openForBreak(url: string, where: BrowserName | 'window' | null): Promise<void> {
  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only web addresses can be opened');
  try {
    if (where === 'window') await run('open', ['-na', BROWSER_APPS.chrome.appName, '--args', `--app=${u.toString()}`], { timeoutMs: 10_000 });
    else if (where) await run('open', ['-a', BROWSER_APPS[where].appName, u.toString()], { timeoutMs: 10_000 });
    else throw new Error('no choice');
  } catch {
    await shell.openExternal(u.toString());
  }
}

/** Gap between things opening, and the most tabs opened one by one before it's done in one go. */
const GAP_MS = 150;
const GENTLE_MAX = 12;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Opens items in order, with the front item last so it ends up in front. */
export async function openItems(
  items: Item[],
  frontKey: string | null,
  settings: Settings,
  /** Told which tabs (loose keys) were open before anything was opened. */
  onBefore?: (open: Set<string>) => void,
  /** The folder's name: in Chrome, with Stashd's extension, its tabs open in a tab group of that name. */
  groupName?: string,
): Promise<OpenResult> {
  openingNow++;
  try {
    return await openAll(items, frontKey, settings, onBefore, groupName);
  } finally {
    openingNow--;
    lastOpening = Date.now();
  }
}

async function openAll(
  items: Item[],
  frontKey: string | null,
  settings: Settings,
  onBefore?: (open: Set<string>) => void,
  groupName?: string,
): Promise<OpenResult> {
  const result: OpenResult = {
    opened: 0,
    alreadyOpen: 0,
    missing: [],
    failed: [],
  };

  // Tabs that are already open are not opened twice.
  let openUrls = new Set<string>();
  if (items.some((i) => i.kind === 'tab')) {
    try {
      const { tabs } = await collectTabs(
        BROWSERS.filter((b) => settings.browsers[b]),
        {
          keepQueryStrings: settings.keepQueryStrings,
          excludedDomains: settings.excludedDomains,
        },
      );
      // Matched loosely: a tab that redirected (https, www., trailing slash) still counts as open.
      openUrls = new Set(
        tabs.map((t) =>
          looseKey({
            key: `tab:${t.url}`,
            kind: 'tab',
            label: '',
            detail: '',
            app: '',
            url: t.url,
          }),
        ),
      );
    } catch {
      // can't tell: open everything
    }
  }
  onBefore?.(openUrls);

  const ordered = [
    ...items.filter((i) => i.key !== frontKey),
    ...items.filter((i) => i.key === frontKey),
  ];

  // Tabs open one after another, a moment apart, so Unpack feels calm rather than everything at once.
  // A big folder goes in one go per browser, so it doesn't take ages.
  const tabsByBrowser = new Map<string, Item[]>();
  for (const item of ordered) {
    if (item.kind !== 'tab') continue;
    if (item.url && matchKeys(item).some((k) => openUrls.has(k))) {
      result.alreadyOpen++;
      continue;
    }
    const b = item.browser ?? '';
    tabsByBrowser.set(b, [...(tabsByBrowser.get(b) ?? []), item]);
  }
  const openTabs = async () => {
    // The browser holding what you were on last goes last, so its tab ends up in front.
    const groups = [...tabsByBrowser.entries()].sort(
      ([, a], [, b]) =>
        Number(a.some((i) => i.key === frontKey)) -
        Number(b.some((i) => i.key === frontKey)),
    );
    for (const [browser, group] of groups) {
      const app = browser ? BROWSER_APPS[browser as BrowserName].appName : '';
      const urls = group
        .map((i) => i.url)
        .filter((u): u is string => !!u && /^(https?:|file:.*\.pdf$)/i.test(u));
      try {
        if (!app || !urls.length) throw new Error('one by one');
        const together = urls.length >= 2 ? newWindowScript(browser as BrowserName) : null;
        const web = urls.filter((u) => /^https?:/i.test(u));
        if (browser === 'chrome' && groupName && web.length === urls.length && (await isRunning('chrome')) && (await openChromeGroup(groupName, urls))) {
          // opened in a tab group
        } else if (together && (await isRunning(browser as BrowserName))) {
          // '--' so an address is never read as an option.
          await run('osascript', ['-e', together, '--', ...urls], { timeoutMs: 30_000 });
        } else if (urls.length <= GENTLE_MAX) {
          for (const [n, url] of urls.entries()) {
            if (n) await pause(GAP_MS);
            await run('open', ['-a', app, url], { timeoutMs: 20_000 });
          }
        } else {
          await run('open', ['-a', app, ...urls], { timeoutMs: 20_000 });
        }
        result.opened += urls.length;
        result.failed.push(
          ...group
            .filter((i) => !i.url || !urls.includes(i.url))
            .map((i) => i.label),
        );
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
  };

  const openOthers = async () => {
    let first = true;
    for (const item of ordered) {
      try {
        if (item.kind === 'tab') {
          continue;
        }
        if (!first) await pause(GAP_MS);
        first = false;
        if (item.kind === 'doc' && !item.path && item.url) {
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
        } else if (chatLink(item)) {
          await run('open', [chatLink(item)!], { timeoutMs: 10_000 });
        } else {
          await run('open', ['-a', item.app], { timeoutMs: 10_000 });
        }
        result.opened++;
      } catch {
        result.failed.push(item.label);
      }
    }
  };

  // Whatever you were on last opens last, so it's in front: a tab after the files, or a file after the tabs.
  if (ordered.some((i) => i.key === frontKey && i.kind === 'tab')) {
    await openOthers();
    await openTabs();
  } else {
    await openTabs();
    await openOthers();
  }
  return result;
}
