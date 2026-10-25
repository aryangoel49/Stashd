// The menu bar icon and its menu.

import path from 'node:path';
import { app, Menu, nativeImage, Tray } from 'electron';
import type { Core } from './core';
import { timeAgo } from './recap/local';

function trayIconPath(): string {
  const base = app.isPackaged ? path.join(process.resourcesPath, 'tray') : path.join(app.getAppPath(), 'assets', 'tray');
  return path.join(base, 'trayTemplate.png');
}

export interface TrayActions {
  quickSave: () => void;
  openRecap: (projectId: string) => void;
  openMain: () => void;
  openSettings: () => void;
}

export class AppTray {
  private tray: Tray;
  private flashTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly core: Core,
    private readonly actions: TrayActions,
  ) {
    const img = nativeImage.createFromPath(trayIconPath());
    img.setTemplateImage(true);
    this.tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
    if (img.isEmpty()) this.tray.setTitle('WWI');
    this.tray.setToolTip('Where Was I');
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const s = this.core.settings.get();
    const projects = await this.core.listProjects();
    const now = Date.now();
    const recapItems: Electron.MenuItemConstructorOptions[] = projects.length
      ? projects.map((p) => ({
          label: `${p.name}   ${p.lastSnapshotAt ? timeAgo(p.lastSnapshotAt, now) : 'no snapshots yet'}`,
          enabled: p.lastSnapshotAt !== null,
          click: () => this.actions.openRecap(p.id),
        }))
      : [{ label: 'No projects yet. Add one in Settings.', enabled: false }];

    const menu = Menu.buildFromTemplate([
      { label: 'Save where I am…', accelerator: s.shortcutSave, registerAccelerator: false, click: this.actions.quickSave },
      { label: 'Where was I?', submenu: recapItems },
      { type: 'separator' },
      { label: 'Open Where Was I', accelerator: s.shortcutRecap, registerAccelerator: false, click: this.actions.openMain },
      { label: 'Settings…', accelerator: 'CommandOrControl+,', registerAccelerator: false, click: this.actions.openSettings },
      { type: 'separator' },
      { label: 'Quit Where Was I', accelerator: 'CommandOrControl+Q', click: () => app.quit() },
    ]);
    this.tray.setContextMenu(menu);
  }

  /** Briefly show a word next to the icon, like "Saved". */
  flash(text: string): void {
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.tray.setTitle(` ${text}`);
    this.flashTimer = setTimeout(() => this.tray.setTitle(''), 2500);
  }
}
