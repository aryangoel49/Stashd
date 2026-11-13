// Reopens a job's items. It only opens things; it never closes or changes anything.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app, screen, shell } from 'electron';
import type { BrowserName, Frame, Item, OpenResult, Settings } from '../shared/types';
import { BROWSERS } from '../shared/validate';
import { BROWSER_APPS, collectTabs, isChromium, isRunning } from './collectors/browsers';
import { run } from './exec';
import { videoKey } from './breaks';
import { fitFrame, frameToBounds, titleHint, type Rect } from './frames';
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
 * A browser window's tabs open together, a moment apart, the one you were on last ending up in front.
 * They go into the window you have open (its id as the second argument) when there is one, else a new
 * window. The first argument is the place to put that window ("left,top,right,bottom", or "" to leave
 * it be); the addresses follow. Arc has no windows to speak of, so it isn't grouped.
 */
export function newWindowScript(browser: BrowserName): string | null {
  const id = BROWSER_APPS[browser].bundleId;
  if (!isChromium(browser) && browser !== 'safari') return null;
  const fresh = isChromium(browser)
    ? `      set wwiWin to make new window
      set URL of active tab of wwiWin to (item 1 of wwiUrls)`
    : `      make new document with properties {URL:(item 1 of wwiUrls)}
      set wwiWin to front window`;
  return `on run wwiArgs
${readBounds(1)}
  set wwiReuse to item 2 of wwiArgs
  set wwiUrls to rest of rest of wwiArgs
  tell application id "${id}"
${REUSE}
    set wwiFrom to 1
    if wwiWin is missing value then
${fresh}
      set wwiFrom to 2
    end if${SET_BOUNDS}
    repeat with wwiI from wwiFrom to count of wwiUrls
      if wwiI > 1 then delay ${GAP_MS / 1000}
      tell wwiWin to make new tab at end of tabs with properties {URL:(item wwiI of wwiUrls)}
    end repeat${browser === 'safari' ? '\n    set current tab of wwiWin to last tab of wwiWin' : ''}
    set index of wwiWin to 1
    activate
  end tell
end run`;
}

/** wwiWin: the window whose id is in wwiReuse, if it's still there, else missing value. */
const REUSE = `    set wwiWin to missing value
    if wwiReuse is not "" then
      try
        set wwiWin to window id (wwiReuse as integer)
      end try
    end if`;

/** The id of the browser window you have open (the front one that's normal and not minimized), or "". */
function openWindowScript(browser: BrowserName): string | null {
  const id = BROWSER_APPS[browser].bundleId;
  const ok = isChromium(browser) ? 'mode of w is "normal" and not (minimized of w)' : browser === 'safari' ? 'not (miniaturized of w) and (document of w) is not missing value' : null;
  if (!ok) return null;
  return `tell application id "${id}"
  repeat with w in windows
    try
      if ${ok} then return (id of w) as text
    end try
  end repeat
end tell
return ""`;
}

async function openWindowId(browser: BrowserName): Promise<string> {
  const script = openWindowScript(browser);
  if (!script) return '';
  try {
    return (await run('osascript', ['-e', script], { timeoutMs: 10_000 })).stdout.trim();
  } catch {
    return '';
  }
}

/** Reads argument n ("left,top,right,bottom" or "") into wwiBounds, a list of four numbers or {}. */
const readBounds = (n: number) => `  set wwiBounds to {}
  set wwiB to item ${n} of wwiArgs
  if wwiB is not "" then
    set AppleScript's text item delimiters to ","
    set wwiParts to text items of wwiB
    set AppleScript's text item delimiters to ""
    repeat with wwiP in wwiParts
      set end of wwiBounds to (wwiP as integer)
    end repeat
  end if`;
const SET_BOUNDS = `
    if (count of wwiBounds) is 4 then
      try
        set bounds of wwiWin to wwiBounds
      end try
    end if`;

/** Today's screens (their usable areas, main screen first), for fitting saved window places. */
export function screens(): Rect[] {
  try {
    const main = screen.getPrimaryDisplay();
    return [main, ...screen.getAllDisplays().filter((d) => d.id !== main.id)].map((d) => ({ x: d.workArea.x, y: d.workArea.y, w: d.workArea.width, h: d.workArea.height }));
  } catch {
    return [];
  }
}

// ---------- Chrome tab groups ----------
// Chrome doesn't let other apps make tab groups, so Stashd ships a tiny extension (assets/chrome-extension)
// that does. Its id is fixed by the key in its manifest.
export const CHROME_HELPER_ID = 'ledhbdmigicjkhlpchllagcmkpmldjfb';

/** The extension's page that opens these tabs in a group of this name, then closes itself.
 *  `create` (with 'regroup'): make the group when there isn't one. An older extension ignores it, so it
 *  does what it always did (nothing) instead of opening the tabs again. */
export function groupPageUrl(name: string, urls: string[], action?: 'ungroup' | 'regroup', create = false): string {
  const req = action ? { action, name, urls, ...(create ? { create: true } : {}) } : { name, urls };
  return `chrome-extension://${CHROME_HELPER_ID}/open.html#${encodeURIComponent(JSON.stringify(req))}`;
}

// Opens the extension's page and waits a moment: it either closes itself (it opened the group) or shows
// "Stashd" while it works. Without the extension it's an error page, which is closed again.
// (macOS doesn't let other apps read Chrome's settings, so trying is the only way to know it's there.)
// 'open': in the window you have open (its id as the third argument) or else a new one, put at the place
// given as the second argument, where the group's tabs then open.
// 'front': in the front window, without bringing Chrome forward (to change a group quietly).
const groupScript = (where: 'open' | 'front') => `on run wwiArgs
${where === 'open' ? `${readBounds(2)}
  set wwiReuse to item 3 of wwiArgs` : ''}
  tell application id "com.google.Chrome"
${
  where === 'open'
    ? `${REUSE}
    if wwiWin is missing value then
      set wwiWin to make new window
      set wwiId to id of active tab of wwiWin
      set URL of active tab of wwiWin to (item 1 of wwiArgs)
    else
      set wwiId to id of (make new tab at end of tabs of wwiWin with properties {URL:(item 1 of wwiArgs)})
    end if${SET_BOUNDS}
    set index of wwiWin to 1
    activate`
    : `    if (count of windows) is 0 then make new window
    set wwiId to id of (make new tab at end of tabs of front window with properties {URL:(item 1 of wwiArgs)})`
}
    -- Up to 10 seconds: a new window (or a busy Chrome) can be slow to show the page. Stashd's page is
    -- titled "Stashd" as soon as it starts; while it's still loading, keep waiting.
    repeat 100 times
      delay 0.1
      set wwiFound to false
      repeat with wwiW in windows
        repeat with wwiT in tabs of wwiW
          if id of wwiT is wwiId then
            set wwiFound to true
            if title of wwiT is "Stashd" then return "ok"
            -- Loaded, and not Stashd's page: the error page you get without the extension.
            if not (loading of wwiT) and (URL of wwiT) starts with "chrome-extension://" then set wwiFound to "error"
          end if
        end repeat
      end repeat
      if wwiFound is false then return "ok"
      if wwiFound is "error" then exit repeat
    end repeat
    -- Never gave an answer: it may still be working, so opening the tabs again could double them.
    if wwiFound is true then return "ok"
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
 * `create`: make the group if there isn't one, so a folder whose tabs were already open gets one too.
 * Quietly does nothing without Chrome or Stashd's extension, and never brings Chrome to the front.
 */
export async function changeChromeGroup(action: 'ungroup' | 'regroup', name: string, urls: string[], create = false): Promise<void> {
  const web = urls.filter((u) => /^https?:/i.test(u));
  if (!web.length || Date.now() - helperMissingAt < RETRY_HELPER_MS || !(await isRunning('chrome'))) return;
  const r = await run('osascript', ['-e', groupScript('front'), '--', groupPageUrl(name, web, action, create)], { timeoutMs: 20_000 }).catch(() => null);
  // Without the extension this is an error page, closed again: don't try for a while, so saving can't
  // flash a tab in Chrome every time.
  if (r?.stdout.trim() === 'missing') helperMissingAt = Date.now();
}

/** A folder's tabs that Chrome can put in a tab group (web pages open in Chrome). */
export function chromeTabUrls(items: Item[]): string[] {
  return items.filter((i) => i.kind === 'tab' && i.browser === 'chrome' && i.url && /^https?:/i.test(i.url)).map((i) => i.url!);
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

async function openChromeGroup(name: string, urls: string[], bounds: string, reuse: string): Promise<boolean> {
  if (Date.now() - helperMissingAt < RETRY_HELPER_MS) return false;
  const r = await run('osascript', ['-e', groupScript('open'), '--', groupPageUrl(name, urls), bounds, reuse], { timeoutMs: 30_000 });
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

/** Moves windows back where they were (the helper, with Accessibility). */
export type PlaceWindows = (targets: (Frame & { app: string; title?: string })[]) => Promise<unknown>;

/** Opens items in order, with the front item last so it ends up in front. */
export async function openItems(
  items: Item[],
  frontKey: string | null,
  settings: Settings,
  /** Told which tabs (loose keys) were open before anything was opened. */
  onBefore?: (open: Set<string>) => void,
  /** The folder's name: in Chrome, with Stashd's extension, its tabs open in a tab group of that name. */
  groupName?: string,
  /** Puts documents' and apps' windows back where they were, once they're open. */
  place?: PlaceWindows,
): Promise<OpenResult> {
  openingNow++;
  try {
    return await openAll(items, frontKey, settings, onBefore, groupName, place);
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
  place?: PlaceWindows,
): Promise<OpenResult> {
  const result: OpenResult = { opened: 0, alreadyOpen: 0, missing: [], failed: [], problems: [] };
  const missed = (item: Item, why: 'moved' | 'unsaved') => {
    result.missing.push(why === 'unsaved' ? `${item.label} (never saved)` : item.label);
    result.problems.push({ key: item.key, label: item.label, kind: item.kind, why });
  };
  const failed = (item: Item) => {
    result.failed.push(item.label);
    result.problems.push({ key: item.key, label: item.label, kind: item.kind, why: 'failed' });
  };
  // Exact window places only when you've turned them on; otherwise tabs go into your open window as they are.
  const places = settings.windowPlaces;
  const here = places ? screens() : [];
  const urlOptions = { keepQueryStrings: settings.keepQueryStrings, excludedDomains: settings.excludedDomains };
  const fit = (f: Frame | undefined) => (places && f ? fitFrame(f, here) : undefined);

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

  // Each browser's tabs open together (each saved window's, with exact places on), one after another
  // and a moment apart, so Unpack feels calm rather than everything at once.
  const windows = new Map<string, { browser: string; window: number; items: Item[] }>();
  for (const item of ordered) {
    if (item.kind !== 'tab') continue;
    if (item.url && matchKeys(item).some((k) => openUrls.has(k))) {
      result.alreadyOpen++;
      continue;
    }
    const b = item.browser ?? '';
    const w = item.window ?? 1;
    const k = places ? `${b}\n${w}` : b;
    if (!windows.has(k)) windows.set(k, { browser: b, window: w, items: [] });
    windows.get(k)!.items.push(item);
  }
  const openTabs = async () => {
    // The window holding what you were on last goes last, so its tab ends up in front; otherwise the
    // front window (number 1) goes last.
    const groups = [...windows.values()].sort(
      (a, b) =>
        Number(a.items.some((i) => i.key === frontKey)) - Number(b.items.some((i) => i.key === frontKey)) || b.window - a.window,
    );
    // The window you have open in each browser takes the tabs of the saved window that goes last (the
    // front one); any other saved windows get new windows. Noted before anything opens.
    const reuseFor = new Map<(typeof groups)[number], string>();
    for (const b of new Set(groups.map((g) => g.browser))) {
      if (!b || !(await isRunning(b as BrowserName))) continue;
      const id = await openWindowId(b as BrowserName);
      const last = groups.filter((g) => g.browser === b).pop();
      if (id && last) reuseFor.set(last, id);
    }
    for (const g of groups) {
      const { browser, items: group } = g;
      const reuse = reuseFor.get(g) ?? '';
      const app = browser ? BROWSER_APPS[browser as BrowserName].appName : '';
      const frame = fit(group.find((i) => i.frame)?.frame);
      const bounds = frame ? frameToBounds(frame) : '';
      // A first try can open some tabs and still fail (a timeout, the Chrome helper not answering), so
      // anything tried again is checked against what's open first: nothing is ever opened twice.
      let todo = group;
      const leftToOpen = async () => {
        if (!browser) return todo;
        try {
          const { tabs } = await collectTabs([browser as BrowserName], urlOptions);
          const open = new Set(tabs.map((t) => looseKey({ key: `tab:${t.url}`, kind: 'tab', label: '', detail: '', app: '', url: t.url })));
          const left = todo.filter((i) => !(i.url && matchKeys(i).some((k) => open.has(k))));
          result.opened += todo.length - left.length;
          return left;
        } catch {
          return todo;
        }
      };
      const urlsOf = (list: Item[]) => list.map((i) => i.url).filter((u): u is string => !!u && /^(https?:|file:.*\.pdf$)/i.test(u));
      try {
        let urls = urlsOf(todo);
        if (!app || !urls.length) throw new Error('one by one');
        // Opening one thing on its own (clicking a tab) leaves windows as they are.
        const together = urls.length >= 2 || items.length > 1 ? newWindowScript(browser as BrowserName) : null;
        const web = urls.filter((u) => /^https?:/i.test(u));
        let grouped = false;
        if (browser === 'chrome' && groupName && web.length === urls.length && (await isRunning('chrome'))) {
          try {
            grouped = await openChromeGroup(groupName, urls, bounds, reuse);
          } catch {
            grouped = false;
          }
          if (!grouped) {
            todo = await leftToOpen();
            urls = urlsOf(todo);
          }
        }
        if (grouped || !urls.length) {
          // opened in a tab group (or the helper opened them all before giving up)
        } else if (together && (await isRunning(browser as BrowserName))) {
          // '--' so an address is never read as an option.
          await run('osascript', ['-e', together, '--', bounds, reuse, ...urls], { timeoutMs: 60_000 });
        } else if (urls.length <= GENTLE_MAX) {
          for (const [n, url] of urls.entries()) {
            if (n) await pause(GAP_MS);
            await run('open', ['-a', app, url], { timeoutMs: 20_000 });
          }
        } else {
          await run('open', ['-a', app, ...urls], { timeoutMs: 20_000 });
        }
        result.opened += urls.length;
        for (const i of todo) if (!i.url || !urls.includes(i.url)) failed(i);
      } catch {
        todo = await leftToOpen();
        for (const item of todo) {
          try {
            await openUrl(item);
            result.opened++;
          } catch {
            failed(item);
          }
        }
      }
    }
  };

  // Documents' and apps' windows go back where they were once they're open.
  const toPlace: (Frame & { app: string; title?: string })[] = [];
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
            missed(item, 'unsaved');
            continue;
          }
          if (!(await exists(item.path))) {
            missed(item, 'moved');
            continue;
          }
          await openPath(item);
        } else if (chatLink(item)) {
          await run('open', [chatLink(item)!], { timeoutMs: 10_000 });
        } else {
          await run('open', ['-a', item.app], { timeoutMs: 10_000 });
        }
        result.opened++;
        const frame = fit(item.frame);
        const title = titleHint(item);
        if (frame) toPlace.push({ ...frame, app: item.kind === 'folder' ? 'Finder' : item.app, ...(title ? { title } : {}) });
      } catch {
        failed(item);
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
  // In the background: apps still opening get a few seconds, and Unpack doesn't wait for them.
  if (places && place && toPlace.length) void place(toPlace).catch(() => undefined);
  return result;
}
