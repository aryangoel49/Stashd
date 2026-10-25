// Asks document apps which files they have open, with AppleScript. Only apps that are already
// running are asked. Only names and file paths are read, never what is inside the files.

import path from 'node:path';
import type { CollectorError, Item } from '../../shared/types';
import { run, RunError } from '../exec';
import { findDocument } from './spotlight';
import { isPermissionError } from '../collectors/browsers';

const US = 'character id 31';
const RS = 'character id 30';

/**
 * Office apps report "full name": a POSIX path, an old-style "Disk:Folder:File" path, a web address
 * for OneDrive/SharePoint files, or just "Document1" for a file that was never saved.
 * Output per document: name, POSIX path (if any), raw full name.
 * Documents are read one by one (so one odd document can't break the list), the front one first.
 * If the app won't list its documents, its window titles are used instead (marked "window").
 */
function officeScript(bundleId: string, collection: string, element: string, activeName: string): string {
  // Every variable starts with "wwi" so it can never clash with an app's own words
  // ("row" is a table row in Word and Excel, which broke an earlier version).
  return `
set wwiOut to ""
tell application id "${bundleId}"
  set wwiFront to ""
  try
    set wwiFront to name of ${activeName}
  end try
  set wwiCount to 0
  try
    set wwiCount to count of ${collection}
  end try
  repeat with wwiI from 1 to wwiCount
    try
      -- "document 1", not "item 1 of documents": Word answers the second with an empty name.
      set wwiDoc to ${element} wwiI
      set wwiName to name of wwiDoc
      set wwiPosix to ""
      set wwiFull to ""
      try
        set wwiFull to (full name of wwiDoc) as text
        if wwiFull starts with "/" then
          set wwiPosix to wwiFull
        else if wwiFull contains ":" and wwiFull does not contain "://" then
          set wwiPosix to POSIX path of wwiFull
        end if
      end try
      set wwiLine to wwiName & ${US} & wwiPosix & ${US} & wwiFull & ${RS}
      if wwiName is wwiFront then
        set wwiOut to wwiLine & wwiOut
      else
        set wwiOut to wwiOut & wwiLine
      end if
    end try
  end repeat
  if wwiOut is "" then
    try
      repeat with wwiWin in windows
        set wwiTitle to name of wwiWin
        if wwiTitle is not "" then set wwiOut to wwiOut & wwiTitle & ${US} & "" & ${US} & "window" & ${RS}
      end repeat
    end try
  end if
end tell
return wwiOut`;
}

/** iWork apps report a file (or missing value for an unsaved document). */
function iworkScript(bundleId: string): string {
  return `
set wwiOut to ""
tell application id "${bundleId}"
  repeat with wwiI from 1 to (count of documents)
    set wwiDoc to document wwiI
    set wwiName to name of wwiDoc
    set wwiPosix to ""
    try
      set wwiPosix to POSIX path of ((file of wwiDoc) as alias)
    end try
    set wwiOut to wwiOut & wwiName & ${US} & wwiPosix & ${RS}
  end repeat
end tell
return wwiOut`;
}

/** Preview and TextEdit report a POSIX "path" (missing value when unsaved). */
function pathScript(bundleId: string): string {
  return `
set wwiOut to ""
tell application id "${bundleId}"
  repeat with wwiI from 1 to (count of documents)
    set wwiDoc to document wwiI
    set wwiName to name of wwiDoc
    set wwiPosix to ""
    try
      set wwiPosix to (path of wwiDoc) as text
    end try
    if wwiPosix is "missing value" then set wwiPosix to ""
    set wwiOut to wwiOut & wwiName & ${US} & wwiPosix & ${RS}
  end repeat
end tell
return wwiOut`;
}

const FINDER_SCRIPT = `
set wwiOut to ""
tell application id "com.apple.finder"
  repeat with wwiWin in Finder windows
    try
      set wwiPosix to POSIX path of ((target of wwiWin) as alias)
      set wwiOut to wwiOut & (name of wwiWin) & ${US} & wwiPosix & ${RS}
    end try
  end repeat
end tell
return wwiOut`;

export interface DocAdapter {
  bundleId: string;
  app: string;
  kind: 'doc' | 'folder';
  script: string;
}

export const DOC_ADAPTERS: DocAdapter[] = [
  { bundleId: 'com.microsoft.Word', app: 'Microsoft Word', kind: 'doc', script: officeScript('com.microsoft.Word', 'documents', 'document', 'active document') },
  { bundleId: 'com.microsoft.Excel', app: 'Microsoft Excel', kind: 'doc', script: officeScript('com.microsoft.Excel', 'workbooks', 'workbook', 'active workbook') },
  { bundleId: 'com.microsoft.Powerpoint', app: 'Microsoft PowerPoint', kind: 'doc', script: officeScript('com.microsoft.Powerpoint', 'presentations', 'presentation', 'active presentation') },
  { bundleId: 'com.apple.iWork.Pages', app: 'Pages', kind: 'doc', script: iworkScript('com.apple.iWork.Pages') },
  { bundleId: 'com.apple.iWork.Numbers', app: 'Numbers', kind: 'doc', script: iworkScript('com.apple.iWork.Numbers') },
  { bundleId: 'com.apple.iWork.Keynote', app: 'Keynote', kind: 'doc', script: iworkScript('com.apple.iWork.Keynote') },
  { bundleId: 'com.apple.Preview', app: 'Preview', kind: 'doc', script: pathScript('com.apple.Preview') },
  { bundleId: 'com.apple.TextEdit', app: 'TextEdit', kind: 'doc', script: pathScript('com.apple.TextEdit') },
  { bundleId: 'com.apple.finder', app: 'Finder', kind: 'folder', script: FINDER_SCRIPT },
];

/** Turn the adapter's output into items. The first document is the app's front one. */
export function parseDocOutput(adapter: Pick<DocAdapter, 'app' | 'kind'>, out: string): Item[] {
  const items: Item[] = [];
  const seen = new Set<string>();
  const records = out.split('\x1e').map((r) => r.replace(/^\n+/, '')).filter((r) => r.includes('\x1f'));
  records.forEach((r, i) => {
    const [rawName, rawPath, rawFull] = r.split('\x1f');
    const name = (rawName ?? '').trim();
    const p = (rawPath ?? '').trim();
    const full = (rawFull ?? '').trim();
    if (!name && !p) return;
    if (adapter.kind === 'folder') {
      if (!p.startsWith('/')) return;
      const clean = p.length > 1 ? p.replace(/\/$/, '') : p;
      const key = `folder:${clean}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({ key, kind: 'folder', label: path.basename(clean) || clean, detail: shortDir(path.dirname(clean)), app: adapter.app, path: clean, active: i === 0 });
      return;
    }
    // A OneDrive or SharePoint file: Office gives a web address instead of a path.
    if (!p && /^https?:\/\//i.test(full)) {
      const key = `doc:${full}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({ key, kind: 'doc', label: name || decodeURIComponent(full.split('/').pop() ?? full), detail: `${adapter.app}, in OneDrive`, app: adapter.app, url: full, active: i === 0 });
      return;
    }
    // Only a window title: the app wouldn't list its documents. Found on disk later if possible.
    if (!p && full === 'window') {
      const title = name.replace(/\s+[-–—]\s+(Microsoft )?(Word|Excel|PowerPoint)$/i, '').replace(/\s*\[(Compatibility Mode|Read-Only)\]\s*/gi, ' ').trim();
      const isNew = NEW_DOC_NAMES.test(title);
      const key = isNew ? `untitled:${adapter.app}:${title}` : `window:${adapter.app}:${title}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({
        key, kind: 'doc', label: title, detail: isNew ? `${adapter.app}, not saved yet` : adapter.app, app: adapter.app,
        untitled: isNew || undefined, active: i === 0,
      });
      return;
    }
    if (!p && !NEW_DOC_NAMES.test(name.replace(/\.[a-z0-9]{2,5}$/i, ''))) {
      // A saved document whose location the app didn't give: found on disk later if possible.
      const key = `window:${adapter.app}:${name}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({ key, kind: 'doc', label: name, detail: adapter.app, app: adapter.app, active: i === 0 });
      return;
    }
    const untitled = !p.startsWith('/');
    const key = untitled ? `untitled:${adapter.app}:${name}` : `doc:${p}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      key,
      kind: 'doc',
      label: untitled ? name : path.basename(p),
      detail: untitled ? `${adapter.app}, not saved yet` : shortDir(path.dirname(p)),
      app: adapter.app,
      path: untitled ? undefined : p,
      untitled: untitled || undefined,
      active: i === 0,
    });
  });
  return items;
}

/** Default names of documents that were never saved. */
export const NEW_DOC_NAMES = /^(Document|Book|Workbook|Presentation|Untitled)\s*\d*$/i;

/** "/Users/aryan/Documents/School" becomes "Documents/School". */
export function shortDir(dir: string): string {
  const parts = dir.split('/').filter(Boolean);
  if (parts[0] === 'Users' && parts.length >= 2) parts.splice(0, 2);
  return parts.slice(-2).join('/') || dir;
}

/** Documents known only by name: look them up with Spotlight, so they can be reopened. */
async function resolveUnknownPaths(items: Item[]): Promise<Item[]> {
  return Promise.all(
    items.map(async (it) => {
      if (!it.key.startsWith('window:')) return it;
      const found = await findDocument(it.label, it.app);
      if (!found) return { ...it, detail: `${it.app}, couldn't find the file` };
      return { ...it, key: `doc:${found}`, label: path.basename(found), detail: shortDir(path.dirname(found)), path: found };
    }),
  );
}

/** A short technical reason, kept with the save to help fix problems. Never includes file contents. */
function errorDetail(e: unknown): string {
  const text = e instanceof RunError ? `${e.message} ${e.stderr}` : String(e);
  return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

export async function collectDocs(runningBundleIds: Set<string>): Promise<{ items: Item[]; errors: CollectorError[]; answered: Set<string> }> {
  const adapters = DOC_ADAPTERS.filter((a) => runningBundleIds.has(a.bundleId));
  const errors: CollectorError[] = [];
  const answered = new Set<string>();
  const results = await Promise.all(
    adapters.map(async (a) => {
      try {
        // Long timeout: the first time, macOS shows an "allow access?" pop-up and waits for you.
        const r = await run('osascript', ['-e', a.script], { timeoutMs: 60_000 });
        answered.add(a.app);
        return await resolveUnknownPaths(parseDocOutput(a, r.stdout));
      } catch (e) {
        const denied = isPermissionError(e);
        errors.push({
          collector: `docs:${a.app}`,
          message: denied
            ? `Where Was I is not allowed to see which files are open in ${a.app} yet.`
            : `Could not read open files in ${a.app}.`,
          detail: errorDetail(e),
          permissionDenied: denied || undefined,
        });
        return [];
      }
    }),
  );
  return { items: results.flat(), errors, answered };
}
