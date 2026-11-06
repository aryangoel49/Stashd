// Never lose a save. Two safety nets:
//   1. Before an update or a new way of storing saves touches anything, the saved data is copied to
//      <data>/backups/<when>-<from>/ (the last 5 are kept). The Claude key and browser caches stay out.
//   2. A damaged file is set aside as <file>.damaged-<when> (never overwritten) and replaced by its last good
//      copy: <file>.bak, kept by writeFileKeepingLast in store.ts, or the newest backup that has it.
// No Electron imports, so it can be tested on its own.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Raise this when saves start being stored differently: everyone's data is backed up first. */
export const STORAGE_VERSION = 1;
export const KEEP_BACKUPS = 5;

const SAVED = ['jobs', 'settings.json', 'state.json', 'break.json', 'memory.db', 'memory.db-wal', 'memory.db-shm'];
const STAMP = 'storage.json';

export const backupsDir = (dataDir: string): string => path.join(dataDir, 'backups');

const completeBackups = (root: string): string[] => {
  try {
    return readdirSync(root).filter((n) => !n.startsWith('.') && !n.endsWith('.tmp')).sort();
  } catch {
    return [];
  }
};

/** Copies the saved data into a new backup. Null if there's nothing to back up yet. */
export function backupData(dataDir: string, from: string, now = new Date()): string | null {
  const present = SAVED.filter((n) => existsSync(path.join(dataDir, n)));
  if (!present.length) return null;
  const root = backupsDir(dataDir);
  const done = path.join(root, `${now.toISOString().replace(/[:.]/g, '-')}-${from}`);
  // Copied under a temporary name first, so a crash halfway never leaves a backup that looks complete.
  const tmp = `${done}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true, mode: 0o700 });
  for (const n of present) cpSync(path.join(dataDir, n), path.join(tmp, n), { recursive: true, filter: (src) => !src.endsWith('.tmp') });
  renameSync(tmp, done);
  for (const old of completeBackups(root).slice(0, -KEEP_BACKUPS)) rmSync(path.join(root, old), { recursive: true, force: true });
  for (const n of readdirSync(root)) if (n.endsWith('.tmp')) rmSync(path.join(root, n), { recursive: true, force: true });
  return done;
}

/**
 * Run at launch, before anything is written. Backs up the first time a new version of Stashd (any version
 * might store saves differently) or a new STORAGE_VERSION runs. If the backup fails it throws, and the
 * next launch tries again.
 */
export function backupBeforeChange(dataDir: string, appVersion: string, now = new Date()): string | null {
  const file = path.join(dataDir, STAMP);
  // Never stamped, or the stamp is damaged: a backup is the safe answer.
  const stamp = readGood(file, isObject) as { storage?: unknown; app?: unknown } | undefined;
  if (stamp?.storage === STORAGE_VERSION && stamp.app === appVersion) return null;
  const made = backupData(dataDir, typeof stamp?.app === 'string' ? stamp.app : 'older', now);
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, JSON.stringify({ storage: STORAGE_VERSION, app: appVersion }), { mode: 0o600 });
  return made;
}

// ---------- damaged files ----------

export interface Damage {
  file: string;
  /** False: nothing good was left to put back. */
  repaired: boolean;
}

const damage: Damage[] = [];
let damageListener: ((d: Damage) => void) | null = null;

/** Told about each damaged file, including any found before this was called (the menu bar isn't there yet). */
export function onDamage(listener: (d: Damage) => void): void {
  damageListener = listener;
  for (const d of damage.splice(0)) listener(d);
}

export function reportDamage(file: string, repaired: boolean): void {
  console.warn(repaired ? 'Repaired a damaged file:' : 'Could not repair a damaged file:', file);
  if (damageListener) damageListener({ file, repaired });
  else damage.push({ file, repaired });
}

export const isObject = (v: unknown): boolean => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The file's contents if they're whole and pass `ok`; undefined if not. */
function readGood(file: string, ok: (v: unknown) => boolean): unknown {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return ok(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sets a damaged file aside and puts back its last good copy. Null if there is none; the caller decides what
 * then, and whether to reportDamage. `rel` is the file's path inside the data folder, as in a backup.
 */
export function recoverJson(file: string, rel: string, backups: string | undefined, ok: (v: unknown) => boolean = isObject): unknown {
  // Another reader may have just repaired it.
  const already = readGood(file, ok);
  if (already !== undefined) return already;
  if (existsSync(file)) renameSync(file, `${file}.damaged-${Date.now()}`);
  const copies = [`${file}.bak`, ...(backups ? completeBackups(backups).reverse().map((b) => path.join(backups, b, rel)) : [])];
  for (const copy of copies) {
    const value = readGood(copy, ok);
    if (value === undefined) continue;
    const tmp = `${file}.${process.pid}.restore.tmp`;
    writeFileSync(tmp, readFileSync(copy), { mode: 0o600 });
    renameSync(tmp, file);
    reportDamage(file, true);
    return value;
  }
  return null;
}

/** For files in the data folder: null on a first run (no file) or when damaged beyond repair. */
export function readJsonSafely(dataDir: string, rel: string, ok: (v: unknown) => boolean = isObject): unknown {
  const file = path.join(dataDir, rel);
  if (!existsSync(file)) return null;
  const good = readGood(file, ok);
  if (good !== undefined) return good;
  const value = recoverJson(file, rel, backupsDir(dataDir), ok);
  if (value === null) reportDamage(file, false);
  return value;
}
