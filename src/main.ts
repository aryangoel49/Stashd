// Stashd: main process entry point.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { app, globalShortcut, Menu, nativeTheme, type Rectangle } from 'electron';
import type { AppInfo, Route, Settings } from './shared/types';
import { appleWriter } from './main/brief/apple';
import { claudeWriter, testClaudeKey } from './main/brief/claude';
import { Core } from './main/core';
import { createMeaning } from './main/meaning';
import { Helper } from './main/helper';
import { registerIpc } from './main/ipc';
import { SecretStore } from './main/secrets';
import { SettingsStore } from './main/settings';
import { LEGACY_NAME, migrateLegacyData } from './main/legacy';
import { JobStore } from './main/store';
import { TidyFlow } from './main/tidyflow';
import { runLiveTest } from './main/livetest';
import { runScenarios } from './main/scenarios';
import { runSuggestTest } from './main/suggesttest';
import { AppTray } from './main/tray';
import { broadcast, getWindow, hardenWebContents, showWindow } from './main/windows';

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
  let shortcutErrors: string[] = [];
  let appleStatus: AppInfo['appleAi'] = 'unknown';

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

  function applyShortcuts(s: Settings): void {
    globalShortcut.unregisterAll();
    shortcutErrors = [];
    const pairs: [string, () => void][] = [
      [s.shortcutSave, () => openSave()],
      [s.shortcutRecap, () => void openBrief()],
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
    const settings = new SettingsStore(dir);
    const secrets = new SecretStore(dir);
    const helper = new Helper(helperPath());
    const fake = !app.isPackaged ? process.env.WWI_FAKE_CAPTURE : undefined;
    core = new Core(settings, new JobStore(path.join(dir, 'jobs')), helper, dir, [app.getName(), 'Stashd', LEGACY_NAME, 'Electron'], fake ? async () => ({ ...JSON.parse(await readFile(fake, 'utf8')), at: new Date().toISOString() }) : undefined);
    void helper.appleStatus().then((s) => (appleStatus = s));
    core.meaning = createMeaning();
    setTimeout(() => core.meaning?.warm(), 3000);
    core.writers = [
      claudeWriter({ getKey: () => secrets.get(), getModel: () => settings.get().aiModel, allowed: () => settings.get().aiDisclosureAccepted }),
      appleWriter(helper, () => appleStatus === 'available'),
    ];

    tray = new AppTray({ togglePanel: (b) => togglePanel(b), save: openSave, openMain: () => showWindow('main') });
    core.onChanged(() => broadcast('jobs:changed'));
    const tidy = new TidyFlow(core, () => tray.bounds());

    registerIpc(core, secrets, {
      shortcutErrors: () => shortcutErrors,
      appleStatus: async () => (appleStatus = await helper.appleStatus()),
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
      overlayDone: () => tidy.finishOverlay(),
      testClaude: (key) => testClaudeKey(key, settings.get().aiModel),
      openSave,
      beforeOpen: (items) => {
        getWindow('panel')?.hide();
        tidy.unpackAnimation(items);
      },
    });

    tidy.prepare();
    const initial = settings.get();
    nativeTheme.themeSource = initial.appearance;
    applyShortcuts(initial);
    applyLoginItem(initial);

    settings.onChange((next, prev) => {
      if (next.shortcutSave !== prev.shortcutSave || next.shortcutRecap !== prev.shortcutRecap) applyShortcuts(next);
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
