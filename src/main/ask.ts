// Ask Stashd: questions about your own saved work, answered by Stashd AI from what's in your folders.
//
// Stashd picks the folders the question is about on this Mac first (words and the on-device meaning model),
// then sends only those: names, titles, sites, your notes and the last brief. Never file contents or full
// addresses. Items get short ids (f1, i1, o1) so nothing else needs to leave the Mac.
// A change ("add this tab to Stashd project") comes back as a proposal; it runs only when you confirm it,
// and every change can be undone.

import { randomUUID } from 'node:crypto';
import type { AskAction, AskActionType, AskAnswer, AskProblem, AskRef, Item, Job, SaveEntry } from '../shared/types';
import { words } from './jobs/match';
import { redactCommand } from './redact';
import { siteOf } from './urls';

const MAX_FOLDERS = 6;
const MAX_ITEMS = 14;
const MAX_OPEN = 15;

export interface AskData {
  question: string;
  today: Date;
  jobs: { job: Job; latest: SaveEntry | null }[];
  open: Item[];
  front: string | null;
  week: { folder: string; moments: number; minutes: number }[];
  /** How close each folder is in meaning to the question (0 to 1), when the on-device model is ready. */
  closeness?: Map<string, number>;
}

/** How much a folder seems to be what the question is about. */
export function relevance(question: string, job: Job, latest: SaveEntry | null, closeness = 0): number {
  const q = words(question);
  if (!q.size) return closeness;
  const name = words(job.name);
  const inside = new Set([...(latest?.items ?? []).flatMap((i) => [...words(i.label)]), ...words(latest?.note ?? '')]);
  let score = 0;
  for (const w of q) {
    if (name.has(w)) score += 3;
    else if (inside.has(w)) score += 1;
  }
  return score + closeness * 4;
}

export interface Built {
  content: string;
  folders: Map<string, { job: Job; latest: SaveEntry | null }>;
  items: Map<string, { jobId: string | null; item: Item }>;
  week?: AskAnswer['week'];
}

/** What gets sent: the question, the folders that matter, what's open now and this week's time per folder. */
export function buildAsk(d: AskData): Built {
  const live = d.jobs.filter((j) => j.latest);
  const scored = live.map((j) => ({ ...j, score: relevance(d.question, j.job, j.latest, d.closeness?.get(j.job.id) ?? 0) }));
  // The folders the question is about, then the most recent ones (for "what was I doing?" without a name).
  const picked = [
    ...scored.filter((j) => j.score > 0).sort((a, b) => b.score - a.score),
    ...scored.filter((j) => j.score <= 0).sort((a, b) => (b.latest?.savedAt ?? '').localeCompare(a.latest?.savedAt ?? '')),
  ].slice(0, MAX_FOLDERS);

  const folders = new Map<string, { job: Job; latest: SaveEntry | null }>();
  const items = new Map<string, { jobId: string | null; item: Item }>();
  let n = 0;
  const folderData = picked.map((j, k) => {
    const id = `f${k + 1}`;
    folders.set(id, j);
    const list = [...(j.latest?.items ?? [])].sort((a, b) => Number(b.key === j.latest?.frontKey) - Number(a.key === j.latest?.frontKey)).slice(0, MAX_ITEMS);
    return {
      id,
      name: j.job.name,
      savedAt: j.latest?.savedAt,
      pinned: j.job.pinned || undefined,
      finished: j.job.done || undefined,
      note: j.latest?.note ? redactCommand(j.latest.note).slice(0, 400) : undefined,
      lastBrief: j.latest?.brief ? [j.latest.brief.sentence, j.latest.brief.sections?.lastOn, j.latest.brief.sections?.next].filter(Boolean).join(' ').slice(0, 400) : undefined,
      items: list.map((i) => {
        const iid = `i${++n}`;
        items.set(iid, { jobId: j.job.id, item: i });
        return { id: iid, kind: i.kind, title: i.label.slice(0, 160), site: (i.url && siteOf(i.url)) || undefined, app: i.kind === 'app' ? i.app : undefined };
      }),
    };
  });

  let o = 0;
  const openData = d.open
    .filter((i) => i.kind !== 'app')
    .sort((a, b) => Number(b.key === d.front) - Number(a.key === d.front))
    .slice(0, MAX_OPEN)
    .map((i) => {
      const id = `o${++o}`;
      items.set(id, { jobId: null, item: i });
      return { id, kind: i.kind, title: i.label.slice(0, 160), site: (i.url && siteOf(i.url)) || undefined, inFront: i.key === d.front || undefined };
    });

  const names = new Map(d.jobs.map((j) => [j.job.id, j.job.name]));
  const week = d.week
    .filter((w) => names.has(w.folder))
    .map((w) => ({ name: names.get(w.folder)!, minutes: w.minutes, saves: w.moments }))
    .slice(0, 8);

  const content = JSON.stringify({
    question: d.question.slice(0, 500),
    today: d.today.toISOString().slice(0, 10),
    weekday: d.today.toLocaleDateString('en', { weekday: 'long' }),
    folders: folderData,
    openNow: openData,
    week,
  });
  return { content, folders, items, week };
}

const ACTIONS: AskActionType[] = ['add', 'remove', 'move', 'rename', 'pin', 'unpin', 'unpack', 'done'];

/** Turns Stashd AI's answer (ids) back into real folders, items and a checked proposal. Anything that doesn't fit is dropped. */
export function readAnswer(raw: unknown, question: string, b: Built, savedLabel: (latest: SaveEntry | null) => string): AskAnswer | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { answer?: unknown; highlights?: unknown; refs?: unknown; action?: Record<string, unknown> };
  if (typeof r.answer !== 'string' || !r.answer.trim()) return null;
  const answer = r.answer.trim().slice(0, 600);
  const highlights = Array.isArray(r.highlights) ? r.highlights.filter((h): h is string => typeof h === 'string' && !!h && answer.includes(h)).slice(0, 2) : [];
  const refs: AskRef[] = [];
  for (const id of Array.isArray(r.refs) ? r.refs : []) {
    if (typeof id !== 'string' || refs.length >= 4) continue;
    const f = b.folders.get(id);
    if (f) refs.push({ kind: 'folder', jobId: f.job.id, name: f.job.name, meta: savedLabel(f.latest) });
    const it = b.items.get(id);
    if (it) refs.push({ kind: 'item', jobId: it.jobId, folder: it.jobId ? ([...b.folders.values()].find((x) => x.job.id === it.jobId)?.job.name ?? null) : null, item: it.item });
  }

  let action: AskAction | null = null;
  const a = r.action;
  const type = a?.type as AskActionType;
  const f = typeof a?.folder === 'string' ? b.folders.get(a.folder) : undefined;
  if (a && ACTIONS.includes(type) && f) {
    const base = { id: randomUUID(), type, jobId: f.job.id, folder: f.job.name };
    const it = typeof a.item === 'string' ? b.items.get(a.item) : undefined;
    const to = typeof a.to === 'string' ? b.folders.get(a.to) : undefined;
    const name = typeof a.name === 'string' ? a.name.trim().slice(0, 60) : '';
    if (type === 'add' && it) action = { ...base, item: it.item };
    else if (type === 'remove' && it && it.jobId === f.job.id) action = { ...base, item: it.item };
    else if (type === 'move' && it && it.jobId === f.job.id && to && to.job.id !== f.job.id) action = { ...base, item: it.item, toJobId: to.job.id, to: to.job.name };
    else if (type === 'rename' && name) action = { ...base, name };
    else if (['pin', 'unpin', 'unpack', 'done'].includes(type)) action = base;
  }
  // A proposal only makes sense with words to confirm; refs aren't shown for one, the card says it all.
  return { question, answer, highlights, refs: action ? [] : refs, action, week: /week|today|yesterday|monday|tuesday|wednesday|thursday|friday|worked|spent/i.test(question) ? b.week : undefined };
}

export interface AskDeps {
  /** Stashd AI is on (you agreed to it). */
  enabled: () => boolean;
  jobs: () => Promise<{ job: Job; latest: SaveEntry | null }[]>;
  /** What's open right now; null when it can't be told. */
  look: () => Promise<{ items: Item[]; front: string | null } | null>;
  week: () => { folder: string; moments: number; minutes: number }[];
  /** Meaning vectors from the on-device model (empty when it isn't ready). */
  vectors?: (texts: string[]) => Promise<Map<string, number[]> | undefined>;
  send: (content: string) => Promise<{ text: string; left?: number }>;
  savedLabel: (latest: SaveEntry | null) => string;
  now?: () => Date;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** One question, start to finish. Problems come back as words to show, never as a crash. */
export async function askStashd(question: string, d: AskDeps): Promise<AskAnswer | AskProblem> {
  if (!d.enabled()) return { problem: 'off', message: 'Ask Stashd uses Stashd AI, which is off.' };
  const jobs = await d.jobs();
  const look = await d.look().catch(() => null);
  let closeness: Map<string, number> | undefined;
  if (d.vectors) {
    const text = (j: { job: Job; latest: SaveEntry | null }) => [j.job.name, ...(j.latest?.items ?? []).slice(0, 6).map((i) => i.label)].join(' · ');
    const got = await d.vectors([question, ...jobs.map(text)]).catch(() => undefined);
    const qv = got?.get(question);
    if (got && qv) closeness = new Map(jobs.map((j) => [j.job.id, Math.max(0, cosine(qv, got.get(text(j)) ?? []))]));
  }
  const built = buildAsk({ question, today: d.now?.() ?? new Date(), jobs, open: look?.items ?? [], front: look?.front ?? null, week: d.week(), closeness });
  let reply: { text: string; left?: number };
  try {
    reply = await d.send(built.content);
  } catch (e) {
    const code = (e as { code?: string }).code;
    return { problem: code === 'limit' ? 'limit' : 'error', message: e instanceof Error ? e.message : 'Stashd AI isn’t available right now.' };
  }
  let raw: unknown = null;
  try {
    raw = JSON.parse(reply.text);
  } catch {
    // below
  }
  const answer = readAnswer(raw, question, built, d.savedLabel);
  if (!answer) return { problem: 'error', message: 'Stashd AI sent back something unexpected. Try asking another way.' };
  return reply.left != null ? { ...answer, left: reply.left } : answer;
}

/** What runs a confirmed change, and how to take it back. */
export interface FolderOps {
  addToFolder: (jobId: string, items: Item[]) => Promise<unknown>;
  removeItem: (jobId: string, key: string) => Promise<void>;
  restoreItem: (jobId: string, key: string) => Promise<void>;
  moveItem: (from: string, key: string, to: string) => Promise<void>;
  rename: (jobId: string, name: string) => Promise<void>;
  currentName: (jobId: string) => Promise<string>;
  setPinned: (jobId: string, pinned: boolean) => Promise<void>;
  setDone: (jobId: string, done: boolean) => Promise<void>;
  unpack: (jobId: string) => Promise<void>;
}

/** Runs a confirmed change. Returns the way to undo it (null when there's nothing to undo, like Unpack). */
export async function runAction(a: AskAction, ops: FolderOps): Promise<(() => Promise<void>) | null> {
  switch (a.type) {
    case 'add':
      await ops.addToFolder(a.jobId, [a.item!]);
      return () => ops.removeItem(a.jobId, a.item!.key);
    case 'remove':
      await ops.removeItem(a.jobId, a.item!.key);
      return () => ops.restoreItem(a.jobId, a.item!.key);
    case 'move':
      await ops.moveItem(a.jobId, a.item!.key, a.toJobId!);
      return () => ops.moveItem(a.toJobId!, a.item!.key, a.jobId);
    case 'rename': {
      const before = await ops.currentName(a.jobId);
      await ops.rename(a.jobId, a.name!);
      return () => ops.rename(a.jobId, before);
    }
    case 'pin':
    case 'unpin':
      await ops.setPinned(a.jobId, a.type === 'pin');
      return () => ops.setPinned(a.jobId, a.type !== 'pin');
    case 'done':
      await ops.setDone(a.jobId, true);
      return () => ops.setDone(a.jobId, false);
    case 'unpack':
      await ops.unpack(a.jobId);
      return null;
  }
}
