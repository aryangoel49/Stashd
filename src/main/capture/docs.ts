// Asks document apps which files they have open, with AppleScript. Only apps that are already
// running are asked. Only names and file paths are read, never what is inside the files.

import path from 'node:path';
import type { CollectorError, Item } from '../../shared/types';
import { run } from '../exec';
import { isPermissionError } from '../collectors/browsers';

const US = 'character id 31';
const RS = 'character id 30';

/** Office apps report "full name", which can be an old-style "Disk:Folder:File" path. */
function officeScript(bundleId: string, collection: string): string {
  return `
set out to ""
tell application id "${bundleId}"
  repeat with d in ${collection}
    set n to name of d
    set p to ""
    try
      set fn to (full name of d) as text
      if fn starts with "/" then
        set p to fn
      else if fn contains ":" then
        set p to POSIX path of fn
      end if
    end try
    set out to out & n & ${US} & p & ${RS}
  end repeat
end tell
return out`;
}

/** iWork apps report a file (or missing value for an unsaved document). */
function iworkScript(bundleId: string): string {
  return `
set out to ""
tell application id "${bundleId}"
  repeat with d in documents
    set n to name of d
    set p to ""
    try
      set p to POSIX path of ((file of d) as alias)
    end try
    set out to out & n & ${US} & p & ${RS}
  end repeat
end tell
return out`;
}

/** Preview and TextEdit report a POSIX "path" (missing value when unsaved). */
function pathScript(bundleId: string): string {
  return `
set out to ""
tell application id "${bundleId}"
  repeat with d in documents
    set n to name of d
    set p to ""
    try
      set p to (path of d) as text
    end try
    if p is "missing value" then set p to ""
    set out to out & n & ${US} & p & ${RS}
  end repeat
end tell
return out`;
}

const FINDER_SCRIPT = `
set out to ""
tell application id "com.apple.finder"
  repeat with w in Finder windows
    try
      set p to POSIX path of ((target of w) as alias)
      set out to out & (name of w) & ${US} & p & ${RS}
    end try
  end repeat
end tell
return out`;

export interface DocAdapter {
  bundleId: string;
  app: string;
  kind: 'doc' | 'folder';
  script: string;
}

export const DOC_ADAPTERS: DocAdapter[] = [
  { bundleId: 'com.microsoft.Word', app: 'Microsoft Word', kind: 'doc', script: officeScript('com.microsoft.Word', 'documents') },
  { bundleId: 'com.microsoft.Excel', app: 'Microsoft Excel', kind: 'doc', script: officeScript('com.microsoft.Excel', 'workbooks') },
  { bundleId: 'com.microsoft.Powerpoint', app: 'Microsoft PowerPoint', kind: 'doc', script: officeScript('com.microsoft.Powerpoint', 'presentations') },
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
    const [rawName, rawPath] = r.split('\x1f');
    const name = (rawName ?? '').trim();
    const p = (rawPath ?? '').trim();
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

/** "/Users/aryan/Documents/School" becomes "Documents/School". */
export function shortDir(dir: string): string {
  const parts = dir.split('/').filter(Boolean);
  if (parts[0] === 'Users' && parts.length >= 2) parts.splice(0, 2);
  return parts.slice(-2).join('/') || dir;
}

export async function collectDocs(runningBundleIds: Set<string>): Promise<{ items: Item[]; errors: CollectorError[] }> {
  const adapters = DOC_ADAPTERS.filter((a) => runningBundleIds.has(a.bundleId));
  const errors: CollectorError[] = [];
  const results = await Promise.all(
    adapters.map(async (a) => {
      try {
        const r = await run('osascript', ['-e', a.script], { timeoutMs: 6000 });
        return parseDocOutput(a, r.stdout);
      } catch (e) {
        const denied = isPermissionError(e);
        errors.push({
          collector: `docs:${a.app}`,
          message: denied
            ? `Where Was I is not allowed to see which files are open in ${a.app} yet.`
            : `Could not read open files in ${a.app}.`,
          permissionDenied: denied || undefined,
        });
        return [];
      }
    }),
  );
  return { items: results.flat(), errors };
}
