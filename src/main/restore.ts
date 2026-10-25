// Reopens chosen tabs and files. It only opens things; it never closes or changes anything.

import { promises as fs } from 'node:fs';
import { shell } from 'electron';
import type { BrowserName, RecapItem, RestoreResult, Snapshot } from '../shared/types';
import { BROWSER_APPS } from './collectors/browsers';
import { safeJoin } from './collectors/files';
import { run } from './exec';

const CODE_CANDIDATES = [
  '/usr/local/bin/code',
  '/opt/homebrew/bin/code',
  '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
];

export async function findVSCode(): Promise<string | null> {
  for (const c of CODE_CANDIDATES) {
    try {
      await fs.access(c);
      return c;
    } catch {
      // try the next one
    }
  }
  return null;
}

async function appInstalled(browser: BrowserName): Promise<boolean> {
  try {
    await run('open', ['-Ra', BROWSER_APPS[browser].appName], { timeoutMs: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function openUrl(url: string, browser?: BrowserName): Promise<void> {
  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only web addresses can be reopened');
  if (browser && (await appInstalled(browser))) {
    await run('open', ['-a', BROWSER_APPS[browser].appName, u.toString()], { timeoutMs: 10_000 });
  } else {
    await shell.openExternal(u.toString());
  }
}

export async function restoreItems(
  snap: Snapshot,
  items: RecapItem[],
  opts: { useVSCode: boolean },
): Promise<RestoreResult> {
  const result: RestoreResult = { opened: 0, missing: [], failed: [] };
  const code = opts.useVSCode ? await findVSCode() : null;
  const files: string[] = [];

  for (const item of items) {
    if (item.kind === 'tab') {
      try {
        await openUrl(item.target, item.browser);
        result.opened++;
      } catch {
        result.failed.push(item.label);
      }
      continue;
    }
    let full: string;
    try {
      full = safeJoin(snap.projectPath, item.target);
      await fs.access(full);
    } catch {
      result.missing.push(item.target);
      continue;
    }
    files.push(full);
  }

  if (files.length && code) {
    try {
      // Open the project folder plus the files in one VS Code window.
      await run(code, [snap.projectPath, ...files], { timeoutMs: 15_000 });
      result.opened += files.length;
      return result;
    } catch {
      // fall back to the default app for each file
    }
  }
  for (const f of files) {
    const err = await shell.openPath(f);
    if (err) result.failed.push(f);
    else result.opened++;
  }
  return result;
}
