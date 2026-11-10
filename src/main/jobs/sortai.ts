// Smart Tidy all with Claude: what's open goes out as short ids with titles and scrubbed addresses (never
// file contents or paths, only a document's folder name), and the pieces of work come back as ids. Anything
// Claude sends that doesn't fit (unknown ids, a thing in two pieces, a piece of one) is dropped.

import path from 'node:path';
import type { Item } from '../../shared/types';
import { redactCommand, redactUrlString } from '../redact';

export interface SortRequest {
  payload: { items: Record<string, unknown>[] };
  byId: Map<string, Item>;
}

/** What Claude reads: one line per open thing, with an id. */
export function sortPayload(items: Item[]): SortRequest {
  const byId = new Map<string, Item>();
  const out = items.slice(0, 120).map((it, n) => {
    const id = `i${n + 1}`;
    byId.set(id, it);
    const line: Record<string, unknown> = { id, kind: it.kind === 'app' ? 'chat' : it.kind, title: redactCommand(it.kind === 'app' ? (it.chat?.title ?? it.label) : it.label), app: it.app };
    if (it.url) line.address = redactUrlString(it.url).slice(0, 200);
    if ((it.kind === 'doc' || it.kind === 'folder') && it.path) line.folder = path.basename(it.kind === 'folder' ? it.path : path.dirname(it.path));
    return line;
  });
  return { payload: { items: out }, byId };
}

/** Claude's pieces of work, checked: known ids only, each thing once, two or more things per piece. */
export function acceptAiSort(parsed: unknown, byId: Map<string, Item>): { name: string; items: Item[] }[] {
  const pieces = (parsed as { pieces?: unknown })?.pieces;
  if (!Array.isArray(pieces)) return [];
  const used = new Set<string>();
  const out: { name: string; items: Item[] }[] = [];
  for (const p of pieces) {
    const ids = Array.isArray(p?.items) ? (p.items as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    const items: Item[] = [];
    for (const id of ids) {
      const it = byId.get(id);
      if (!it || used.has(id)) continue;
      used.add(id);
      items.push(it);
    }
    const name = typeof p?.name === 'string' ? p.name.replace(/["“”]/g, '').trim().slice(0, 60) : '';
    if (items.length >= 2) out.push({ name: name || 'New folder', items });
  }
  return out.sort((a, b) => b.items.length - a.items.length);
}
