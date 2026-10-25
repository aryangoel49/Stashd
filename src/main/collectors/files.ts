// Finds recently modified files in a project folder.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FileEntry } from '../../shared/types';

export const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out', 'DerivedData', '__pycache__', '.venv',
  '.vite', '.cache', '.turbo', '.idea', 'coverage',
]);
const IGNORED_FILES = new Set(['.DS_Store']);
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ENTRIES_VISITED = 25_000;
const MAX_DEPTH = 15;

interface WalkOptions {
  /** Only keep files modified after this time (ms since epoch). */
  since: number;
  limit: number;
}

/** Walk the folder and return the most recently modified files, newest first. */
export async function recentFiles(root: string, opts: WalkOptions): Promise<FileEntry[]> {
  const found: FileEntry[] = [];
  let visited = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || visited > MAX_ENTRIES_VISITED) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable folder, skip
    }
    for (const ent of entries) {
      if (++visited > MAX_ENTRIES_VISITED) return;
      const full = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) {
        if (!IGNORED_DIRS.has(ent.name)) await walk(full, depth + 1);
        continue;
      }
      if (!ent.isFile() || IGNORED_FILES.has(ent.name)) continue;
      let st: import('node:fs').Stats;
      try {
        st = await fs.stat(full);
      } catch {
        continue;
      }
      if (st.size > MAX_FILE_BYTES || st.mtimeMs < opts.since) continue;
      found.push({
        path: path.relative(root, full).split(path.sep).join('/'),
        mtime: new Date(st.mtimeMs).toISOString(),
        size: st.size,
      });
    }
  }

  await walk(root, 0);
  found.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return found.slice(0, opts.limit);
}

/** Time (ms) of the newest file change in the folder, or 0 if none found in the window. */
export async function newestChange(root: string, sinceMs: number): Promise<number> {
  const [top] = await recentFiles(root, { since: sinceMs, limit: 1 });
  return top ? Date.parse(top.mtime) : 0;
}

/** Which of these relative paths no longer exist under root. */
export async function missingFiles(root: string, rels: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const rel of rels) {
    try {
      await fs.access(safeJoin(root, rel));
    } catch {
      out.push(rel);
    }
  }
  return out;
}

/** Join a relative path onto root, refusing anything that escapes the folder. */
export function safeJoin(root: string, rel: string): string {
  const full = path.resolve(root, rel);
  const base = path.resolve(root);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error(`Path is outside the project: ${rel}`);
  return full;
}
