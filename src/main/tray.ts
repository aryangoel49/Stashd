// The menu bar icon. Left click opens the glass panel; right click shows a tiny menu.

import path from 'node:path';
import { app, Menu, nativeImage, Tray, type Rectangle } from 'electron';

function trayImage(name: string): Electron.NativeImage {
  const base = app.isPackaged ? path.join(process.resourcesPath, 'tray') : path.join(app.getAppPath(), 'assets', 'tray');
  const img = nativeImage.createFromPath(path.join(base, `${name}.png`));
  img.setTemplateImage(true);
  return img;
}

export class AppTray {
  private tray: Tray;
  private flashTimer: NodeJS.Timeout | null = null;
  private blinkTimer: NodeJS.Timeout | null = null;
  /** A happy squint for a moment, to say "got it" after a save. */
  wink: () => void = () => undefined;

  constructor(actions: { togglePanel: (anchor: Rectangle) => void; save: (mode: 'save' | 'pack') => void; openMain: () => void }) {
    const img = trayImage('trayTemplate');
    this.tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
    this.blink(img, trayImage('trayBlinkTemplate'));
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

  /** Every few seconds the folder blinks (now and then twice), like it's dozing in the menu bar. */
  private blink(open: Electron.NativeImage, closed: Electron.NativeImage): void {
    if (open.isEmpty() || closed.isEmpty()) return;
    const close = (ms: number) => {
      this.tray.setImage(closed);
      setTimeout(() => this.tray.setImage(open), ms);
    };
    const happy = trayImage('trayHappyTemplate');
    this.wink = () => {
      if (happy.isEmpty()) return close(250);
      this.tray.setImage(happy);
      setTimeout(() => this.tray.setImage(open), 900);
    };
    const next = () => {
      this.blinkTimer = setTimeout(() => {
        close(140);
        if (Math.random() < 0.25) setTimeout(() => close(120), 320);
        next();
      }, 4000 + Math.random() * 5000);
    };
    next();
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
