// Window places: matching a saved thing to its window, and fitting a saved place onto the screens you
// have now (a screen that's gone sends the window to the main screen). Pure, for tests.

import type { Frame, Item } from '../shared/types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A window as the helper reads it. */
export interface SeenWindow extends Frame {
  title: string;
}

/** Windows smaller than this are panels or toolbars, not worth putting back. */
const MIN_SIDE = 80;

/** What a document's or folder's window title contains ("Q3 budget.xlsx" -> "q3 budget"), or null for an app. */
export function titleHint(item: Item): string | null {
  if (item.kind !== 'doc' && item.kind !== 'folder') return null;
  const hint = item.label.replace(/\.[a-z0-9]{1,5}$/i, '').trim().toLowerCase();
  return hint || null;
}

/** Puts each document's, folder's and app's window place on it (tabs get theirs from the browser). */
export function attachFrames(items: Item[], windows: Record<string, SeenWindow[]>): void {
  const used = new Set<SeenWindow>();
  const usable = (app: string) => (windows[app] ?? []).filter((w) => !used.has(w) && w.w >= MIN_SIDE && w.h >= MIN_SIDE);
  // Documents first, by title, so an app item doesn't take a document's window.
  for (const it of items) {
    const hint = titleHint(it);
    if (!hint) continue;
    const w = usable(it.app).find((x) => x.title.toLowerCase().includes(hint));
    if (!w) continue;
    used.add(w);
    it.frame = frameOf(w);
  }
  for (const it of items) {
    if (it.kind !== 'app') continue;
    const w = usable(it.app)[0];
    if (!w) continue;
    used.add(w);
    it.frame = frameOf(w);
  }
}

function frameOf(w: SeenWindow): Frame {
  return { x: Math.round(w.x), y: Math.round(w.y), w: Math.round(w.w), h: Math.round(w.h), ...(w.full ? { full: true } : {}) };
}

/** "left,top,right,bottom" (how browsers say it) -> a frame, or undefined. */
export function boundsToFrame(text: string | undefined): Frame | undefined {
  const n = (text ?? '').split(',').map((s) => Number(s.trim()));
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) return undefined;
  const [l, t, r, b] = n;
  if (r - l < MIN_SIDE || b - t < MIN_SIDE) return undefined;
  return { x: l, y: t, w: r - l, h: b - t };
}

/**
 * Fits a saved place onto today's screens (usable areas, main screen first). On a screen that's still
 * there it stays put, nudged inside if it hangs off; otherwise it's centred on the main screen. Either
 * way it's never bigger than the screen.
 */
export function fitFrame(f: Frame, screens: Rect[]): Frame {
  if (!screens.length) return f;
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  const home = screens.find((s) => cx >= s.x && cx < s.x + s.w && cy >= s.y && cy < s.y + s.h);
  const s = home ?? screens[0];
  const w = Math.min(f.w, s.w);
  const h = Math.min(f.h, s.h);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const x = home ? clamp(f.x, s.x, s.x + s.w - w) : s.x + (s.w - w) / 2;
  const y = home ? clamp(f.y, s.y, s.y + s.h - h) : s.y + (s.h - h) / 2;
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), ...(f.full ? { full: true } : {}) };
}

/** A frame as browsers take it: "left,top,right,bottom". */
export const frameToBounds = (f: Frame): string => `${f.x},${f.y},${f.x + f.w},${f.y + f.h}`;
