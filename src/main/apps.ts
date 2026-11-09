// The apps on this Mac, for adding one to Your places on the Break page. Read from the usual app
// folders (names only, nothing is opened); kept for a minute so typing doesn't read the disk each time.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface MacApp {
  name: string;
  path: string;
}

export function appDirs(home = os.homedir()): string[] {
  return ['/Applications', '/Applications/Utilities', '/System/Applications', '/System/Applications/Utilities', path.join(home, 'Applications')];
}

let cached: { at: number; apps: MacApp[] } | null = null;

export async function listApps(dirs = appDirs()): Promise<MacApp[]> {
  if (cached && Date.now() - cached.at < 60_000) return cached.apps;
  const seen = new Map<string, MacApp>();
  for (const dir of dirs) {
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    for (const n of names) {
      if (!n.endsWith('.app') || n.startsWith('.')) continue;
      const name = n.slice(0, -4);
      if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), { name, path: path.join(dir, n) });
    }
  }
  const apps = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  cached = { at: Date.now(), apps };
  return apps;
}

/** An .app sitting directly in one of the app folders (the only kind a place may open). */
export async function isListedApp(appPath: string, dirs = appDirs()): Promise<boolean> {
  const p = path.normalize(appPath);
  if (!p.endsWith('.app') || !dirs.includes(path.dirname(p))) return false;
  return fs.stat(p).then((s) => s.isDirectory(), () => false);
}
