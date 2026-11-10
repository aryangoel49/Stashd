// Stashd: main process entry point.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { app, globalShortcut, Menu, nativeTheme, powerMonitor, type Rectangle } from 'electron';
import type { Item, OpenState, Route, Settings, TidyKeep } from './shared/types';
import { claudeWriter, testClaudeKey } from './main/brief/claude';
import { stashdAsk, stashdSites, stashdWriter } from './main/brief/stashd';
import { SiteSorter } from './main/sites';
import { Updater } from './main/updater';
import { GestureWatcher } from './main/gesture';
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
// can run next to the installed app), and a temporary keychain, so a test copy never asks for the Mac's own.
if (!app.isPackaged && process.env.WWI_USER_DATA) {
  app.setPath('userData', process.env.WWI_USER_DATA);
  app.commandLine.appendSwitch('use-mock-keychain');
}

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
  let beforeOpen: (items: Item[]) => void | (() => void) = () => undefined;
  let shortcutErrors: string[] = [];
  let tidyAllNow: (keep?: TidyKeep) => Promise<void> = async () => undefined;

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
    core.sites = new SiteSorter(dir, {
      meaning: () => core.meaning,
      ai: () => (settings.get().stashdAi ? (content) => stashdSites({ installId: () => (myId ??= installId(dir)), version: app.getVersion() }, content) : null),
    });
    void core.sites.start().catch(() => undefined);
    core.writers = [
      claudeWriter({ getKey: () => secrets.get(), getModel: () => settings.get().aiModel, allowed: () => settings.get().aiDisclosureAccepted }),
      stashdWriter({ installId: () => (myId ??= installId(dir)), allowed: () => settings.get().stashdAi, version: app.getVersion() }),
    ];

    tray = new AppTray({ togglePanel: (b) => togglePanel(b), save: openSave, openMain: () => showWindow('main') });
    onDamage(({ repaired }) => tray.flash(repaired ? 'Repaired a damaged save' : "A damaged save couldn't be repaired"));
    // Build the panel now, hidden, so the first click on the icon shows it at once.
    prepareWindow('panel');
    core.onChanged(() => broadcast('jobs:changed'));
    const tidy = new TidyFlow(core, () => tray.bounds(), () => tray.wink());
    // Tidy all (the panel's button, ⌃⇧S or the toast): the panel steps aside at once so you can watch it
    // go, and the menu bar says it's working until it's done. A second press while it runs does nothing.
    // A four-finger double tap on the trackpad does what the Tidy all shortcut does (when it's on in Settings).
    const gestures = new GestureWatcher(helperPath(), () => void tidyAllNow());
    app.on('will-quit', () => gestures.stop());
    // Which kind (keep the tab you're on, or close everything) is your last choice unless one is given.
    tidyAllNow = (keep?: TidyKeep, desk?: { keep: string[] }) => {
      getWindow('panel')?.hide();
      if (tidy.tidyingAll) return tidy.tidyingAll;
      if (keep && keep !== settings.get().tidyKeep) void settings.update({ tidyKeep: keep }).catch(() => undefined);
      tray.status('Tidying…');
      return tidy.tidyAll((keep ?? settings.get().tidyKeep) === 'front', desk).finally(() => tray.status(null));
    };
    // Automatic saving: moving on from a folder, the Mac sleeping, locking or shutting down, walking away.
    const auto = new AutoSaver({
      settings: () => settings.get(),
      memory: () => core.memory,
      rules: RULES,
      lookNow: () => core.lookAtOpen(),
      frontFolder: (l) => core.frontFolder(l),
      foldersInUse: (l) => core.foldersInUse(l),
      homeOf: (l) => core.homeOf(l),
      wouldSave: (cap, id) => core.wouldSave(cap, id),
      save: async (cap, ids) => {
        const saved = await core.autoSave(cap, ids);
        if (saved.length) tray.flash('Saved automatically');
        return saved;
      },
      remove: (jobId, entryId) => core.removeAutoSave(jobId, entryId),
      packUp: (jobId, entryId) => tidy.run(jobId, entryId).then(() => tray.wink()),
      unpack: (jobId) => core.open(jobId, undefined, 'all', beforeOpen).then(() => undefined),
      ask: (card) => tidy.ask(card),
      busy: () => !!getWindow('save')?.isVisible() || !!getWindow('panel')?.isVisible(),
    });
    powerMonitor.on('suspend', () => void auto.leaving('sleep'));
    powerMonitor.on('lock-screen', () => {
      auto.setLocked(true);
      void auto.leaving('lock');
    });
    // A moment's wait: a Mac that locks when it sleeps can say so just after it wakes.
    powerMonitor.on('resume', () => void setTimeout(() => void auto.back(), 3000));
    powerMonitor.on('unlock-screen', () => {
      auto.setLocked(false);
      void auto.back();
    });
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
      return tidy.unpackAnimation(items);
    };

    // Keeping itself up to date: only the real app (a test copy has nothing to replace).
    const updater = app.isPackaged
      ? new Updater({
          current: app.getVersion(),
          appPath: path.resolve(process.execPath, '..', '..', '..'),
          dir,
          arch: process.arch,
          onChange: (s) => broadcast('update:changed', s),
        })
      : null;
    updater?.start();

    // First run: the welcome. Someone who already has folders (they used Stashd before the welcome existed) skips it.
    if (!settings.get().welcomed) {
      void core.store.list().then((jobs) => {
        if (jobs.length) void settings.update({ welcomed: true });
        else showWindow('welcome');
      });
    }
    app.on('will-quit', () => void updater?.installOnExit(false));

    registerIpc(core, secrets, {
      update: {
        state: () => updater?.state ?? null,
        check: () => (updater ? updater.check(true) : Promise.resolve(null)),
        restart: () => {
          if (updater?.installOnExit(true)) app.quit();
        },
      },
      askSend: (content) => stashdAsk({ installId: () => (myId ??= installId(dir)), version: app.getVersion() }, content),
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
      holdToast: (on) => tidy.holdToast(on),
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

    gestures.set(settings.get().tidyGesture);
    settings.onChange((next, prev) => {
      if (next.tidyGesture !== prev.tidyGesture) gestures.set(next.tidyGesture);
      if (next.shortcutSave !== prev.shortcutSave || next.shortcutRecap !== prev.shortcutRecap || next.shortcutOpen !== prev.shortcutOpen || next.shortcutTidy !== prev.shortcutTidy) applyShortcuts(next);
      if (next.launchAtLogin !== prev.launchAtLogin) applyLoginItem(next);
      if (next.appearance !== prev.appearance) nativeTheme.themeSource = next.appearance;
      broadcast('settings:changed');
    });

    if (!app.isPackaged && process.env.WWI_SUGGEST_TEST) setTimeout(() => void runSuggestTest(core, process.env.WWI_SUGGEST_TEST!), 2000);
    if (!app.isPackaged && process.env.WWI_SCENARIOS) setTimeout(() => void runScenarios(core, tidy, process.env.WWI_SCENARIOS!, process.env.WWI_SCENARIO_FILES ?? ''), 3000);
    if (!app.isPackaged && process.env.WWI_LIVE_TEST) setTimeout(() => void runLiveTest(core, tidy, process.env.WWI_LIVE_TEST!), 3000);
    if (!app.isPackaged && process.env.WWI_DEMO_DESK) setTimeout(() => tidy.demoDesk(), 4000);
    if (!app.isPackaged && process.env.WWI_DEMO_UNPACK) setTimeout(() => void tidy.demoUnpack(process.env.WWI_DEMO_UNPACK!), 4000);
    if (!app.isPackaged && process.env.WWI_CAPTURE_DIR) {
      togglePanel(tray.bounds());
      setTimeout(() => openSave(), 7500);
      if (process.env.WWI_DEMO_TIDY) setTimeout(() => tidy.demo(), 1000);
      const toSettings = process.env.WWI_CAPTURE_MAIN === 'settings';
      setTimeout(() => showWindow('main', toSettings ? { onReady: (w) => w.webContents.send('main:show', 'settings') } : {}), 14_000);
    }
  });
}
