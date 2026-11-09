// Setting up Stashd's Chrome extension (tab groups on Unpack). Chrome only lets you add it by hand:
// the extension is copied somewhere that stays put across updates, Chrome's extensions page opens, and
// a small guide beside it (Route 'chromeguide') shows the steps, lets you drag the folder straight onto
// the page, and ticks itself off once Chrome starts talking to Stashd.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app, nativeImage } from 'electron';
import { run } from './exec';
import { CHROME_HELPER_ID } from './open';

function source(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'chrome-extension') : path.join(app.getAppPath(), 'assets', 'chrome-extension');
}

/** Where Chrome loads it from: Stashd's own data folder, which an update never replaces. */
export function helperDir(): string {
  return path.join(app.getPath('userData'), 'Chrome extension');
}

/** Keep the copy Chrome loads up to date (called at startup, so updates reach it). */
export async function copyChromeHelper(): Promise<void> {
  await fs.cp(source(), helperDir(), { recursive: true, force: true });
  await registerChromeHost().catch(() => undefined);
}

/**
 * Tells Chrome which program its Stashd extension may hand video progress and tab groups to: Stashd's own
 * helper (see "Chrome" in native/wwi-helper.swift), and only for that extension. Chrome's native
 * messaging, so nothing is ever opened in Chrome to read them. The installed app only: a test copy
 * would point Chrome at a helper that's about to be deleted.
 */
async function registerChromeHost(): Promise<void> {
  if (!app.isPackaged) return;
  const dir = path.join(app.getPath('home'), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts');
  const manifest = {
    name: CHROME_HOST,
    description: 'Stashd',
    path: path.join(process.resourcesPath, 'wwi-helper'),
    type: 'stdio',
    allowed_origins: [`chrome-extension://${CHROME_HELPER_ID}/`],
  };
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${CHROME_HOST}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Chrome's name for Stashd's helper (matches HOST in assets/chrome-extension/background.js). */
const CHROME_HOST = 'com.aryangoel.stashd';

/** Opens Chrome's extensions page (chrome:// pages can't be opened with `open`; Chrome opens them when asked). */
export async function openChromeExtensions(): Promise<void> {
  await run('osascript', ['-e', 'tell application id "com.google.Chrome"\n  activate\n  if (count of windows) is 0 then make new window\n  tell front window to make new tab at end of tabs with properties {URL:"chrome://extensions"}\nend tell'], { timeoutMs: 15_000 }).catch(() => undefined);
}

/** When Chrome last handed Stashd anything through the helper (chrome.json), in ms, or 0. A freshly added
 *  helper does so within a few seconds, so this going up means it's in. */
export async function lastHeardFromChrome(): Promise<number> {
  try {
    return (await fs.stat(path.join(app.getPath('userData'), 'chrome.json'))).mtimeMs;
  } catch {
    return 0;
  }
}

/** The folder's icon, to drag it from the guide onto Chrome. */
export async function helperDragIcon(): Promise<Electron.NativeImage> {
  const icon = await app.getFileIcon(helperDir(), { size: 'normal' }).catch(() => nativeImage.createEmpty());
  return icon.isEmpty() ? nativeImage.createFromPath(path.join(source(), 'icon.png')).resize({ width: 32 }) : icon;
}
