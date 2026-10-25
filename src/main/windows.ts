// Creates the app's windows with locked-down security settings and macOS glass (vibrancy).

import path from 'node:path';
import { app, BrowserWindow, screen, type Rectangle } from 'electron';
import type { Route } from '../shared/types';

const windows = new Map<Route, BrowserWindow>();

function preloadPath(): string {
  return path.join(__dirname, 'preload.cjs');
}

function rendererFile(): string {
  return path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
}

/** True if a URL belongs to our own UI (dev server or the bundled file). */
export function isAppUrl(url: string): boolean {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) return url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  try {
    const u = new URL(url);
    return u.protocol === 'file:' && path.resolve(decodeURIComponent(u.pathname)) === path.resolve(rendererFile());
  } catch {
    return false;
  }
}

function load(win: BrowserWindow, route: Route): void {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) void win.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}#/${route}`);
  else void win.loadFile(rendererFile(), { hash: `/${route}` });
}

const WEB: Electron.WebPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  spellcheck: false,
};

/** Floating glass panels: no title bar, frosted background, rounded corners. */
const GLASS: Electron.BrowserWindowConstructorOptions = {
  frame: false,
  transparent: false,
  vibrancy: 'popover',
  visualEffectState: 'active',
  backgroundColor: '#00000000',
  roundedCorners: true,
  hasShadow: true,
  resizable: false,
  minimizable: false,
  maximizable: false,
  fullscreenable: false,
  skipTaskbar: true,
  show: false,
};

const OPTIONS: Record<Route, Electron.BrowserWindowConstructorOptions> = {
  panel: { ...GLASS, width: 360, height: 440, alwaysOnTop: true },
  save: { ...GLASS, width: 540, height: 200, alwaysOnTop: true },
  naming: { ...GLASS, width: 460, height: 220, alwaysOnTop: true },
  toast: { ...GLASS, width: 360, height: 68, alwaysOnTop: true },
  main: {
    width: 960,
    height: 640,
    minWidth: 720,
    minHeight: 460,
    title: 'Where Was I',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: 'sidebar',
    visualEffectState: 'followWindow',
    backgroundColor: '#00000000',
    show: false,
  },
  overlay: {
    frame: false,
    transparent: true,
    hasShadow: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    show: false,
    backgroundColor: '#00000000',
  },
};

/** Floating windows close when you click elsewhere, like a menu. Paused while a dialog is open. */
const holdOpen = new Set<Route>();
export function holdWindow(route: Route, hold: boolean): void {
  if (hold) holdOpen.add(route);
  else holdOpen.delete(route);
}

/** Create a window ahead of time without showing it, so it appears instantly later. */
export function prepareWindow(route: Route): BrowserWindow {
  return getWindow(route) ?? showWindow(route, { background: true });
}

export function showWindow(
  route: Route,
  opts: { onReady?: (win: BrowserWindow) => void; near?: Rectangle; background?: boolean } = {},
): BrowserWindow {
  const existing = getWindow(route);
  if (existing) {
    if (opts.near) placeUnder(existing, opts.near);
    else if (route === 'save' || route === 'naming') placeCentered(existing);
    existing.webContents.send('window:shown');
    reveal(existing, route);
    opts.onReady?.(existing);
    return existing;
  }

  const win = new BrowserWindow({ ...OPTIONS[route], webPreferences: { ...WEB, preload: preloadPath(), devTools: !app.isPackaged } });
  windows.set(route, win);
  win.on('closed', () => windows.delete(route));

  if (route === 'toast') {
    win.setAlwaysOnTop(true, 'pop-up-menu');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  if (route === 'panel' || route === 'save' || route === 'naming') {
    win.setAlwaysOnTop(true, route === 'panel' ? 'pop-up-menu' : 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.on('blur', () => {
      if (win.isDestroyed() || holdOpen.has(route) || win.webContents.isDevToolsOpened()) return;
      if (route === 'panel') win.hide();
      else if (route === 'save') win.webContents.send('window:blur');
    });
  }
  if (route === 'overlay') {
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  if (opts.near) placeUnder(win, opts.near);
  else if (route === 'save' || route === 'naming') placeCentered(win);

  if (route === 'overlay') win.setBounds(screen.getPrimaryDisplay().bounds);

  win.once('ready-to-show', () => {
    if (route !== 'overlay' && !opts.background) reveal(win, route);
    opts.onReady?.(win);
    if (!app.isPackaged && process.env.WWI_CAPTURE_DIR) void captureForTests(win, route);
  });
  load(win, route);
  return win;
}

function reveal(win: BrowserWindow, route: Route): void {
  if (win.isMinimized()) win.restore();
  if (route === 'toast') {
    win.showInactive();
    return;
  }
  win.show();
  if (route !== 'overlay') {
    app.focus({ steal: true });
    win.focus();
  }
}

function placeUnder(win: BrowserWindow, anchor: Rectangle): void {
  const { width } = win.getBounds();
  const area = screen.getDisplayMatching(anchor).workArea;
  const x = Math.round(Math.min(Math.max(anchor.x + anchor.width / 2 - width / 2, area.x + 8), area.x + area.width - width - 8));
  win.setPosition(x, Math.round(area.y + 6));
}

function placeCentered(win: BrowserWindow): void {
  const { width } = win.getBounds();
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  win.setPosition(Math.round(area.x + (area.width - width) / 2), Math.round(area.y + area.height * 0.2));
}

/** The UI asks for its window to fit its content height. */
export function fitHeight(win: BrowserWindow, height: number): void {
  const route = [...windows.entries()].find(([, w]) => w === win)?.[0];
  if (!route || route === 'main' || route === 'overlay' || route === 'toast') return;
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  // Size the inside of the window (not its outer frame), plus a little room so nothing is clipped.
  const h = Math.round(Math.min(Math.max(height + 2, 80), area.height - 40));
  const [w, current] = win.getContentSize();
  if (current !== h) win.setContentSize(w, h, false);
}

export function getWindow(route: Route): BrowserWindow | undefined {
  const w = windows.get(route);
  return w && !w.isDestroyed() ? w : undefined;
}

export function routeOf(win: BrowserWindow | null): Route | undefined {
  return [...windows.entries()].find(([, w]) => w === win)?.[0];
}

export function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of windows.values()) if (!w.isDestroyed()) w.webContents.send(channel, ...args);
}

async function captureForTests(win: BrowserWindow, route: Route): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  await new Promise((r) => setTimeout(r, route === 'overlay' ? 700 : 2500));
  if (win.isDestroyed()) return;
  // The page capture can't see the native frosted glass, so paint an approximation behind it.
  await win.webContents.executeJavaScript("document.body.classList.add('test-capture')");
  await new Promise((r) => setTimeout(r, 200));
  const shot = async (name: string) => {
    if (win.isDestroyed()) return;
    const img = await win.webContents.capturePage();
    await writeFile(path.join(process.env.WWI_CAPTURE_DIR!, `${name}.png`), img.toPNG());
  };
  await shot(route);
  // A second picture after one click, to check the next state too.
  const next: Partial<Record<Route, string>> = { save: '.summary', panel: '.job-row', main: '.side-foot .side-row' };
  if (next[route]) {
    await win.webContents.executeJavaScript(`document.querySelector('${next[route]}')?.click()`);
    await new Promise((r) => setTimeout(r, 1800));
    await shot(`${route}-2`);
  }
}

/** Applied to every web page Electron creates: no popups, no navigation away, no webviews, no permissions. */
export function hardenWebContents(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });
  contents.on('will-redirect', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });
  contents.on('will-attach-webview', (e) => e.preventDefault());
  contents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  contents.session.setPermissionCheckHandler(() => false);
}
