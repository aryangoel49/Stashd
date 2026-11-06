// Stashd's memory: what happened, what Stashd did about it, and what it learned, in one SQLite file
// (<data>/memory.db). It stays on this Mac: this file never touches the network (tests/privacy.test.ts).
//
// Your folders stay plain files in jobs/. The memory only points at them.
//
// Tables (see PLAN.md, "Automatic stashing"):
//   moments         something happened: you saved, drifted to other work, the Mac slept, a call started…
//   snapshots       what was open at that moment (one row), and snapshot_items (one row per tab, file, app)
//   prompts         a card Stashd showed, and your answer (or that you ignored it)
//   saves           a save that came out of a moment, pointing at its file in jobs/
//   patterns        lessons worked out from the rows above (when your day ends, which sites are detours…)
//   meanings        fingerprints from the on-device model, to find "situations like this one"
//   rulebooks       each version of the rules, so we can tell which rules led to good decisions
//
// Changes to these tables are numbered steps (STEPS). On start, a file at an older step is copied first,
// then brought up to date in one transaction: if any step fails, nothing changes and the copy remains.

import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Item } from '../shared/types';

/** Each entry upgrades the file by one version. Never edit a step once it has shipped; add a new one. */
export const STEPS: string[] = [
  // 1: the first tables.
  `
  CREATE TABLE moments (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    from_folder TEXT,
    to_folder TEXT,
    minutes_working INTEGER,
    minutes_away INTEGER
  );
  CREATE INDEX moments_at ON moments(at);
  CREATE INDEX moments_kind ON moments(kind, at);

  CREATE TABLE snapshots (
    id INTEGER PRIMARY KEY,
    moment_id INTEGER NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL
  );
  CREATE INDEX snapshots_moment ON snapshots(moment_id);

  CREATE TABLE snapshot_items (
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    site TEXT,
    app TEXT,
    folder_guess TEXT,
    confidence REAL
  );
  CREATE INDEX snapshot_items_snapshot ON snapshot_items(snapshot_id);

  CREATE TABLE rulebooks (
    version INTEGER PRIMARY KEY,
    rules TEXT NOT NULL,
    fetched TEXT NOT NULL
  );

  CREATE TABLE prompts (
    id INTEGER PRIMARY KEY,
    moment_id INTEGER NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    shown_at TEXT NOT NULL,
    answer TEXT,
    seconds_to_answer INTEGER,
    rulebook_version INTEGER REFERENCES rulebooks(version)
  );
  CREATE INDEX prompts_type ON prompts(type, shown_at);

  CREATE TABLE saves (
    id INTEGER PRIMARY KEY,
    moment_id INTEGER NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
    folder TEXT NOT NULL,
    how TEXT NOT NULL CHECK (how IN ('auto', 'manual')),
    file TEXT NOT NULL,
    replaced_by INTEGER REFERENCES saves(id)
  );
  CREATE INDEX saves_folder ON saves(folder, how);

  CREATE TABLE patterns (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    value REAL NOT NULL,
    samples INTEGER NOT NULL,
    updated TEXT NOT NULL,
    UNIQUE (kind, key)
  );

  CREATE TABLE meanings (
    text_hash TEXT PRIMARY KEY,
    vector BLOB NOT NULL
  );
  `,
];

/** How long the detail of what was open is kept; the moments themselves stay a year. */
const DETAIL_DAYS = 90;
const MOMENT_DAYS = 365;

export type MomentKind = 'manual' | 'drift' | 'sleep' | 'lock' | 'shutdown' | 'away' | 'call';

export class Memory {
  private constructor(
    private readonly db: DatabaseSync,
    private readonly file: string,
  ) {}

  /**
   * Opens (or creates) <dir>/memory.db and brings it up to date. A file that can't be read is set aside as
   * memory.db.damaged-<when> (kept until "Forget my history") and a fresh one starts, because the memory must never stop Stashd.
   */
  static open(dir: string, now = new Date()): Memory {
    const file = path.join(dir, 'memory.db');
    try {
      return Memory.openFile(file, now);
    } catch {
      if (existsSync(file)) {
        const stamp = now.toISOString().replace(/[:.]/g, '-');
        for (const ext of ['', '-wal', '-shm']) if (existsSync(file + ext)) renameSync(file + ext, `${file}.damaged-${stamp}${ext}`);
      }
      return Memory.openFile(file, now);
    }
  }

  private static openFile(file: string, now: Date): Memory {
    const db = new DatabaseSync(file);
    try {
      // Only this user can read the file; set first, because its journal files copy these permissions.
      chmodSync(file, 0o600);
      // Survives crashes and power cuts mid-write; what's deleted is overwritten, not just marked free.
      db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000; PRAGMA secure_delete = ON;');
      db.prepare('SELECT count(*) FROM sqlite_master').get();
      const version = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
      if (version > STEPS.length) throw new Error('This memory is from a newer Stashd.');
      if (version < STEPS.length) {
        if (version > 0) {
          const copy = `${file}.before-v${STEPS.length}-${now.toISOString().replace(/[:.]/g, '-')}`;
          db.prepare('VACUUM INTO ?').run(copy);
        }
        db.exec('BEGIN');
        try {
          for (let v = version; v < STEPS.length; v++) db.exec(STEPS[v]);
          db.exec(`PRAGMA user_version = ${STEPS.length}`);
          db.exec('COMMIT');
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      }
      return new Memory(db, file);
    } catch (e) {
      db.close();
      throw e;
    }
  }

  version(): number {
    return Number((this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  }

  /** A save you made yourself (⌃S, Tidy up): the moment, what was in it, and which file it went to. */
  recordSave(opts: { folder: string; file: string; how: 'auto' | 'manual'; kind: MomentKind; items: Item[]; at?: Date }): void {
    const at = (opts.at ?? new Date()).toISOString();
    this.db.exec('BEGIN');
    try {
      const moment = Number(this.db.prepare('INSERT INTO moments (at, kind, to_folder) VALUES (?, ?, ?)').run(at, opts.kind, opts.folder).lastInsertRowid);
      this.snapshot(moment, opts.items, opts.folder);
      this.db.prepare('INSERT INTO saves (moment_id, folder, how, file) VALUES (?, ?, ?, ?)').run(moment, opts.folder, opts.how, opts.file);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Something happened (you moved on, the Mac slept…). Returns its id, for what follows from it. */
  moment(kind: MomentKind, opts: { from?: string | null; to?: string | null; minutesWorking?: number; items?: Item[]; at?: Date } = {}): number {
    const at = (opts.at ?? new Date()).toISOString();
    const id = Number(
      this.db.prepare('INSERT INTO moments (at, kind, from_folder, to_folder, minutes_working) VALUES (?, ?, ?, ?, ?)').run(at, kind, opts.from ?? null, opts.to ?? null, opts.minutesWorking ?? null).lastInsertRowid,
    );
    if (opts.items?.length) this.snapshot(id, opts.items, opts.from ?? null);
    return id;
  }

  /** How long you were away after a moment, once you're back. */
  away(momentId: number, minutes: number): void {
    this.db.prepare('UPDATE moments SET minutes_away = ? WHERE id = ?').run(Math.round(minutes), momentId);
  }

  /** An automatic save that came out of a moment. */
  autoSaved(momentId: number, folder: string, file: string): void {
    this.db.prepare("INSERT INTO saves (moment_id, folder, how, file) VALUES (?, ?, 'auto', ?)").run(momentId, folder, file);
  }

  /** The rule book in use (kept once per version). */
  useRules(version: number, rules: unknown): void {
    this.db.prepare('INSERT OR IGNORE INTO rulebooks (version, rules, fetched) VALUES (?, ?, ?)').run(version, JSON.stringify(rules), new Date().toISOString());
  }

  /** A card was shown. Returns its id, to note the answer. */
  prompt(momentId: number, type: string, rulesVersion: number, at = new Date()): number {
    return Number(this.db.prepare('INSERT INTO prompts (moment_id, type, shown_at, rulebook_version) VALUES (?, ?, ?, ?)').run(momentId, type, at.toISOString(), rulesVersion).lastInsertRowid);
  }

  /** What you did with a card: save, not_now, keep, remove, ignored. */
  answer(promptId: number, answer: string, seconds: number): void {
    this.db.prepare('UPDATE prompts SET answer = ?, seconds_to_answer = ? WHERE id = ?').run(answer, Math.round(seconds), promptId);
  }

  /** Your latest answers to one kind of card, newest first. */
  answers(type: string, limit = 10): string[] {
    return (this.db.prepare('SELECT answer FROM prompts WHERE type = ? AND answer IS NOT NULL ORDER BY shown_at DESC, id DESC LIMIT ?').all(type, limit) as { answer: string }[]).map((r) => r.answer);
  }

  private snapshot(momentId: number, items: Item[], folder: string | null): void {
    const snap = Number(this.db.prepare('INSERT INTO snapshots (moment_id, fingerprint) VALUES (?, ?)').run(momentId, fingerprint(items)).lastInsertRowid);
    const row = this.db.prepare('INSERT INTO snapshot_items (snapshot_id, kind, title, site, app, folder_guess, confidence) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const i of items) row.run(snap, i.kind, i.label.slice(0, 300), siteOnly(i.url), i.app, folder, folder ? 1 : null);
  }

  /** When this kind of card was last shown, if ever. */
  lastShown(type: string): string | null {
    const r = this.db.prepare('SELECT max(shown_at) AS at FROM prompts WHERE type = ?').get(type) as { at: string | null };
    return r.at;
  }

  /** The latest moment of this kind you haven't come back from yet (a shutdown before this start), with its saves. */
  unanswered(kind: MomentKind, since: Date): { id: number; at: string; saves: { folder: string; file: string }[] } | null {
    const m = this.db.prepare('SELECT id, at FROM moments WHERE kind = ? AND minutes_away IS NULL AND at >= ? ORDER BY at DESC LIMIT 1').get(kind, since.toISOString()) as { id: number; at: string } | undefined;
    if (!m) return null;
    const saves = this.db.prepare("SELECT folder, file FROM saves WHERE moment_id = ? AND how = 'auto'").all(m.id) as { folder: string; file: string }[];
    return { id: Number(m.id), at: m.at, saves };
  }

  /** How much is remembered, for Settings. */
  counts(): { moments: number; since: string | null } {
    const r = this.db.prepare('SELECT count(*) AS n, min(at) AS first FROM moments').get() as { n: number; first: string | null };
    return { moments: Number(r.n), since: r.first };
  }

  /** Old detail goes first (what was open, after 90 days), then old moments (after a year). */
  prune(now = new Date()): void {
    const days = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
    this.db.prepare('DELETE FROM snapshots WHERE moment_id IN (SELECT id FROM moments WHERE at < ?)').run(days(DETAIL_DAYS));
    this.db.prepare('DELETE FROM moments WHERE at < ?').run(days(MOMENT_DAYS));
  }

  /** "Forget my history": everything Stashd learned goes. Your folders don't. */
  forget(): void {
    this.db.exec('BEGIN');
    try {
      for (const t of ['snapshot_items', 'snapshots', 'prompts', 'saves', 'moments', 'patterns', 'meanings']) this.db.exec(`DELETE FROM ${t}`);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    this.db.exec('VACUUM');
    this.clearJournal();
    // Copies made before an upgrade, or set aside as damaged, hold the same titles.
    const dir = path.dirname(this.file);
    const name = path.basename(this.file);
    for (const f of readdirSync(dir)) if (f.startsWith(`${name}.damaged-`) || f.startsWith(`${name}.before-`)) rmSync(path.join(dir, f), { force: true });
  }

  /** A folder you deleted: what the memory held about it goes too. */
  forgetFolder(folder: string): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM snapshot_items WHERE folder_guess = ?').run(folder);
      this.db.prepare('DELETE FROM saves WHERE folder = ?').run(folder);
      this.db.prepare('DELETE FROM moments WHERE from_folder = ? OR to_folder = ?').run(folder, folder);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    this.clearJournal();
  }

  /** The journal keeps old pages until they're moved into the file: empty it, so what's gone is gone. */
  private clearJournal(): void {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }

  /** For tests and for checking what's stored. */
  rows(table: string): Record<string, unknown>[] {
    if (!/^[a-z_]+$/.test(table)) throw new Error('bad table');
    return this.db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
  }

  close(): void {
    this.db.close();
  }
}

/** Only the site (github.com), never the full address. */
function siteOnly(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** Same things open → same fingerprint, so an unchanged moment can be skipped. */
function fingerprint(items: Item[]): string {
  return hash([...new Set(items.map((i) => i.key))].sort().join('\n'));
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36);
}
