// The menu bar icon. Left click opens the glass panel; right click shows a tiny menu.

import path from 'node:path';
import { app, Menu, nativeImage, Tray, type Rectangle } from 'electron';

function trayIconPath(): string {
  const base = app.isPackaged ? path.join(process.resourcesPath, 'tray') : path.join(app.getAppPath(), 'assets', 'tray');
  return path.join(base, 'trayTemplate.png');
}

export class AppTray {
  private tray: Tray;
  private flashTimer: NodeJS.Timeout | null = null;

  constructor(actions: { togglePanel: (anchor: Rectangle) => void; save: (mode: 'save' | 'pack') => void; openMain: () => void }) {
    const img = nativeImage.createFromPath(trayIconPath());
    img.setTemplateImage(true);
    this.tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
    if (img.isEmpty()) this.tray.setTitle('Stashd');
    this.tray.setToolTip('Stashd');
    this.tray.setIgnoreDoubleClickEvents(true);
    this.tray.on('click', () => actions.togglePanel(this.tray.getBounds()));
    this.tray.on('right-click', () => {
      this.tray.popUpContextMenu(
        Menu.buildFromTemplate([
          { label: 'Pack up…', click: () => actions.save('pack') },
          { label: 'Save and keep open…', click: () => actions.save('save') },
          { label: 'Open Stashd', click: actions.openMain },
          { type: 'separator' },
          { label: 'Quit Stashd', role: 'quit' },
        ]),
      );
    });
  }

  bounds(): Rectangle {
    return this.tray.getBounds();
  }

  /** Briefly show a word next to the icon, like "Saved". */
  flash(text: string): void {
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.tray.setTitle(` ${text}`);
    this.flashTimer = setTimeout(() => this.tray.setTitle(''), 2500);
  }
}
