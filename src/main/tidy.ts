// Tidy up: closes a job's tabs, documents and Finder windows after saving, and names untitled
// documents first. Every close goes through the app's own close command with "saving ask", so
// unsaved changes get the app's normal "Save changes?" prompt. Nothing is ever force-quit.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrowserName, Item } from '../shared/types';
import { BROWSER_APPS } from './collectors/browsers';
import { DOC_ADAPTERS } from './capture/docs';
import { run } from './exec';

// ---------- browser tabs ----------

// Every AppleScript variable starts with "wwi" so it can never clash with an app's own words.
const MATCH_HANDLER = `
on wwiMatches(wwiUrl, wwiTargets)
  repeat with wwiT in wwiTargets
    set wwiT to wwiT as text
    if wwiUrl is wwiT or wwiUrl starts with (wwiT & "?") or wwiUrl starts with (wwiT & "#") then return true
  end repeat
  return false
end wwiMatches`;

/** Closes tabs whose address is one of the targets (ignoring ?query and #fragment). Skips private windows. */
export function closeTabsScript(browser: BrowserName): string {
  const id = BROWSER_APPS[browser].bundleId;
  const skipPrivate =
    browser === 'chrome'
      ? `try\n        if mode of wwiWin is "incognito" then set wwiSkip to true\n      end try`
      : browser === 'arc'
        ? `try\n        if incognito of wwiWin then set wwiSkip to true\n      end try`
        : '';
  return `${MATCH_HANDLER}
on run wwiTargets
  set wwiClosed to 0
  tell application id "${id}"
    repeat with wwiWin in windows
      set wwiSkip to false
      ${skipPrivate}
      if not wwiSkip then
        try
          set wwiCount to count of tabs of wwiWin
          repeat with wwiI from wwiCount to 1 by -1
            set wwiTab to tab wwiI of wwiWin
            if my wwiMatches((URL of wwiTab) as text, wwiTargets) then
              close wwiTab
              set wwiClosed to wwiClosed + 1
            end if
          end repeat
        end try
      end if
    end repeat
  end tell
  return wwiClosed
end run`;
}

// ---------- documents ----------

type DocFamily = 'office' | 'iwork' | 'path' | 'finder';

function family(app: string): DocFamily | null {
  if (app === 'Finder') return 'finder';
  if (app.startsWith('Microsoft ')) return 'office';
  if (['Pages', 'Numbers', 'Keynote'].includes(app)) return 'iwork';
  if (['Preview', 'TextEdit'].includes(app)) return 'path';
  return null;
}

const OFFICE_COLLECTION: Record<string, string> = { 'Microsoft Word': 'documents', 'Microsoft Excel': 'workbooks', 'Microsoft PowerPoint': 'presentations' };
/** The singular element name. Office apps answer "document 1" properly but "item 1 of documents" with an empty name. */
const OFFICE_ELEMENT: Record<string, string> = { 'Microsoft Word': 'document', 'Microsoft Excel': 'workbook', 'Microsoft PowerPoint': 'presentation' };

/** Closes open documents whose file path (or file name) is one of the targets. */
export function closeDocsScript(app: string): string | null {
  const adapter = DOC_ADAPTERS.find((a) => a.app === app);
  const fam = family(app);
  if (!adapter || !fam) return null;
  const id = adapter.bundleId;
  if (fam === 'finder') {
    return `
on run wwiTargets
  set wwiClosed to 0
  tell application id "${id}"
    repeat with wwiWin in (every Finder window)
      try
        set wwiPosix to POSIX path of ((target of wwiWin) as alias)
        if wwiPosix ends with "/" and (length of wwiPosix) > 1 then set wwiPosix to text 1 thru -2 of wwiPosix
        if wwiTargets contains wwiPosix then
          close wwiWin
          set wwiClosed to wwiClosed + 1
        end if
      end try
    end repeat
  end tell
  return wwiClosed
end run`;
  }
  const collection = fam === 'office' ? OFFICE_COLLECTION[app] : 'documents';
  const element = fam === 'office' ? OFFICE_ELEMENT[app] : 'document';
  const pathOf =
    fam === 'office'
      ? `set wwiFull to (full name of wwiDoc) as text
        if wwiFull starts with "/" then
          set wwiPosix to wwiFull
        else if wwiFull contains "://" then
          set wwiPosix to wwiFull
        else if wwiFull contains ":" then
          set wwiPosix to POSIX path of wwiFull
        end if`
      : fam === 'iwork'
        ? 'set wwiPosix to POSIX path of ((file of wwiDoc) as alias)'
        : 'set wwiPosix to (path of wwiDoc) as text';
  const close = app === 'Preview' ? 'close wwiDoc' : 'close wwiDoc saving ask';
  // Office apps that won't list their documents fall back to closing the window with that name.
  const windowFallback =
    fam === 'office'
      ? `
    if wwiClosed is 0 then
      try
        repeat with wwiWin in windows
          set wwiTitle to name of wwiWin
          if wwiTargets contains wwiTitle then
            close wwiWin
            set wwiClosed to wwiClosed + 1
          end if
        end repeat
      end try
    end if`
      : '';
  return `
on run wwiTargets
  set wwiClosed to 0
  tell application id "${id}"
    set wwiCount to 0
    try
      set wwiCount to count of ${collection}
    end try
    repeat with wwiI from wwiCount to 1 by -1
      try
        set wwiDoc to ${element} wwiI
        set wwiName to ""
        try
          set wwiName to name of wwiDoc
        end try
        set wwiPosix to ""
        try
          ${pathOf}
        end try
        if wwiTargets contains wwiPosix or wwiTargets contains wwiName then
          ${close}
          set wwiClosed to wwiClosed + 1
        end if
      end try
    end repeat${windowFallback}
  end tell
  return wwiClosed
end run`;
}

// ---------- naming untitled documents ----------

const EXTENSIONS: Record<string, string> = {
  'Microsoft Word': 'docx',
  'Microsoft Excel': 'xlsx',
  'Microsoft PowerPoint': 'pptx',
  Pages: 'pages',
  Numbers: 'numbers',
  Keynote: 'key',
  TextEdit: 'rtf',
};

export function canName(item: Item): boolean {
  return item.untitled === true && item.app in EXTENSIONS;
}

/** "Climate essay – Document1" style names, made safe for a file name. */
export function suggestedFileName(jobName: string, item: Item, index: number, total: number): string {
  const base = total === 1 ? jobName : `${jobName} – ${index + 1}`;
  return cleanFileName(base) || item.label;
}

export function cleanFileName(name: string): string {
  return name.replace(/[/:\\\0]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** A path in ~/Documents that doesn't exist yet. */
export async function freePath(name: string, app: string, dir = path.join(os.homedir(), 'Documents')): Promise<string> {
  const ext = EXTENSIONS[app];
  for (let i = 1; i < 100; i++) {
    const p = path.join(dir, `${name}${i === 1 ? '' : ` ${i}`}.${ext}`);
    try {
      await fs.access(p);
    } catch {
      return p;
    }
  }
  throw new Error('Could not find a free file name');
}

/** Saves the untitled document with this name in `app` to a full path. Arguments: name, path. */
export function saveAsScript(app: string): string | null {
  const adapter = DOC_ADAPTERS.find((a) => a.app === app);
  if (!adapter || !(app in EXTENSIONS)) return null;
  const id = adapter.bundleId;
  const fam = family(app);
  const collection = fam === 'office' ? OFFICE_COLLECTION[app] : 'documents';
  const element = fam === 'office' ? OFFICE_ELEMENT[app] : 'document';
  let save: string;
  if (app === 'Microsoft Word') save = 'save as wwiDoc file name wwiHfs file format format document default';
  else if (app === 'Microsoft Excel') save = 'save workbook as wwiDoc filename wwiHfs';
  else if (app === 'Microsoft PowerPoint') save = 'save wwiDoc in wwiHfs';
  else save = 'save wwiDoc in (POSIX file wwiTargetPath)';
  return `
on run wwiArgs
  set wwiDocName to item 1 of wwiArgs
  set wwiTargetPath to item 2 of wwiArgs
  set wwiHfs to (POSIX file wwiTargetPath) as text
  tell application id "${id}"
    repeat with wwiI from 1 to (count of ${collection})
      set wwiDoc to ${element} wwiI
      if (name of wwiDoc) is wwiDocName then
        ${save}
        return "saved"
      end if
    end repeat
  end tell
  return "not found"
end run`;
}

export async function saveUntitled(item: Item, target: string): Promise<boolean> {
  const script = saveAsScript(item.app);
  if (!script) return false;
  const r = await run('osascript', ['-e', script, item.label, target], { timeoutMs: 20_000 });
  if (r.stdout.trim() !== 'saved') return false;
  // Give the app a moment to finish writing.
  for (let i = 0; i < 20; i++) {
    try {
      await fs.access(target);
      return true;
    } catch {
      await new Promise((res) => setTimeout(res, 250));
    }
  }
  return false;
}

// ---------- running a tidy ----------

export interface TidyResult {
  closed: Item[];
  failed: Item[];
}

/** Closes the given items, one AppleScript per app. Items that are still untitled are skipped. */
export async function closeItems(items: Item[]): Promise<TidyResult> {
  const result: TidyResult = { closed: [], failed: [] };
  const byApp = new Map<string, Item[]>();
  for (const it of items) {
    if (it.kind === 'app' || it.untitled) continue;
    const key = it.kind === 'tab' ? `tab:${it.browser}` : it.app;
    byApp.set(key, [...(byApp.get(key) ?? []), it]);
  }
  await Promise.all(
    [...byApp.entries()].map(async ([key, group]) => {
      const script = key.startsWith('tab:') ? closeTabsScript(key.slice(4) as BrowserName) : closeDocsScript(key);
      // Tabs and OneDrive documents are matched by address; documents also by file name.
      const targets = group
        .flatMap((i) => (i.kind === 'tab' ? [i.url] : i.kind === 'doc' ? [i.path ?? i.url, i.path ? path.basename(i.path) : i.label] : [i.path]))
        .filter((t): t is string => !!t);
      if (!script || !targets.length) {
        result.failed.push(...group);
        return;
      }
      try {
        // A long timeout: the app may be showing its "Save changes?" prompt.
        await run('osascript', ['-e', script, ...targets], { timeoutMs: 120_000 });
        result.closed.push(...group);
      } catch {
        result.failed.push(...group);
      }
    }),
  );
  return result;
}
