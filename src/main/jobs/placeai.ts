// ⌃S with Claude: which piece of work is being saved, and which of the open things are part of it.
// What goes out is short ids with titles and scrubbed addresses (never file contents or paths, only a
// document's folder name), plus your folders' names, notes and a few titles from each. Only ids come back,
// and anything that doesn't fit (an unknown folder or id) is dropped.

import path from 'node:path';
import type { Item } from '../../shared/types';
import { cleanAiName } from '../brief/prompt';
import { redactCommand, redactUrlString } from '../redact';
import { matchKeys } from '../urls';

export interface PlaceFolder {
  id: string;
  name: string;
  note: string;
  items: Item[];
  /** Most of it is open right now. */
  open: boolean;
}

export interface PlaceRequest {
  payload: Record<string, unknown>;
  openById: Map<string, Item>;
  folderById: Map<string, string>;
}

export interface Placement {
  /** The folder this work belongs to, or null for a new one. */
  jobId: string | null;
  /** Keys of the open things that are part of it. */
  keys: Set<string>;
  /** A name for a new folder, when Claude gave a usable one. */
  name: string | null;
}

/** What Claude reads (`open` without bare apps: an app with nothing known inside says nothing about the work).
 *  `target`: the folder the person chose (a job id), 'new', or null to let Claude decide. */
export function placePayload(open: Item[], frontKey: string | null, folders: PlaceFolder[], target: string | null): PlaceRequest {
  const openById = new Map<string, Item>();
  const folderById = new Map<string, string>();
  const idOfFolder = new Map<string, string>();
  const holds = new Map<string, string>();
  const outFolders = folders.slice(0, 10).map((f, n) => {
    const id = `f${n + 1}`;
    folderById.set(id, f.id);
    idOfFolder.set(f.id, id);
    for (const i of f.items) for (const k of matchKeys(i)) if (!holds.has(k)) holds.set(k, id);
    const line: Record<string, unknown> = { id, name: redactCommand(f.name).slice(0, 80), has: f.items.filter((i) => i.kind !== 'app' || i.chat).slice(0, 10).map((i) => redactCommand(i.kind === 'app' ? (i.chat?.title ?? i.label) : i.label).slice(0, 120)) };
    if (f.note.trim()) line.note = redactCommand(f.note).slice(0, 200);
    if (f.open) line.open = true;
    return line;
  });
  let front: string | null = null;
  const outOpen = open.slice(0, 120).map((it, n) => {
    const id = `o${n + 1}`;
    openById.set(id, it);
    if (it.key === frontKey) front = id;
    const line: Record<string, unknown> = { id, kind: it.kind === 'app' ? 'chat' : it.kind, title: redactCommand(it.chat?.title ?? it.label).slice(0, 160), app: it.app };
    if (it.url) line.address = redactUrlString(it.url).slice(0, 200);
    if ((it.kind === 'doc' || it.kind === 'folder') && it.path) line.folder = path.basename(it.kind === 'folder' ? it.path : path.dirname(it.path));
    const inFolder = matchKeys(it).map((k) => holds.get(k)).find(Boolean);
    if (inFolder) line.in = inFolder;
    return line;
  });
  const payload: Record<string, unknown> = { front, folders: outFolders, open: outOpen };
  if (target) payload.target = target === 'new' ? 'new' : (idOfFolder.get(target) ?? null);
  return { payload, openById, folderById };
}

/** Claude's answer, checked: a folder it was shown (or new), and only ids it was shown. Null if unusable. */
export function acceptPlacement(parsed: unknown, req: PlaceRequest): Placement | null {
  const p = parsed as { folder?: unknown; items?: unknown; name?: unknown } | null;
  if (!p || typeof p.folder !== 'string' || !Array.isArray(p.items)) return null;
  const jobId = p.folder === 'new' ? null : req.folderById.get(p.folder);
  if (jobId === undefined) return null;
  const keys = new Set<string>();
  for (const id of p.items) {
    const it = typeof id === 'string' ? req.openById.get(id) : undefined;
    if (it) keys.add(it.key);
  }
  if (!keys.size) return null;
  return { jobId, keys, name: jobId ? null : cleanAiName(p.name) };
}
