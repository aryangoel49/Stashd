// Every message the UI can send to the main process. Each handler checks who sent it
// and validates its input before doing anything.

import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import type { AppInfo } from '../shared/types';
import * as v from '../shared/validate';
import { setupChromeHelper } from './chromehelper';
import type { Core } from './core';
import type { SecretStore } from './secrets';
import { fitHeight, getWindow, holdWindow, isAppUrl, routeOf, showWindow } from './windows';

const AUTOMATION_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation';
const APPLE_AI_SETTINGS = 'x-apple.systempreferences:com.apple.Siri-Settings.extension';
const CLAUDE_KEYS_PAGE = 'https://console.anthropic.com/settings/keys';

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (event, ...args) => {
    const url = event.senderFrame?.url ?? '';
    if (!isAppUrl(url)) throw new Error('Blocked a message from an unknown page');
    try {
      return await fn(event, ...args);
    } catch (e) {
      // Send a clean, readable message to the UI.
      throw new Error(e instanceof Error ? e.message : String(e));
    }
  });
}

export interface IpcHooks {
  shortcutErrors: () => string[];
  appleStatus: () => Promise<AppInfo['appleAi']>;
  afterSave: (result: { jobId: string; entryId: string; tidy: boolean }) => void;
  payload: (route: string) => unknown;
  finishNaming: (names: (string | null)[]) => void;
  undoTidy: () => Promise<void>;
  dismissToast: () => void;
  toastAction: () => Promise<void>;
  tidyAll: () => Promise<void>;
  afterShelve: (items: import('../shared/types').Item[]) => void;
  overlayDone: () => void;
  testClaude: (key: string) => Promise<void>;
  openSave: (mode: 'save' | 'pack', jobId?: string) => void;
  beforeOpen: (items: import('../shared/types').Item[]) => void;
}

async function confirm(event: IpcMainInvokeEvent, message: string, detail: string, button: string): Promise<boolean> {
  const win = BrowserWindow.fromWebContents(event.sender);
  const route = routeOf(win);
  if (route) holdWindow(route, true);
  try {
    const opts: Electron.MessageBoxOptions = { type: 'warning', buttons: [button, 'Cancel'], defaultId: 1, cancelId: 1, message, detail };
    const res = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    return res.response === 0;
  } finally {
    if (route) holdWindow(route, false);
  }
}

export function registerIpc(core: Core, secrets: SecretStore, hooks: IpcHooks): void {
  handle('app:info', async (): Promise<AppInfo> => ({
    version: app.getVersion(),
    hasApiKey: await secrets.has(),
    appleAi: await hooks.appleStatus(),
    shortcutErrors: hooks.shortcutErrors(),
  }));

  handle('settings:get', () => core.settings.get());
  handle('settings:update', (_e, patch) => core.settings.update(patch));

  handle('claude:connect', async (_e, key) => {
    const k = v.apiKey(key);
    if (k) await hooks.testClaude(k);
    await secrets.set(k);
    // Connecting (after reading what gets sent) is the user's go-ahead for Claude briefs.
    await core.settings.update({ aiDisclosureAccepted: k !== '' });
    return secrets.has();
  });
  handle('claude:openKeysPage', async () => {
    await shell.openExternal(CLAUDE_KEYS_PAGE);
    return true;
  });

  handle('save:preview', (_e, opts) => {
    const o = v.isPlainObject(opts) ? opts : {};
    return core.preview({ asNew: o.asNew === true, asFolder: o.asFolder === true, jobId: o.jobId == null ? undefined : v.jobId(o.jobId) });
  });
  handle('save:commit', async (_e, req) => {
    const r = v.saveRequest(req);
    const result = await core.commitSave(r);
    hooks.afterSave({ jobId: result.jobId, entryId: result.entryId, tidy: r.tidy });
    return result;
  });
  handle('save:aiName', (_e, keys) => {
    if (!Array.isArray(keys) || keys.length > v.MAX_ITEMS) throw new Error('bad items');
    return core.aiName(keys.filter((k) => typeof k !== 'string' || k.length <= v.MAX_KEY).map(v.itemKey));
  });
  handle('save:shelve', async (_e, keys) => {
    if (!Array.isArray(keys) || keys.length > v.MAX_ITEMS) throw new Error('bad items');
    const items = await core.shelveBreaks(keys.map(v.itemKey));
    hooks.afterShelve(items);
    return true;
  });
  handle('save:cancel', () => {
    core.cancelSave();
    return true;
  });

  handle('jobs:list', () => core.listJobs());
  handle('jobs:openState', () => core.openState());
  handle('suggest:list', () => core.suggestions());
  handle('suggest:accept', (_e, id) => core.acceptSuggestion(v.str(id, 'suggestion', 4300)));
  handle('suggest:dismiss', (_e, id, forever) => core.dismissSuggestion(v.str(id, 'suggestion', 4300), v.bool(forever, 'forever')));
  handle('suggest:undo', () => core.undoSuggestion());
  handle('jobs:brief', (_e, id, entry) => core.briefView(v.jobId(id), entry == null ? undefined : v.entryId(entry)));
  handle('jobs:rewriteBrief', (_e, id, entry) => core.rewriteBrief(v.jobId(id), v.entryId(entry)));
  handle('jobs:feedback', (_e, id, entry, helpful, comment) =>
    core.feedback(v.jobId(id), v.entryId(entry), v.bool(helpful, 'helpful'), comment == null ? undefined : v.str(comment, 'comment', 500)),
  );
  handle('jobs:open', (_e, id, entry, mode, keys) =>
    core.open(v.jobId(id), entry == null ? undefined : v.entryId(entry), v.openMode(mode), hooks.beforeOpen, v.openKeys(keys)),
  );
  handle('icons:get', (_e, sources) => {
    if (!Array.isArray(sources) || sources.length > 60) throw new Error('bad icon list');
    return core.icons.get(sources.map((s) => v.str(s, 'icon', 1024)));
  });
  handle('jobs:openItem', (_e, id, key) => core.openItem(v.jobId(id), v.itemKey(key)));
  handle('jobs:removeItem', (_e, id, key) => core.removeItem(v.jobId(id), v.itemKey(key)));
  handle('jobs:restoreItem', (_e, id, key) => core.restoreItem(v.jobId(id), v.itemKey(key)));
  handle('jobs:moveItem', (_e, from, key, to) => core.moveItem(v.jobId(from), v.itemKey(key), v.jobId(to)));
  handle('jobs:rename', (_e, id, name) => core.rename(v.jobId(id), v.jobName(name)));
  handle('jobs:done', (_e, id, done) => core.setDone(v.jobId(id), v.bool(done, 'done')));
  handle('jobs:pin', (_e, id, pinned) => core.setPinned(v.jobId(id), v.bool(pinned, 'pinned')));
  handle('break:shelf', () => core.breakShelf());
  handle('break:open', (_e, url) => core.openBreak(v.str(url, 'address', 4000)));
  handle('break:change', (_e, change) => {
    const c = (change ?? {}) as Record<string, unknown>;
    const browsers = ['chrome', 'arc', 'safari', 'window'];
    if (c.browser != null && !browsers.includes(String(c.browser))) throw new Error('bad browser');
    const place = c.addPlace as Record<string, unknown> | undefined;
    const rename = c.renamePlace as Record<string, unknown> | undefined;
    return core.changeBreak({
      browser: c.browser == null ? undefined : (String(c.browser) as 'chrome'),
      removeItem: c.removeItem == null ? undefined : v.itemKey(c.removeItem),
      addPlace: place ? { name: v.str(place.name, 'name', 40).trim() || 'Place', url: new URL(v.str(place.url, 'address', 2000)).toString() } : undefined,
      renamePlace: rename ? { name: v.str(rename.name, 'name', 40).trim() || 'Place', url: v.str(rename.url, 'address', 2000) } : undefined,
      removePlace: c.removePlace == null ? undefined : v.str(c.removePlace, 'address', 2000),
      orderPlaces: Array.isArray(c.orderPlaces) ? c.orderPlaces.slice(0, 12).map((u) => v.str(u, 'address', 2000)) : undefined,
    });
  });
  handle('jobs:card', async (_e, id) => {
    const jobId = v.jobId(id);
    return (await core.store.get(jobId)).card ?? core.refreshCard(jobId);
  });
  handle('jobs:editCard', (_e, id, change) => {
    const c = (change ?? {}) as Record<string, unknown>;
    const opt = (x: unknown, what: string) => (x == null ? undefined : v.str(x, what, 200));
    return core.editCard(v.jobId(id), { add: opt(c.add, 'name'), hide: opt(c.hide, 'name'), unadd: opt(c.unadd, 'name') });
  });
  // Deleting can be asked first (so the page can play its goodbye before the folder disappears), then
  // done within a few seconds without asking twice. A delete with no recent yes still asks.
  const confirmedDelete = new Map<string, number>();
  const askDelete = async (event: IpcMainInvokeEvent, jobId: string) => {
    const job = await core.store.get(jobId);
    return confirm(event, `Delete "${job.name}"?`, 'Its saves and history are removed. Your files and tabs are not touched.', 'Delete folder');
  };
  handle('jobs:confirmDelete', async (event, id) => {
    const jobId = v.jobId(id);
    if (!(await askDelete(event, jobId))) return false;
    confirmedDelete.set(jobId, Date.now());
    return true;
  });
  handle('jobs:delete', async (event, id) => {
    const jobId = v.jobId(id);
    const ok = Date.now() - (confirmedDelete.get(jobId) ?? 0) < 10_000;
    confirmedDelete.delete(jobId);
    if (!ok && !(await askDelete(event, jobId))) return false;
    await core.deleteJob(jobId);
    return true;
  });

  handle('window:open', (_e, route, jobId) => {
    // Pack up on a folder names it, so the box packs that folder instead of guessing.
    if (route === 'save' || route === 'pack') hooks.openSave(route, jobId == null ? undefined : v.jobId(jobId));
    else if (route === 'main' || route === 'settings') {
      getWindow('panel')?.hide();
      // The panel's "See in Stashd" opens the window on Recently closed.
      const page = route === 'main' && jobId === 'recent' ? 'recent' : route;
      showWindow('main', { onReady: (w) => w.webContents.send('main:show', page) });
    } else throw new Error('bad window');
    return true;
  });
  handle('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (routeOf(win) === 'panel') win?.hide();
    else win?.close();
    return true;
  });
  handle('window:fit', (event, height) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && typeof height === 'number' && Number.isFinite(height)) fitHeight(win, height);
    return true;
  });
  handle('system:openAutomationSettings', async () => {
    await shell.openExternal(AUTOMATION_SETTINGS);
    return true;
  });
  handle('system:setupChromeGroups', async () => {
    await setupChromeHelper();
    return true;
  });
  handle('system:openAppleAiSettings', async () => {
    await shell.openExternal(APPLE_AI_SETTINGS);
    return true;
  });
  handle('ui:payload', (event) => hooks.payload(routeOf(BrowserWindow.fromWebContents(event.sender)) ?? ''));
  handle('naming:done', (_e, names) => {
    if (!Array.isArray(names) || names.length > 50) throw new Error('bad names');
    hooks.finishNaming(names.map((n) => (n == null ? null : v.str(n, 'file name', 200).trim() || null)));
    return true;
  });
  handle('tidy:undo', () => hooks.undoTidy());
  handle('overlay:done', () => {
    hooks.overlayDone();
    return true;
  });
  handle('toast:action', () => hooks.toastAction());
  handle('tidy:recent', () => core.recentlyTidied());
  handle('tidy:reopen', (_e, key) => core.reopenTidied(key == null ? undefined : v.itemKey(key)));
  handle('tidy:all', () => {
    getWindow('panel')?.hide();
    void hooks.tidyAll();
    return true;
  });
  handle('toast:dismiss', () => {
    hooks.dismissToast();
    return true;
  });
  handle('app:quit', () => {
    app.quit();
    return true;
  });
}

