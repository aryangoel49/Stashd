// Where Was I: main process entry point.

import path from 'node:path';
import { app, globalShortcut, Menu } from 'electron';
import type { Settings } from './shared/types';
import { AutoSnapshotter } from './main/autosnap';
import { Core } from './main/core';
import { registerIpc } from './main/ipc';
import { SecretStore } from './main/secrets';
import { SettingsStore } from './main/settings';
import { SnapshotStore } from './main/store';
import { AppTray } from './main/tray';
import { broadcast, hardenWebContents, showWindow } from './main/windows';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start();
}

function start(): void {
  // Development-only test hooks: a separate data folder, and window screenshots for checking the UI.
  if (!app.isPackaged && process.env.WWI_USER_DATA) app.setPath('userData', process.env.WWI_USER_DATA);

  let core: Core;
  let tray: AppTray;
  let shortcutErrors: string[] = [];

  app.on('web-contents-created', (_e, contents) => hardenWebContents(contents));
  // Keep running in the menu bar when every window is closed.
  app.on('window-all-closed', () => undefined);
  app.on('second-instance', () => openMain());
  app.on('activate', () => openMain());
  app.on('will-quit', () => globalShortcut.unregisterAll());

  function openMain(projectId?: string): void {
    showWindow('main', (win) => {
      if (projectId) win.webContents.send('show-project', projectId);
    });
  }

  async function openRecent(): Promise<void> {
    openMain((await core.mostRecentlyActive()) ?? undefined);
  }

  function quickSave(): void {
    showWindow('quicksave');
  }

  function applyShortcuts(s: Settings): void {
    globalShortcut.unregisterAll();
    shortcutErrors = [];
    const pairs: [string, () => void][] = [
      [s.shortcutSave, quickSave],
      [s.shortcutRecap, () => void openRecent()],
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
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'editMenu' },
        { label: 'Window', submenu: [{ role: 'close' }, { role: 'minimize' }] },
      ]),
    );

    const dir = app.getPath('userData');
    const settings = new SettingsStore(dir);
    const store = new SnapshotStore(path.join(dir, 'snapshots'));
    core = new Core(settings, store, new SecretStore(dir));

    tray = new AppTray(core, {
      quickSave,
      openRecap: (id) => openMain(id),
      openMain: () => void openRecent(),
      openSettings: () => showWindow('settings'),
    });

    const auto = new AutoSnapshotter(settings, store, () => core.notifyChanged());
    core.onSnapshotsChanged(() => {
      void tray.refresh();
      broadcast('snapshots:changed');
    });

    registerIpc(core, { shortcutErrors: () => shortcutErrors, saved: () => tray.flash('Saved') });

    const initial = settings.get();
    applyShortcuts(initial);
    applyLoginItem(initial);
    auto.apply(initial.autoSnapshot);

    settings.onChange((next, prev) => {
      if (next.shortcutSave !== prev.shortcutSave || next.shortcutRecap !== prev.shortcutRecap) applyShortcuts(next);
      if (next.launchAtLogin !== prev.launchAtLogin) applyLoginItem(next);
      if (next.autoSnapshot !== prev.autoSnapshot) auto.apply(next.autoSnapshot);
      void tray.refresh();
      broadcast('settings:changed');
    });

    // First run: open the main window so there is something to see.
    if (initial.projects.length === 0) openMain();
    if (!app.isPackaged && process.env.WWI_CAPTURE_DIR) {
      void openRecent();
      showWindow('settings');
      setTimeout(() => showWindow('quicksave'), 4000);
    }
  });
}
