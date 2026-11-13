// Every message the UI can send to the main process. Each handler checks who sent it
// and validates its input before doing anything.

import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { RELEASES_PAGE } from './updater';
import { setupItems } from './setup';
import type { AppInfo, AskAction, AskAnswer, BrowserName, SaveEntry, TidyKeep, UpdateState } from '../shared/types';
import { timeAgo } from '../shared/time';
import { askStashd, runAction } from './ask';
import * as v from '../shared/validate';
import { copyChromeHelper, helperDir, helperDragIcon, lastHeardFromChrome, openChromeExtensions } from './chromehelper';
import type { Core } from './core';
import type { SecretStore } from './secrets';
import { broadcast, fitHeight, getWindow, holdWindow, isAppUrl, routeOf, showWindow } from './windows';

const AUTOMATION_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation';
const ACCESSIBILITY_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';
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
  /** Sends one Ask Stashd question (with its context) to Stashd AI. */
  askSend: (content: string) => Promise<{ text: string; left?: number }>;
  shortcutErrors: () => string[];
  afterSave: (result: { jobId: string; entryId: string; tidy: boolean }) => void;
  payload: (route: string) => unknown;
  finishNaming: (names: (string | null)[]) => void;
  finishSorting: (answer: import('../shared/types').SortingAnswer) => void;
  undoTidy: () => Promise<void>;
  dismissToast: () => void;
  holdToast: (on: boolean) => void;
  toastAction: () => Promise<void>;
  tidyAll: (keep?: TidyKeep) => Promise<void>;
  afterShelve: (items: import('../shared/types').Item[]) => void;
  overlayDone: () => void;
  testClaude: (key: string) => Promise<void>;
  openSave: (mode: 'save' | 'pack', jobId?: string) => void;
  beforeOpen: (items: import('../shared/types').Item[]) => void | (() => void);
  update: { state: () => UpdateState | null; check: () => Promise<UpdateState | null>; restart: () => void };
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

// Adding the Chrome helper: Chrome's extensions page, with the guide card beside it. The guide ticks
// itself off once Chrome starts talking to Stashd (a fresh chrome.json), then closes.
let guideWatch: NodeJS.Timeout | null = null;
let dragIcon: Electron.NativeImage | null = null;
export async function setupChromeGroups(): Promise<true> {
  await copyChromeHelper();
  dragIcon = await helperDragIcon();
  const since = Date.now();
  await openChromeExtensions();
  showWindow('chromeguide');
  if (guideWatch) clearInterval(guideWatch);
  guideWatch = setInterval(() => {
    void lastHeardFromChrome().then((at) => {
      const open = !!getWindow('chromeguide');
      if (!open || Date.now() - since > 20 * 60_000) {
        if (guideWatch) clearInterval(guideWatch);
        guideWatch = null;
      } else if (at > since) {
        if (guideWatch) clearInterval(guideWatch);
        guideWatch = null;
        broadcast('chrome:helperAdded');
        setTimeout(() => getWindow('chromeguide')?.close(), 2800);
      }
    });
  }, 1000);
  return true;
}

export function registerIpc(core: Core, secrets: SecretStore, hooks: IpcHooks): void {
  handle('app:info', async (): Promise<AppInfo> => ({
    version: app.getVersion(),
    hasApiKey: await secrets.has(),
    shortcutErrors: hooks.shortcutErrors(),
  }));

  // Ask Stashd. Proposed changes wait here by id; only what Stashd proposed can run, and only after you confirm.
  const proposals = new Map<string, AskAction>();
  const undos = new Map<string, () => Promise<void>>();
  const savedLabel = (latest: SaveEntry | null) => (latest ? `${latest.items.length} ${latest.items.length === 1 ? 'thing' : 'things'} · saved ${timeAgo(latest.savedAt)}` : 'Empty');
  handle('ask:question', async (_e, question, chat) => {
    const q = v.str(question, 'question', 500).trim();
    const chatId = chat == null ? null : Number(chat);
    if (chatId != null && !Number.isInteger(chatId)) throw new Error('bad chat');
    if (!q) throw new Error('Ask a question first.');
    const answer = await askStashd(q, {
      enabled: () => core.settings.get().stashdAi,
      jobs: async () => Promise.all((await core.store.list()).map(async (job) => ({ job, latest: await core.store.latest(job.id).catch(() => null) }))),
      look: async () => {
        const l = await core.lookAtOpen();
        return { items: l.items, front: l.front };
      },
      week: () => core.memory?.week() ?? [],
      vectors: core.meaning ? async (texts) => (await core.meaning?.vectors(texts)) ?? undefined : undefined,
      send: hooks.askSend,
      savedLabel,
      earlier: () =>
        chatId == null
          ? []
          : (core.memory?.chat(chatId) ?? []).flatMap((t) => {
              const answer = t.reply && typeof t.reply === 'object' ? (t.reply as { answer?: unknown }).answer : undefined;
              return typeof answer === 'string' ? [{ question: t.question, answer }] : [];
            }),
    });
    if ('answer' in answer && answer.action) {
      if (proposals.size > 20) proposals.clear();
      proposals.set(answer.action.id, answer.action);
    }
    // Answers are kept in Stashd's memory, so past chats come back (Forget my history clears them).
    let id = chatId;
    if ('answer' in answer) {
      try {
        id = core.memory?.addTurn(chatId, q, { ...answer, left: undefined }) ?? null;
      } catch {
        // the chat still shows; it just isn't kept
      }
    }
    return { chatId: id, reply: answer };
  });
  handle('ask:chats', () => core.memory?.chats() ?? []);
  handle('ask:chat', (_e, id) =>
    (core.memory?.chat(Number(id)) ?? []).map((t) => ({ question: t.question, reply: t.reply && typeof t.reply === 'object' ? { ...(t.reply as AskAnswer), past: true } : { problem: 'error', message: 'This answer couldn’t be read.' } })),
  );
  handle('ask:deleteChat', (_e, id) => {
    core.memory?.deleteChat(Number(id));
    return core.memory?.chats() ?? [];
  });
  handle('ask:do', async (_e, id) => {
    const action = proposals.get(v.str(id, 'id', 100));
    if (!action) throw new Error('That change has expired. Ask again.');
    // Taken out while it runs (so it can't run twice), and put back if it fails, so you can try again.
    proposals.delete(action.id);
    const undo = await runAction(action, {
      addToFolder: (jobId, items) => core.addToFolder(jobId, items),
      removeItem: (jobId, key) => core.removeItem(jobId, key),
      restoreItem: (jobId, key) => core.restoreItem(jobId, key),
      moveItem: (from, key, to) => core.moveItem(from, key, to),
      rename: (jobId, name) => core.rename(jobId, name),
      currentName: async (jobId) => (await core.store.get(jobId)).name,
      setPinned: (jobId, pinned) => core.setPinned(jobId, pinned),
      setDone: (jobId, done) => core.setDone(jobId, done),
      unpack: (jobId) => core.open(jobId, undefined, 'all', hooks.beforeOpen).then(() => undefined),
    }).catch((e: unknown) => {
      proposals.set(action.id, action);
      throw e;
    });
    if (!undo) return null;
    undos.set(action.id, undo);
    return action.id;
  });
  handle('ask:undo', async (_e, id) => {
    const key = v.str(id, 'id', 100);
    const undo = undos.get(key);
    if (!undo) throw new Error('That can’t be undone any more.');
    undos.delete(key);
    try {
      await undo();
    } catch (e) {
      undos.set(key, undo);
      throw e;
    }
    return true;
  });

  handle('memory:info', () => core.memory?.counts() ?? null);
  handle('memory:forget', async () => {
    core.memory?.forget();
    await core.sites?.forget().catch(() => undefined);
    return core.memory?.counts() ?? null;
  });
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
    return core.preview({ asNew: o.asNew === true, asFolder: o.asFolder === true, jobId: o.jobId == null ? undefined : v.jobId(o.jobId), byHand: true });
  });
  handle('save:refine', () => core.refineSave());
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
  handle('jobs:findMoved', (_e, id, key) => core.findMoved(v.jobId(id), v.itemKey(key)));
  handle('jobs:restoreItem', (_e, id, key) => core.restoreItem(v.jobId(id), v.itemKey(key)));
  handle('jobs:moveItem', (_e, from, key, to) => core.moveItem(v.jobId(from), v.itemKey(key), v.jobId(to)));
  handle('jobs:rename', (_e, id, name) => core.rename(v.jobId(id), v.jobName(name)));
  handle('jobs:done', (_e, id, done) => core.setDone(v.jobId(id), v.bool(done, 'done')));
  handle('jobs:pin', (_e, id, pinned) => core.setPinned(v.jobId(id), v.bool(pinned, 'pinned')));
  handle('jobs:keep', (_e, id) => core.keepForYou(v.jobId(id)));
  handle('break:shelf', () => core.breakShelf());
  handle('break:apps', () => core.macApps());
  handle('break:open', (_e, url) => core.openBreak(v.str(url, 'address', 4000)));
  handle('break:change', (_e, change) => {
    const c = (change ?? {}) as Record<string, unknown>;
    const browsers = [...v.BROWSERS, 'window'];
    if (c.browser != null && !browsers.includes(String(c.browser))) throw new Error('bad browser');
    const place = c.addPlace as Record<string, unknown> | undefined;
    const rename = c.renamePlace as Record<string, unknown> | undefined;
    return core.changeBreak({
      browser: c.browser == null ? undefined : (String(c.browser) as BrowserName | 'window'),
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
    // A folder Stashd made for you that you never used goes without asking: you didn't make it.
    const forYou = !!(await core.store.get(jobId).catch(() => null))?.forYou;
    const ok = forYou || Date.now() - (confirmedDelete.get(jobId) ?? 0) < 10_000;
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
    } else if (route === 'welcome') {
      getWindow('panel')?.hide();
      showWindow('welcome');
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
  handle('system:setupChromeGroups', () => setupChromeGroups());
  // Whether Chrome has ever talked to Stashd's helper: then it's added.
  handle('system:chromeHelperAdded', async () => (await lastHeardFromChrome()) > 0);
  // The guide's folder, dragged onto Chrome's extensions page: Chrome adds it, no file picker needed.
  ipcMain.on('chromeguide:drag', (event) => {
    if (!isAppUrl(event.senderFrame?.url ?? '') || !dragIcon) return;
    event.sender.startDrag({ file: helperDir(), icon: dragIcon });
  });
  // For Chrome's own file picker instead: ⌘⇧G and paste this.
  handle('chromeguide:copyPath', () => {
    clipboard.writeText(helperDir());
    return true;
  });
  handle('ui:payload', (event) => hooks.payload(routeOf(BrowserWindow.fromWebContents(event.sender)) ?? ''));
  handle('naming:done', (_e, names) => {
    if (!Array.isArray(names) || names.length > 50) throw new Error('bad names');
    hooks.finishNaming(names.map((n) => (n == null ? null : v.str(n, 'file name', 200).trim() || null)));
    return true;
  });
  handle('sorting:done', (_e, a) => {
    if (a === null || a === 'rest') hooks.finishSorting(a);
    else if (typeof a === 'object') {
      const { name, note } = a as { name?: unknown; note?: unknown };
      hooks.finishSorting({ name: v.str(name, 'folder name', 120).trim(), note: v.str(note ?? '', 'note', 2000).trim() });
    }
    else throw new Error('bad answer');
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
  handle('tidy:all', (_e, keep) => {
    getWindow('panel')?.hide();
    void hooks.tidyAll(keep === 'front' || keep === 'all' ? keep : undefined);
    return true;
  });
  handle('tidy:front', () => core.tidyFront());
  // The welcome (first run).
  handle('setup:status', () => setupItems(core.helper, core.settings.get()));
  handle('setup:allow', () => setupItems(core.helper, core.settings.get(), true));
  handle('setup:accessibility', async () => {
    // macOS's own prompt leads to the right place in System Settings; open it too, in case the prompt was turned down before.
    const trusted = await core.helper.accessibility(true).catch(() => false);
    if (!trusted) await shell.openExternal(ACCESSIBILITY_SETTINGS);
    return trusted;
  });
  handle('setup:done', async () => {
    await core.settings.update({ welcomed: true });
    getWindow('welcome')?.close();
    return true;
  });
  handle('update:state', () => hooks.update.state());
  handle('update:check', () => hooks.update.check());
  handle('update:page', () => {
    void shell.openExternal(RELEASES_PAGE);
    return true;
  });
  handle('update:restart', () => {
    hooks.update.restart();
    return true;
  });
  handle('toast:hold', (_e, on) => {
    hooks.holdToast(on === true);
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

