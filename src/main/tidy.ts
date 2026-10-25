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

const MATCH_HANDLER = `
on matches(u, targets)
  repeat with t in targets
    set t to t as text
    if u is t or u starts with (t & "?") or u starts with (t & "#") then return true
  end repeat
  return false
end matches`;

/** Closes tabs whose address is one of the targets (ignoring ?query and #fragment). Skips private windows. */
export function closeTabsScript(browser: BrowserName): string {
  const id = BROWSER_APPS[browser].bundleId;
  const skipPrivate =
    browser === 'chrome' ? `try\n        if mode of w is "incognito" then set skip to true\n      end try` : browser === 'arc' ? `try\n        if incognito of w then set skip to true\n      end try` : '';
  const urlOf = 'URL of t';
  return `${MATCH_HANDLER}
on run targets
  set closed to 0
  tell application id "${id}"
    repeat with w in windows
      set skip to false
      ${skipPrivate}
      if not skip then
        try
          set n to count of tabs of w
          repeat with i from n to 1 by -1
            set t to tab i of w
            if my matches((${urlOf}) as text, targets) then
              close t
              set closed to closed + 1
            end if
          end repeat
        end try
      end if
    end repeat
  end tell
  return closed
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

/** Closes open documents whose file path is one of the targets. */
export function closeDocsScript(app: string): string | null {
  const adapter = DOC_ADAPTERS.find((a) => a.app === app);
  const fam = family(app);
  if (!adapter || !fam) return null;
  const id = adapter.bundleId;
  if (fam === 'finder') {
    return `
on run targets
  set closed to 0
  tell application id "${id}"
    repeat with w in (every Finder window)
      try
        set p to POSIX path of ((target of w) as alias)
        if p ends with "/" and (length of p) > 1 then set p to text 1 thru -2 of p
        if targets contains p then
          close w
          set closed to closed + 1
        end if
      end try
    end repeat
  end tell
  return closed
end run`;
  }
  const collection = fam === 'office' ? OFFICE_COLLECTION[app] : 'documents';
  const pathOf =
    fam === 'office'
      ? `set fn to (full name of d) as text
        if fn starts with "/" then
          set p to fn
        else if fn contains ":" then
          set p to POSIX path of fn
        end if`
      : fam === 'iwork'
        ? 'set p to POSIX path of ((file of d) as alias)'
        : 'set p to (path of d) as text';
  const close = app === 'Preview' ? 'close d' : 'close d saving ask';
  return `
on run targets
  set closed to 0
  tell application id "${id}"
    set n to count of ${collection}
    repeat with i from n to 1 by -1
      set d to item i of ${collection}
      set p to ""
      try
        ${pathOf}
      end try
      if targets contains p then
        try
          ${close}
          set closed to closed + 1
        end try
      end if
    end repeat
  end tell
  return closed
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

/** Saves the untitled document named `docName` in `app` to `target` (a full path). */
export function saveAsScript(app: string): string | null {
  const adapter = DOC_ADAPTERS.find((a) => a.app === app);
  if (!adapter || !(app in EXTENSIONS)) return null;
  const id = adapter.bundleId;
  const fam = family(app);
  const collection = fam === 'office' ? OFFICE_COLLECTION[app] : 'documents';
  let save: string;
  if (app === 'Microsoft Word') save = 'save as d file name hfsPath';
  else if (app === 'Microsoft Excel') save = 'save workbook as d filename hfsPath';
  else if (app === 'Microsoft PowerPoint') save = 'save d in hfsPath';
  else save = 'save d in (POSIX file target)';
  return `
on run argv
  set docName to item 1 of argv
  set target to item 2 of argv
  set hfsPath to (POSIX file target) as text
  tell application id "${id}"
    repeat with d in ${collection}
      if (name of d) is docName then
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
      const targets = group.map((i) => (i.kind === 'tab' ? i.url! : i.path!)).filter(Boolean);
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
