// Setting up Stashd's Chrome extension (tab groups on Unpack). Chrome only lets you add it by hand:
// the extension is copied somewhere that stays put across updates, shown in Finder, and Chrome's
// extensions page is opened next to it.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app, shell } from 'electron';
import { run } from './exec';
import type { BrowserName } from '../shared/types';
import { BROWSER_APPS, isRunning } from './collectors/browsers';
import { CHROME_HELPER_ID, GROUP_BROWSERS } from './open';

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
 * Tells Chrome and Dia which program their Stashd extension may hand video progress and tab groups to: Stashd's own
 * helper (see "Chrome" in native/wwi-helper.swift), and only for that extension. Chrome's native
 * messaging, so nothing is ever opened in Chrome to read them. The installed app only: a test copy
 * would point Chrome at a helper that's about to be deleted.
 */
async function registerChromeHost(): Promise<void> {
  if (!app.isPackaged) return;
  const support = path.join(app.getPath('home'), 'Library', 'Application Support');
  // Chrome and Dia each look in their own data folder.
  for (const dir of [path.join(support, 'Google', 'Chrome', 'NativeMessagingHosts'), path.join(support, 'Dia', 'User Data', 'NativeMessagingHosts')]) await registerHostIn(dir);
}

async function registerHostIn(dir: string): Promise<void> {
  // Only for a browser that's installed (its data folder exists).
  try {
    await fs.access(path.dirname(dir));
  } catch {
    return;
  }
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

export async function setupChromeHelper(): Promise<void> {
  await copyChromeHelper();
  shell.showItemInFolder(path.join(helperDir(), 'manifest.json'));
  // The extensions page, in Chrome and in Dia (whichever are open; Chrome if neither is).
  // chrome:// pages can't be opened with `open`; the browser opens them when asked directly.
  const open = (await Promise.all(GROUP_BROWSERS.map(async (b) => ((await isRunning(b)) ? b : null)))).filter((b): b is BrowserName => !!b);
  for (const b of open.length ? open : (['chrome'] as BrowserName[])) {
    await run('osascript', ['-e', `tell application id "${BROWSER_APPS[b].bundleId}"\n  activate\n  if (count of windows) is 0 then make new window\n  tell front window to make new tab at end of tabs with properties {URL:"chrome://extensions"}\nend tell`], { timeoutMs: 15_000 }).catch(() => undefined);
  }
}
