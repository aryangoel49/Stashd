// Creates the three windows (main, quick-save, settings) with locked-down security settings.

import path from 'node:path';
import { app, BrowserWindow, nativeTheme, screen } from 'electron';
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
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void win.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}#/${route}`);
  } else {
    void win.loadFile(rendererFile(), { hash: `/${route}` });
  }
}

const SIZES: Record<Route, Electron.BrowserWindowConstructorOptions> = {
  main: { width: 1040, height: 700, minWidth: 760, minHeight: 480, title: 'Where Was I' },
  settings: { width: 720, height: 760, minWidth: 560, minHeight: 480, title: 'Where Was I Settings' },
  quicksave: {
    width: 480,
    height: 236,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: 'Save where I am',
  },
};

export function showWindow(route: Route, onReady?: (win: BrowserWindow) => void): BrowserWindow {
  const existing = windows.get(route);
  if (existing && !existing.isDestroyed()) {
    if (route === 'quicksave') existing.webContents.send('quicksave:reset');
    focus(existing);
    onReady?.(existing);
    return existing;
  }

  const win = new BrowserWindow({
    ...SIZES[route],
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    vibrancy: route === 'quicksave' ? 'popover' : undefined,
    backgroundColor: route === 'quicksave' ? undefined : nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f6f5f2',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: route !== 'quicksave',
      devTools: !app.isPackaged,
    },
  });

  if (route === 'quicksave') {
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    win.setPosition(Math.round(workArea.x + (workArea.width - 480) / 2), Math.round(workArea.y + workArea.height * 0.22));
    win.on('blur', () => {
      if (!win.isDestroyed() && !win.webContents.isDevToolsOpened()) win.close();
    });
  }

  windows.set(route, win);
  win.on('closed', () => windows.delete(route));
  win.once('ready-to-show', () => {
    focus(win);
    onReady?.(win);
    if (!app.isPackaged && process.env.WWI_CAPTURE_DIR) void captureForTests(win, route);
  });
  load(win, route);
  return win;
}

async function captureForTests(win: BrowserWindow, route: Route): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  await new Promise((r) => setTimeout(r, 2500));
  if (win.isDestroyed()) return;
  const img = await win.webContents.capturePage();
  await writeFile(path.join(process.env.WWI_CAPTURE_DIR!, `${route}.png`), img.toPNG());
}

function focus(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.show();
  app.focus({ steal: true });
  win.focus();
}

export function getWindow(route: Route): BrowserWindow | undefined {
  const w = windows.get(route);
  return w && !w.isDestroyed() ? w : undefined;
}

export function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of windows.values()) if (!w.isDestroyed()) w.webContents.send(channel, ...args);
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
