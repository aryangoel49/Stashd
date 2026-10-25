// Stashd used to be called Where Was I, and its data lived in ~/Library/Application Support/Where Was I.
// On the first launch under the new name, jobs, settings and what it learned are copied over.
// The old folder is left as it is. The Claude key is not copied: it was encrypted with the old
// app's Keychain entry, so it can't be read under the new name and has to be connected again.

import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';

export const LEGACY_NAME = 'Where Was I';
const CARRIED = ['jobs', 'settings.json', 'state.json'];

/** Copies the old app's data into `dir` if `dir` has none yet. Returns true if anything was copied. */
export function migrateLegacyData(legacyDir: string, dir: string): boolean {
  if (path.resolve(legacyDir) === path.resolve(dir) || !existsSync(legacyDir)) return false;
  if (CARRIED.some((name) => existsSync(path.join(dir, name)))) return false;
  let copied = false;
  for (const name of CARRIED) {
    const from = path.join(legacyDir, name);
    if (!existsSync(from)) continue;
    cpSync(from, path.join(dir, name), { recursive: true });
    copied = true;
  }
  return copied;
}
