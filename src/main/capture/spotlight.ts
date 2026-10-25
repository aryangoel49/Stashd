// Finds a document on disk from just its name, using Spotlight (the Mac's own search index).
// Used when an app shows a document's name but won't say where the file is.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../exec';

const EXTENSIONS: Record<string, string[]> = {
  'Microsoft Word': ['docx', 'doc', 'docm', 'rtf'],
  'Microsoft Excel': ['xlsx', 'xls', 'xlsm', 'csv'],
  'Microsoft PowerPoint': ['pptx', 'ppt'],
};

function escapeQuery(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\*/g, '\\*');
}

/** Pick the best match: right file type, same name, most recently changed. Pure, for tests. */
export function pickBest(name: string, app: string, candidates: { path: string; mtimeMs: number }[]): string | null {
  const exts = EXTENSIONS[app] ?? [];
  const want = name.toLowerCase().replace(/\.[a-z0-9]{2,5}$/, '');
  const ok = candidates.filter((c) => {
    const base = path.basename(c.path).toLowerCase();
    const ext = path.extname(base).slice(1);
    return base.replace(/\.[a-z0-9]{2,5}$/, '') === want && (exts.length === 0 || exts.includes(ext)) && !base.startsWith('~$');
  });
  ok.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return ok[0]?.path ?? null;
}

export async function findDocument(name: string, app: string): Promise<string | null> {
  const stem = name.replace(/\.[a-z0-9]{2,5}$/i, '');
  if (!stem) return null;
  let out: string;
  try {
    const r = await run('mdfind', ['-onlyin', os.homedir(), `kMDItemFSName == "${escapeQuery(stem)}.*"c`], { timeoutMs: 4000 });
    out = r.stdout;
  } catch {
    return null;
  }
  const paths = out.split('\n').filter(Boolean).slice(0, 25);
  const candidates: { path: string; mtimeMs: number }[] = [];
  for (const p of paths) {
    try {
      candidates.push({ path: p, mtimeMs: (await fs.stat(p)).mtimeMs });
    } catch {
      // gone
    }
  }
  return pickBest(name, app, candidates);
}
