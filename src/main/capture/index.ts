// Takes a "capture": everything that is open right now, as job items.
// It only looks when asked (when you press the shortcut), never in the background.

import type { Capture, CollectorError, Item, Settings } from '../../shared/types';
import { BROWSERS, MAX_ITEMS } from '../../shared/validate';
import { BROWSER_APPS, collectTabs, type Tab } from '../collectors/browsers';
import type { ChatInfo, Helper, WindowsInfo } from '../helper';
import { redactCommand, redactLongSecrets } from '../redact';
import { chromeTabGroups } from '../open';
import { attachFrames } from '../frames';
import { cleanTabUrl, displayUrl, looseKey } from '../urls';
import { collectDocs } from './docs';

/** Chat apps whose open chat is saved with them, so Unpack can go back to it. */
export const CHAT_APPS = ['Claude', 'ChatGPT'];

/** "Grant budget - Claude" -> "Grant budget". Null for a window that shows no particular chat. */
export function chatTitle(app: string, title: string): string | null {
  const t = title.replace(/\s+[-–|·]\s+(Claude Code|Claude|ChatGPT)$/i, '').trim();
  if (!t || t.toLowerCase() === app.toLowerCase() || /^(new chat|chatgpt|claude|home)$/i.test(t)) return null;
  return t;
}

/** Puts each chat on its app's item: the chat's name becomes the label, so it sorts with the project. */
export function attachChats(items: Item[], chats: ChatInfo[]): void {
  for (const c of chats) {
    const it = items.find((i) => i.kind === 'app' && i.app === c.app);
    const title = chatTitle(c.app, c.title);
    if (!it || !title) continue;
    it.label = title;
    it.detail = `${c.app} chat`;
    const excerpt = c.text ? redactLongSecrets(redactCommand(c.text)).slice(-1500).trim() : '';
    it.chat = { title, url: c.url, ...(excerpt ? { excerpt } : {}) };
  }
}

/** Apps that are never items themselves (their content is captured instead, or they are us). */
const NOT_APP_ITEMS = new Set(['Finder', 'Stashd', 'Where Was I', 'Electron', 'loginwindow']);

export function tabToItem(t: Tab): Item {
  return {
    key: `tab:${t.url}`,
    kind: 'tab',
    label: t.title || displayUrl(t.url),
    detail: displayUrl(t.url),
    app: BROWSER_APPS[t.browser].appName,
    url: t.url,
    browser: t.browser,
    window: t.window,
    active: t.active,
    ...(t.frame ? { frame: t.frame } : {}),
  };
}

/**
 * Put the pieces together (pure, for tests): dedupe, add app items for apps without
 * captured content, and work out which item was in front.
 */
export function assemble(
  win: WindowsInfo,
  tabs: Tab[],
  docs: Item[],
  selfNames: string[],
  /** Document apps that answered: if they listed nothing, they have nothing open worth reopening. */
  answered: Set<string> = new Set(),
): Omit<Capture, 'at' | 'errors'> {
  const self = new Set([...selfNames, ...NOT_APP_ITEMS]);
  const regular = new Set(win.apps.map((a) => a.name));
  const appOrder = win.order.filter((n) => regular.has(n) && !self.has(n));
  for (const a of win.apps) if (!appOrder.includes(a.name) && !self.has(a.name)) appOrder.push(a.name);
  const frontApp = appOrder[0] ?? null;

  const items: Item[] = [];
  const seen = new Set<string>();
  const add = (it: Item) => {
    if (seen.has(it.key)) {
      if (it.active) {
        const prev = items.find((x) => x.key === it.key);
        if (prev) prev.active = true;
      }
      return;
    }
    seen.add(it.key);
    items.push(it);
  };

  // Order items roughly front to back: by app order, then the app's own order.
  const appRank = (app: string) => {
    const i = appOrder.indexOf(app);
    return i === -1 ? appOrder.length : i;
  };
  const tabItems = tabs.map(tabToItem);
  const content = [...docs, ...tabItems].map((it, i) => ({ it, i }));
  content.sort((a, b) => appRank(a.it.app) - appRank(b.it.app) || a.i - b.i);
  for (const { it } of content) add(it);

  // Apps with nothing captured inside them become "open this app" items.
  const browserApps = new Set(Object.values(BROWSER_APPS).map((b) => b.appName));
  const appsWithContent = new Set(items.map((i) => i.app));
  for (const name of appOrder) {
    if (browserApps.has(name) || appsWithContent.has(name) || self.has(name) || answered.has(name)) continue;
    add({ key: `app:${name}`, kind: 'app', label: name, detail: 'App', app: name });
  }

  return { appOrder, frontApp, items: items.slice(0, MAX_ITEMS) };
}

/**
 * What you're on right now, for Tidy all's "Keep": the front app's active tab, document or chat, or
 * the app itself (Claude, Terminal) when Stashd can't see inside it. Unlike frontItemKey, a bare app
 * counts: you're looking at it. Null only if nothing is open.
 */
export function frontThing(items: Item[], appOrder: string[]): Item | null {
  const app = appOrder[0];
  if (!app) return null;
  const key = frontItemKey(items.filter((i) => i.app === app), [app]);
  return items.find((i) => i.key === key) ?? { key: `app:${app}`, kind: 'app', label: app, detail: 'App', app };
}

/**
 * The item you were on last: the front document or active tab of the front app.
 * A bare app (Notion, Terminal) says nothing about what you're working on, so it's skipped
 * for the next app that has a tab or document; only if nothing has one does a bare app count.
 */
export function frontItemKey(items: Item[], appOrder: string[]): string | null {
  for (const app of appOrder) {
    const inApp = items.filter((i) => i.app === app && (i.kind !== 'app' || i.chat));
    if (!inApp.length) continue;
    const tabs = inApp.filter((i) => i.kind === 'tab');
    if (tabs.length) {
      // The front browser window is the one with the lowest window number.
      const firstWindow = Math.min(...tabs.map((t) => t.window ?? 1));
      const active = tabs.find((t) => t.active && (t.window ?? 1) === firstWindow) ?? tabs[0];
      return active.key;
    }
    return (inApp.find((i) => i.active) ?? inApp[0]).key;
  }
  for (const app of appOrder) {
    const bare = items.find((i) => i.app === app);
    if (bare) return bare.key;
  }
  return null;
}

/** `onlyApps`: ask just these apps (by name), e.g. the ones your folders use, to keep quick checks light. */
export async function capture(settings: Settings, helper: Helper, selfNames: string[], early?: Promise<WindowsInfo>, onlyApps?: Set<string>, askChatAccess = false): Promise<Capture> {
  const errors: CollectorError[] = [];
  let win: WindowsInfo;
  try {
    win = await (early ?? helper.windows());
  } catch (e) {
    errors.push({ collector: 'windows', message: `Could not see which apps are open: ${e instanceof Error ? e.message : String(e)}` });
    win = { front: null, frontBundleId: null, apps: [], order: [] };
  }
  const running = new Set(win.apps.filter((a) => !onlyApps || onlyApps.has(a.name)).map((a) => a.bundleId));
  const enabledBrowsers = BROWSERS.filter((b) => settings.browsers[b] && (!onlyApps || onlyApps.has(BROWSER_APPS[b].appName)));
  // Quick open checks (onlyApps) don't need to know which chat is showing.
  const chatApps = onlyApps ? [] : win.apps.map((a) => a.name).filter((n) => CHAT_APPS.includes(n));
  // Which Chrome tab groups tabs are in (Ctrl+S only, not quick open checks).
  const wantGroups = !onlyApps && enabledBrowsers.includes('chrome') && running.has(BROWSER_APPS.chrome.bundleId);
  const groupsP = wantGroups ? chromeTabGroups((u) => cleanTabUrl(u, { keepQueryStrings: settings.keepQueryStrings, excludedDomains: settings.excludedDomains })) : Promise.resolve(new Map<string, string>());
  const [tabResult, docResult, chatResult] = await Promise.all([
    collectTabs(enabledBrowsers, { keepQueryStrings: settings.keepQueryStrings, excludedDomains: settings.excludedDomains }, running).catch((e) => {
      errors.push({ collector: 'browsers', message: String(e instanceof Error ? e.message : e) });
      return { tabs: [], errors: [] };
    }),
    collectDocs(running),
    chatApps.length ? helper.chats(chatApps, askChatAccess).catch(() => null) : Promise.resolve(null),
  ]);
  errors.push(...tabResult.errors, ...docResult.errors);
  const assembled = assemble(win, tabResult.tabs, docResult.items, selfNames, docResult.answered);
  if (chatResult) attachChats(assembled.items, chatResult.chats);
  // Where each document's and app's window is (needs Accessibility; quick open checks skip it).
  if (!onlyApps) {
    const apps = [...new Set(assembled.items.filter((i) => i.kind !== 'tab').map((i) => i.app))];
    const windows = await helper.frames(apps).catch(() => null);
    if (windows) attachFrames(assembled.items, windows);
  }
  const groups = await groupsP;
  if (groups.size) for (const it of assembled.items) if (it.kind === 'tab' && it.browser === 'chrome') it.group = groups.get(looseKey(it));
  // If an app's files couldn't be read (permission not given yet), say so on its item.
  const blocked = new Set(docResult.errors.map((e) => e.collector.replace(/^docs:/, '')));
  for (const it of assembled.items) {
    if (it.kind === 'app' && blocked.has(it.app)) it.detail = "Couldn't see its files";
  }
  return { at: new Date().toISOString(), ...assembled, errors };
}

