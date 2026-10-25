// Takes a "capture": everything that is open right now, as job items.
// It only looks when asked (when you press the shortcut), never in the background.

import type { Capture, CollectorError, Item, Settings } from '../../shared/types';
import { BROWSERS } from '../../shared/validate';
import { BROWSER_APPS, collectTabs, type Tab } from '../collectors/browsers';
import type { Helper, WindowsInfo } from '../helper';
import { displayUrl } from '../urls';
import { collectDocs } from './docs';

/** Apps that are never items themselves (their content is captured instead, or they are us). */
const NOT_APP_ITEMS = new Set(['Finder', 'Where Was I', 'Electron', 'loginwindow']);

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

  return { appOrder, frontApp, items: items.slice(0, 300) };
}

/** The item you were on last: the front document or active tab of the front app. */
export function frontItemKey(items: Item[], appOrder: string[]): string | null {
  for (const app of appOrder) {
    const inApp = items.filter((i) => i.app === app);
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
  return null;
}

export async function capture(settings: Settings, helper: Helper, selfNames: string[], early?: Promise<WindowsInfo>): Promise<Capture> {
  const errors: CollectorError[] = [];
  let win: WindowsInfo;
  try {
    win = await (early ?? helper.windows());
  } catch (e) {
    errors.push({ collector: 'windows', message: `Could not see which apps are open: ${e instanceof Error ? e.message : String(e)}` });
    win = { front: null, frontBundleId: null, apps: [], order: [] };
  }
  const running = new Set(win.apps.map((a) => a.bundleId));
  const enabledBrowsers = BROWSERS.filter((b) => settings.browsers[b]);
  const [tabResult, docResult] = await Promise.all([
    collectTabs(enabledBrowsers, { keepQueryStrings: settings.keepQueryStrings, excludedDomains: settings.excludedDomains }, running).catch((e) => {
      errors.push({ collector: 'browsers', message: String(e instanceof Error ? e.message : e) });
      return { tabs: [], errors: [] };
    }),
    collectDocs(running),
  ]);
  errors.push(...tabResult.errors, ...docResult.errors);
  const assembled = assemble(win, tabResult.tabs, docResult.items, selfNames, docResult.answered);
  // If an app's files couldn't be read (permission not given yet), say so on its item.
  const blocked = new Set(docResult.errors.map((e) => e.collector.replace(/^docs:/, '')));
  for (const it of assembled.items) {
    if (it.kind === 'app' && blocked.has(it.app)) it.detail = "Couldn't see its files";
  }
  return { at: new Date().toISOString(), ...assembled, errors };
}

