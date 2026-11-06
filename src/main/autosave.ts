// Automatic saving: Stashd saves your work at moments that already happen, so you don't have to remember ⌃S.
//
//   You move on from a folder (drift)   you're here, so it asks: "You've moved on from X. Save it?"
//                                        Ignoring it saves (saving never closes anything); "Not now" doesn't.
//   The Mac sleeps or locks, you walk   you're gone, so it saves first, and asks when you're back:
//   away                                 "Saved X before your Mac slept" · Remove (leaving it keeps it).
//   Shutdown or restart                  saves first; after the restart: "Saved X before your Mac shut down"
//                                        · Bring it back.
//
// Every moment, card and answer goes into Stashd's memory (memory.ts). Each kind of card adapts to you:
// ignored most of the time, it goes quiet (the saving goes on); "Not now" to nearly every drift card, Stashd
// stops asking about drift and stops saving on it. A week later it tries once more. The numbers are in rules.ts.

import type { Capture, Job, Settings } from '../shared/types';
import type { OpenLook } from './core';
import type { Memory, MomentKind } from './memory';
import type { Rules } from './rules';

export type Answer = 'act' | 'dismiss' | 'timeout' | 'replaced';
type Leave = 'sleep' | 'lock' | 'away' | 'shutdown';

/** Where your attention is, from look to look. */
export interface Track {
  /** The folder you're working on, if any. */
  focus: string | null;
  /** How long you've been on it (ms). */
  worked: number;
  /** When you started being on something else, if you are. */
  leftAt: number | null;
  last: number | null;
}

export const START: Track = { focus: null, worked: 0, leftAt: null, last: null };

/**
 * One look at what's in front: a folder's id, "neutral" (nothing, or an everyday app like Mail, which doesn't
 * mean you left), or "other" (new work, a video). Returns the folder you just moved on from, if you did.
 */
export function driftStep(t: Track, front: string, now: number, r: Rules): { track: Track; drifted: string | null } {
  const dt = t.last == null ? 0 : Math.min(now - t.last, 60_000);
  let { focus, worked, leftAt } = t;
  let drifted: string | null = null;
  if (front === 'neutral') {
    // A quick look at Mail or Messages: neither working nor leaving.
  } else if (front === focus) {
    worked += dt;
    leftAt = null;
  } else if (focus && worked >= r.driftWorkedMin * 60_000) {
    leftAt ??= now;
    if (now - leftAt >= r.driftAfterMin * 60_000) {
      drifted = focus;
      focus = front === 'other' ? null : front;
      worked = 0;
      leftAt = null;
    }
  } else {
    focus = front === 'other' ? null : front;
    worked = 0;
    leftAt = null;
  }
  return { track: { focus, worked, leftAt, last: now }, drifted };
}

/** Should this kind of card show, given your latest answers to it? */
export function verdict(answers: string[], lastShown: string | null, isDrift: boolean, r: Rules, now = Date.now()): 'ask' | 'quiet' | 'stop' {
  if (answers.length < r.learnFrom) return 'ask';
  const share = (a: string) => answers.filter((x) => x === a).length / answers.length;
  const out = isDrift && share('not_now') >= r.stopWhenNotNow ? 'stop' : share('ignored') >= r.quietWhenIgnored ? 'quiet' : 'ask';
  // Gone quiet a week ago: give it one more chance, in case you've changed.
  if (out !== 'ask' && lastShown && now - Date.parse(lastShown) > 7 * 86_400_000) return 'ask';
  return out;
}

/** "Climate essay", "Climate essay and Toronto trip", "3 folders". */
export function namesOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? 'your work';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.length} folders`;
}

const LEAVE_WORDS: Record<Leave, string> = {
  sleep: 'before your Mac slept',
  lock: 'when you locked your Mac',
  away: 'while you were away',
  shutdown: 'before your Mac shut down',
};

export interface AutoDeps {
  settings: () => Settings;
  memory: () => Memory | undefined;
  rules: Rules;
  /** A fresh look at what's open (may be slow). */
  lookNow: () => Promise<OpenLook>;
  frontFolder: (look: OpenLook) => string;
  /** The folder the thing in front clearly belongs to, though it's new (a new tab on the topic); null if none. */
  homeOf: (look: OpenLook) => Promise<string | null>;
  /** Would saving this folder now change anything? No card when it wouldn't. */
  wouldSave: (cap: Capture, jobId: string) => Promise<boolean>;
  foldersInUse: (look: OpenLook) => string[];
  save: (cap: Capture, jobIds: string[]) => Promise<{ jobId: string; entryId: string; name: string }[]>;
  remove: (jobId: string, entryId: string) => Promise<void>;
  unpack: (jobId: string) => Promise<void>;
  /** Shows a card with one button; resolves with what you did. */
  ask: (card: { title: string; detail: string; action: string; seconds: number }) => Promise<Answer>;
  /** True while you're in Stashd (the save box or the panel is up): no cards then. */
  busy: () => boolean;
  now?: () => number;
}

export class AutoSaver {
  private track: Track = START;
  private lastLook: { at: number; look: OpenLook } | null = null;
  private left: { kind: Leave; at: number; momentId: number; saved: { jobId: string; entryId: string; name: string }[] } | null = null;
  private asking = false;
  private locked = false;

  constructor(private readonly d: AutoDeps) {}

  private now(): number {
    return this.d.now?.() ?? Date.now();
  }

  private on(): boolean {
    return this.d.settings().autoSave;
  }

  /** Uses the memory if it's there and working. It's a helper: nothing here may stop a save because of it. */
  private note<T>(use: (memory: Memory) => T): T | undefined {
    try {
      const memory = this.d.memory();
      return memory ? use(memory) : undefined;
    } catch {
      return undefined;
    }
  }

  /** Notes a shown card, with the rule book that decided it (kept once per version). */
  private promptRow(momentId: number, type: string): number | undefined {
    return this.note((memory) => {
      memory.useRules(this.d.rules.version, this.d.rules);
      return memory.prompt(momentId, type, this.d.rules.version);
    });
  }

  /** Every look at what's open (about every 20 seconds while you're at the Mac). */
  async look(look: OpenLook): Promise<void> {
    const now = this.now();
    this.lastLook = { at: now, look };
    if (!this.on()) return;
    let front = this.d.frontFolder(look);
    // Something new on the same work (a new tab on the topic) isn't moving on.
    if (front === 'other' && this.track.focus) front = (await this.d.homeOf(look).catch(() => null)) ?? 'other';
    const { track, drifted } = driftStep(this.track, front, now, this.d.rules);
    const minutes = Math.round(this.track.worked / 60_000);
    this.track = track;
    if (drifted) await this.drift(drifted, minutes, look);
  }

  private async drift(jobId: string, minutesWorking: number, look: OpenLook): Promise<void> {
    const name = look.jobs.find((j: Job) => j.id === jobId)?.name ?? 'your work';
    const momentId = this.note((memory) => memory.moment('drift', { from: jobId, to: this.track.focus, minutesWorking, items: look.items })) ?? 0;
    const type = 'drift_ask';
    const v = this.note((memory) => verdict(memory.answers(type), memory.lastShown(type), true, this.d.rules, this.now())) ?? 'ask';
    if (v === 'stop') return;
    const cap = (this.lastLook?.look ?? look).cap;
    // Nothing new since your last save, you packed it up yourself, or it's gone: nothing to ask about.
    if (!(await this.d.wouldSave(cap, jobId).catch(() => true))) return;
    const quiet = v === 'quiet' || this.d.settings().autoSaveTalk === 'quiet' || this.asking || this.d.busy();
    let answer: Answer = 'timeout';
    if (!quiet) {
      const promptId = this.promptRow(momentId, type);
      const shown = this.now();
      this.asking = true;
      try {
        answer = await this.d.ask({ title: `You’ve moved on from ${name}`, detail: 'Save it, so you can pick up where you left off?', action: 'Save it', seconds: this.d.rules.askSeconds });
      } finally {
        this.asking = false;
      }
      if (promptId) this.note((memory) => memory.answer(promptId, answer === 'act' ? 'save' : answer === 'dismiss' ? 'not_now' : 'ignored', (this.now() - shown) / 1000));
    }
    if (answer === 'dismiss') return;
    // Saved from what's open now: your folder's things are still open, you only moved on.
    const saved = await this.d.save(cap, [jobId]).catch(() => []);
    for (const s of saved) this.note((memory) => memory.autoSaved(momentId, s.jobId, s.entryId));
  }

  /** The Mac is about to sleep, lock or shut down, or you walked away. Saves first; asks when you're back. */
  async leaving(kind: Leave, at = this.now()): Promise<void> {
    if (!this.on()) return;
    // Not back yet (you walked away, then the Mac slept; the lid also locks the screen): what was open is
    // already saved, and that first moment is the one to tell you about. A shutdown still counts, for the restart.
    if (this.left && kind !== 'shutdown') return;
    const left: NonNullable<typeof this.left> = { kind, at, momentId: 0, saved: [] };
    this.left = left;
    const look = await this.freshLook();
    if (!look) {
      if (this.left === left) this.left = null;
      return;
    }
    const folders = [...new Set([...this.d.foldersInUse(look), ...(this.track.focus ? [this.track.focus] : [])])];
    const momentId = this.note((memory) => memory.moment(kind as MomentKind, { from: this.track.focus, minutesWorking: Math.round(this.track.worked / 60_000), items: look.items, at: new Date(at) })) ?? 0;
    left.momentId = momentId;
    const saved = folders.length ? await this.d.save(look.cap, folders).catch(() => []) : [];
    for (const s of saved) this.note((memory) => memory.autoSaved(momentId, s.jobId, s.entryId));
    // Nothing new since your last save is still worth bringing back after the restart.
    if (kind === 'shutdown') for (const id of folders) if (!saved.some((s) => s.jobId === id)) this.note((memory) => memory.autoSaved(momentId, id, 'unchanged'));
    left.saved = saved;
  }

  /** A recent look, or a quick new one; null when neither can be had (nothing is saved then). */
  private async freshLook(): Promise<OpenLook | null> {
    const fresh = this.lastLook && this.now() - this.lastLook.at < this.d.rules.freshLookMin * 60_000 ? this.lastLook.look : null;
    if (fresh) return fresh;
    const quick = await Promise.race([this.d.lookNow().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 2500))]);
    return quick ?? (this.lastLook && this.now() - this.lastLook.at < 30 * 60_000 ? this.lastLook.look : null);
  }

  /** The screen locked or unlocked. A Mac can wake long before you've typed your password. */
  setLocked(locked: boolean): void {
    this.locked = locked;
  }

  /** You're back (the Mac woke, unlocked, or you touched it after a while away). Not until it's unlocked: no one would see a card. */
  async back(): Promise<void> {
    const left = this.left;
    if (!left || this.locked) return;
    this.left = null;
    this.track = { ...this.track, last: null };
    const minutes = (this.now() - left.at) / 60_000;
    this.note((memory) => memory.away(left.momentId, minutes));
    if (!left.saved.length || minutes < this.d.rules.returnCardAfterMin || this.d.settings().autoSaveTalk === 'quiet') return;
    const type = `back_${left.kind}`;
    if ((this.note((memory) => verdict(memory.answers(type), memory.lastShown(type), false, this.d.rules, this.now())) ?? 'ask') !== 'ask') return;
    const promptId = this.promptRow(left.momentId, type);
    const shown = this.now();
    const answer = await this.d.ask({
      title: `Saved ${namesOf(left.saved.map((s) => s.name))} ${LEAVE_WORDS[left.kind]}`,
      detail: 'It’s all still open. Remove the save if you don’t need it.',
      action: 'Remove',
      seconds: this.d.rules.returnSeconds,
    });
    if (answer === 'act') for (const s of left.saved) await this.d.remove(s.jobId, s.entryId).catch(() => undefined);
    if (promptId) this.note((memory) => memory.answer(promptId, answer === 'act' ? 'remove' : answer === 'dismiss' ? 'keep' : 'ignored', (this.now() - shown) / 1000));
  }

  /** After a restart: offer to bring back what was saved before the Mac shut down. */
  async afterRestart(): Promise<void> {
    if (!this.on()) return;
    const last = this.note((memory) => memory.unanswered('shutdown', new Date(this.now() - 3 * 86_400_000)));
    if (!last) return;
    this.note((memory) => memory.away(last.id, (this.now() - Date.parse(last.at)) / 60_000));
    if (!last.saves.length || this.d.settings().autoSaveTalk === 'quiet') return;
    const type = 'back_shutdown';
    if ((this.note((memory) => verdict(memory.answers(type), memory.lastShown(type), false, this.d.rules, this.now())) ?? 'ask') !== 'ask') return;
    const look = await this.d.lookNow().catch(() => null);
    const names = last.saves.map((s) => look?.jobs.find((j) => j.id === s.folder)?.name).filter((n): n is string => !!n);
    if (!names.length) return;
    const promptId = this.promptRow(last.id, type);
    const shown = this.now();
    const answer = await this.d.ask({ title: `Saved ${namesOf(names)} ${LEAVE_WORDS.shutdown}`, detail: 'Bring it all back?', action: 'Bring it back', seconds: this.d.rules.returnSeconds * 2 });
    if (answer === 'act') for (const s of last.saves) await this.d.unpack(s.folder).catch(() => undefined);
    if (promptId) this.note((memory) => memory.answer(promptId, answer === 'act' ? 'reopen' : answer === 'dismiss' ? 'not_now' : 'ignored', (this.now() - shown) / 1000));
  }

  /** Away: no mouse or keyboard for a while counts as leaving; touching it again is coming back. */
  idle(seconds: number): void {
    const away = this.d.rules.awayAfterMin * 60;
    if (!this.left && seconds >= away) void this.leaving('away', this.now() - seconds * 1000);
    else if (this.left?.kind === 'away' && seconds < 30) void this.back();
  }
}
