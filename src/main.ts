// Stashd: main process entry point.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { app, globalShortcut, Menu, nativeTheme, powerMonitor, type Rectangle } from 'electron';
import type { Item, OpenState, Route, Settings } from './shared/types';
import { claudeWriter, testClaudeKey } from './main/brief/claude';
import { stashdWriter } from './main/brief/stashd';
import { installId } from './main/install';
import { backupBeforeChange, backupsDir, onDamage } from './main/safety';
import { Core } from './main/core';
import { createMeaning } from './main/meaning';
import { Memory } from './main/memory';
import { AutoSaver } from './main/autosave';
import { RULES } from './main/rules';
import { Helper } from './main/helper';
import { registerIpc } from './main/ipc';
import { SecretStore } from './main/secrets';
import { SettingsStore } from './main/settings';
import { LEGACY_NAME, migrateLegacyData } from './main/legacy';
import { JobStore } from './main/store';
import { TidyFlow } from './main/tidyflow';
import { DormantWatcher, Noticer } from './main/noticer';
import { copyChromeHelper } from './main/chromehelper';
import { runLiveTest } from './main/livetest';
import { runScenarios } from './main/scenarios';
import { runSuggestTest } from './main/suggesttest';
import { AppTray } from './main/tray';
import { broadcast, getWindow, hardenWebContents, justHidden, prepareWindow, showWindow } from './main/windows';

// Development-only: a separate data folder (set before the single-instance check, so a test copy
// can run next to the installed app).
if (!app.isPackaged && process.env.WWI_USER_DATA) app.setPath('userData', process.env.WWI_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start();
}

function helperPath(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'wwi-helper') : path.join(app.getAppPath(), 'native', 'build', 'wwi-helper');
}

function start(): void {
  // Development-only test hooks: window screenshots for checking the UI (WWI_CAPTURE_DIR),
  // and WWI_FAKE_CAPTURE (a JSON file) so UI tests never ask other apps anything.

  let core: Core;
  let tray: AppTray;
  /** Hides the panel and plays the Unpack animation (set once the app is ready). */
  let beforeOpen: (items: Item[]) => void = () => undefined;
  let shortcutErrors: string[] = [];
  let tidyAllNow: () => Promise<void> = async () => undefined;

  app.on('web-contents-created', (_e, contents) => hardenWebContents(contents));
  // Keep running in the menu bar when every window is closed.
  app.on('window-all-closed', () => undefined);
  app.on('second-instance', () => showWindow('main'));
  app.on('will-quit', () => globalShortcut.unregisterAll());

  function togglePanel(anchor: Rectangle, showJob?: string): void {
    const panel = getWindow('panel');
    if (panel?.isVisible() && !showJob) {
      panel.hide();
      return;
    }
    if (!showJob && justHidden('panel')) return;
    showWindow('panel', {
      near: anchor,
      onReady: (win) => {
        if (showJob) win.webContents.send('panel:show-job', showJob);
      },
    });
  }

  /** ⌃S: note the window order first (before our box takes the front), then show the box.
   *  "pack" turns Tidy up on for this save. */
  function openSave(mode: 'save' | 'pack' | 'last' = 'last', jobId?: string): void {
    const early = core.helper.windows();
    early.catch(() => undefined);
    getWindow('panel')?.hide();
    core.beginSave(early, jobId);
    showWindow('save', { onReady: (win) => win.webContents.send('save:begin', mode) });
  }

  async function openBrief(): Promise<void> {
    const jobs = await core.listJobs();
    const target = jobs.find((j) => j.current) ?? jobs.find((j) => !j.done);
    togglePanel(tray.bounds(), target?.id);
  }

  /** ⌃O: Unpack the pinned folder, or the one you opened last. Already all open? Show its brief instead. */
  async function quickOpen(): Promise<void> {
    const id = await core.quickOpenTarget();
    if (!id) return togglePanel(tray.bounds());
    const state = (await core.openState().catch(() => ({}) as Record<string, OpenState>))[id];
    if (state && state.total > 0 && state.open === state.total) return togglePanel(tray.bounds(), id);
    await core.open(id, undefined, 'all', beforeOpen);
  }

  function applyShortcuts(s: Settings): void {
    globalShortcut.unregisterAll();
    shortcutErrors = [];
    const pairs: [string, () => void][] = [
      [s.shortcutSave, () => openSave()],
      [s.shortcutRecap, () => void openBrief()],
      [s.shortcutOpen, () => void quickOpen()],
      [s.shortcutTidy, () => void tidyAllNow()],
    ];
    for (const [accel, fn] of pairs) {
      try {
        if (!globalShortcut.register(accel, fn)) shortcutErrors.push(`${accel} is already used by another app.`);
      } catch {
        shortcutErrors.push(`${accel} is not a valid shortcut.`);
      }
    }
  }

  function applyLoginItem(s: Settings): void {
    // Only the installed app should register itself; in development this would register Electron itself.
    if (app.isPackaged && app.getLoginItemSettings().openAtLogin !== s.launchAtLogin) {
      app.setLoginItemSettings({ openAtLogin: s.launchAtLogin });
    }
  }

  void app.whenReady().then(() => {
    app.dock?.hide();
    // A minimal app menu so Copy, Paste and Select All work in text boxes.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { label: 'Window', submenu: [{ role: 'close' }, { role: 'minimize' }] }]),
    );

    const dir = app.getPath('userData');
    const legacyDir = process.env.WWI_USER_DATA ? undefined : path.join(app.getPath('appData'), LEGACY_NAME);
    if (legacyDir) {
      try {
        migrateLegacyData(legacyDir, dir);
      } catch {
        // Starting fresh is better than not starting.
      }
    }
    try {
      backupBeforeChange(dir, app.getVersion());
    } catch (e) {
      // Nothing is lost by carrying on, and the next launch tries again.
      console.warn('Could not back up your saves:', e);
    }
    const settings = new SettingsStore(dir);
    const secrets = new SecretStore(dir);
    const helper = new Helper(helperPath());
    const fake = !app.isPackaged ? process.env.WWI_FAKE_CAPTURE : undefined;
    core = new Core(settings, new JobStore(path.join(dir, 'jobs'), backupsDir(dir)), helper, dir, [app.getName(), 'Stashd', LEGACY_NAME, 'Electron'], fake ? async () => ({ ...JSON.parse(await readFile(fake, 'utf8')), at: new Date().toISOString() }) : undefined);
    core.meaning = createMeaning();
    try {
      core.memory = Memory.open(dir);
      core.memory.prune();
    } catch {
      // Stashd runs fine without its memory.
    }
    setTimeout(() => core.meaning?.warm(), 3000);
    let myId: Promise<string> | null = null;
    core.writers = [
      claudeWriter({ getKey: () => secrets.get(), getModel: () => settings.get().aiModel, allowed: () => settings.get().aiDisclosureAccepted }),
      stashdWriter({ installId: () => (myId ??= installId(dir)), allowed: () => settings.get().stashdAi, version: app.getVersion() }),
    ];

    tray = new AppTray({ togglePanel: (b) => togglePanel(b), save: openSave, openMain: () => showWindow('main') });
    onDamage(({ repaired }) => tray.flash(repaired ? 'Repaired a damaged save' : "A damaged save couldn't be repaired"));
    // Build the panel now, hidden, so the first click on the icon shows it at once.
    prepareWindow('panel');
    core.onChanged(() => broadcast('jobs:changed'));
    const tidy = new TidyFlow(core, () => tray.bounds());
    // Tidy all (the panel's button, ⌃⇧S or the toast): the panel steps aside at once so you can watch it
    // go, and the menu bar says it's working until it's done. A second press while it runs does nothing.
    tidyAllNow = () => {
      getWindow('panel')?.hide();
      if (tidy.tidyingAll) return tidy.tidyingAll;
      tray.status('Tidying…');
      return tidy.tidyAll().finally(() => {
        tray.status(null);
        tray.wink();
      });
    };
    // Automatic saving: moving on from a folder, the Mac sleeping, locking or shutting down, walking away.
    const auto = new AutoSaver({
      settings: () => settings.get(),
      memory: () => core.memory,
      rules: RULES,
      lookNow: () => core.lookAtOpen(),
      frontFolder: (l) => core.frontFolder(l),
      foldersInUse: (l) => core.foldersInUse(l),
      save: async (cap, ids) => {
        const saved = await core.autoSave(cap, ids);
        if (saved.length) tray.flash('Saved automatically');
        return saved;
      },
      remove: (jobId, entryId) => core.removeAutoSave(jobId, entryId),
      unpack: (jobId) => core.open(jobId, undefined, 'all', beforeOpen).then(() => undefined),
      ask: (card) => tidy.ask(card),
      busy: () => !!getWindow('save')?.isVisible() || !!getWindow('panel')?.isVisible(),
    });
    powerMonitor.on('suspend', () => void auto.leaving('sleep'));
    powerMonitor.on('lock-screen', () => void auto.leaving('lock'));
    powerMonitor.on('resume', () => void auto.back());
    powerMonitor.on('unlock-screen', () => void auto.back());
    // Shutting down: macOS waits a moment for Stashd to save, then Stashd quits.
    // (Electron passes the event, though its types don't say so.)
    powerMonitor.on('shutdown', ((e?: { preventDefault?: () => void }) => {
      if (!settings.get().autoSave) return;
      e?.preventDefault?.();
      void Promise.race([auto.leaving('shutdown'), new Promise((r) => setTimeout(r, 4000))]).finally(() => app.quit());
    }) as () => void);
    setInterval(() => auto.idle(powerMonitor.getSystemIdleTime()), 30_000);
    setTimeout(() => void auto.afterRestart(), 20_000);
    // What the toast's button does: Unpack a folder you're back on, or Tidy all things sitting unused.
    let toastAct: (() => Promise<void>) | null = null;
    // Opened something from a packed folder yourself? Offer to Unpack the rest.
    const noticer = new Noticer(
      () =>
        core.lookAtOpen().then((look) => {
          void auto.look(look).catch(() => undefined);
          return look;
        }),
      (work) => {
        toastAct = () => core.open(work.jobId, undefined, 'all', beforeOpen).then(() => undefined);
        tidy.offerUnpack(work.name, work.more);
      },
      () => !!getWindow('save')?.isVisible(),
      (videos) => void core.videosClosed(videos).catch(() => undefined),
    );
    // Things sitting open unused for a while? Offer Tidy all.
    const dormant = new DormantWatcher(
      () => helper.windows(),
      () => [...settings.get().lifestyleApps],
      (apps) => {
        toastAct = tidyAllNow;
        tidy.offerTidy(apps);
      },
      () => !!getWindow('save')?.isVisible() || !!getWindow('panel')?.isVisible(),
    );
    beforeOpen = (items: Item[]) => {
      getWindow('panel')?.hide();
      tidy.unpackAnimation(items);
    };

    registerIpc(core, secrets, {
      shortcutErrors: () => shortcutErrors,
      afterSave: ({ jobId, entryId, tidy: tidyUp }) => {
        if (tidyUp) void tidy.run(jobId, entryId).then(() => tray.wink());
        else {
          tray.flash('Saved');
          tray.wink();
        }
      },
      payload: (route) => tidy.payload(route as Route),
      finishNaming: (names) => tidy.finishNaming(names),
      undoTidy: () => tidy.undoLast(),
      dismissToast: () => tidy.dismissToast(),
      tidyAll: tidyAllNow,
      afterShelve: (items) => void tidy.shelve(items).then(() => tray.wink()),
      toastAction: async () => {
        if (tidy.toastActed()) return;
        tidy.dismissToast();
        const act = toastAct;
        toastAct = null;
        if (act) await act();
      },
      overlayDone: () => tidy.finishOverlay(),
      testClaude: (key) => testClaudeKey(key, settings.get().aiModel),
      openSave,
      beforeOpen,
    });

    tidy.prepare();
    void copyChromeHelper().catch(() => undefined);
    if (!process.env.WWI_FAKE_CAPTURE) {
      noticer.start();
      dormant.start();
    }
    const initial = settings.get();
    nativeTheme.themeSource = initial.appearance;
    applyShortcuts(initial);
    applyLoginItem(initial);

    settings.onChange((next, prev) => {
      if (next.shortcutSave !== prev.shortcutSave || next.shortcutRecap !== prev.shortcutRecap || next.shortcutOpen !== prev.shortcutOpen || next.shortcutTidy !== prev.shortcutTidy) applyShortcuts(next);
      if (next.launchAtLogin !== prev.launchAtLogin) applyLoginItem(next);
      if (next.appearance !== prev.appearance) nativeTheme.themeSource = next.appearance;
      broadcast('settings:changed');
    });

    if (!app.isPackaged && process.env.WWI_SUGGEST_TEST) setTimeout(() => void runSuggestTest(core, process.env.WWI_SUGGEST_TEST!), 2000);
    if (!app.isPackaged && process.env.WWI_SCENARIOS) setTimeout(() => void runScenarios(core, tidy, process.env.WWI_SCENARIOS!, process.env.WWI_SCENARIO_FILES ?? ''), 3000);
    if (!app.isPackaged && process.env.WWI_LIVE_TEST) setTimeout(() => void runLiveTest(core, tidy, process.env.WWI_LIVE_TEST!), 3000);
    if (!app.isPackaged && process.env.WWI_CAPTURE_DIR) {
      togglePanel(tray.bounds());
      setTimeout(() => openSave(), 7500);
      if (process.env.WWI_DEMO_TIDY) setTimeout(() => tidy.demo(), 1000);
      const toSettings = process.env.WWI_CAPTURE_MAIN === 'settings';
      setTimeout(() => showWindow('main', toSettings ? { onReady: (w) => w.webContents.send('main:show', 'settings') } : {}), 14_000);
    }
  });
}
