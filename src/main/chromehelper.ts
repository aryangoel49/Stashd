// Setting up Stashd's Chrome extension (tab groups on Unpack). Chrome only lets you add it by hand:
// the extension is copied somewhere that stays put across updates, shown in Finder, and Chrome's
// extensions page is opened next to it.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app, shell } from 'electron';
import { run } from './exec';

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
}

export async function setupChromeHelper(): Promise<void> {
  await copyChromeHelper();
  shell.showItemInFolder(path.join(helperDir(), 'manifest.json'));
  // chrome:// pages can't be opened with `open`; Chrome opens them when asked directly.
  await run('osascript', ['-e', 'tell application id "com.google.Chrome"\n  activate\n  if (count of windows) is 0 then make new window\n  tell front window to make new tab at end of tabs with properties {URL:"chrome://extensions"}\nend tell'], { timeoutMs: 15_000 }).catch(() => undefined);
}
