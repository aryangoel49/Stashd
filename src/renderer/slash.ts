// Deleting a folder, with a little feeling: the folder flinches wide-eyed before the "Delete?" question,
// squints with relief if you cancel, and on Delete a slash cuts it in two and the halves fall apart.
// The halves are copies laid over the page (the real one is gone by then), animated with WAAPI on
// transform and opacity only. Reduce Motion: no flinch, just a fade.

import { api } from './api';

export type Reaction = 'startled' | 'relieved' | null;

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ask to delete a folder. `el` is what gets slashed; `react` shows the folder's face. Resolves true if deleted. */
export async function deleteWithFeel(jobId: string, el: HTMLElement | null, react: (r: Reaction) => void): Promise<boolean> {
  const reduce = reduced();
  react('startled');
  if (!reduce) await wait(320);
  // Copy it now, while the startled face is showing: once deleted, the real one disappears.
  const snap = el?.isConnected ? { copy: el.cloneNode(true) as HTMLElement, rect: el.getBoundingClientRect() } : null;
  // Leave out the menu that was just open over it.
  snap?.copy.querySelectorAll('.card-menu').forEach((m) => m.remove());
  const gone = await api.deleteJob(jobId).catch(() => false);
  if (!gone) {
    react('relieved');
    setTimeout(() => react(null), 900);
    return false;
  }
  react(null);
  if (snap) void slash(snap.copy, snap.rect, el, reduce);
  return true;
}

async function slash(copy: HTMLElement, rect: DOMRect, original: HTMLElement | null, reduce: boolean): Promise<void> {
  if (original?.isConnected) original.style.opacity = '0';
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '1000' });
  document.body.appendChild(layer);

  const half = (clip: string) => {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      clipPath: clip,
    });
    const c = copy.cloneNode(true) as HTMLElement;
    Object.assign(c.style, { width: `${rect.width}px`, height: `${rect.height}px`, margin: '0', opacity: '1', transform: 'none' });
    wrap.appendChild(c);
    layer.appendChild(wrap);
    return wrap;
  };

  if (reduce) {
    const whole = half('none');
    await whole.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-out', fill: 'forwards' }).finished.catch(() => undefined);
    layer.remove();
    return;
  }

  // The cut runs from 62% down the left edge to 38% down the right edge.
  const top = half('polygon(0 0, 100% 0, 100% 38%, 0 62%)');
  const bottom = half('polygon(0 62%, 100% 38%, 100% 100%, 0 100%)');
  const rise = rect.height * 0.24;
  const length = Math.hypot(rect.width, rise) + 16;
  const angle = (Math.atan2(-rise, rect.width) * 180) / Math.PI;
  const line = document.createElement('div');
  Object.assign(line.style, {
    position: 'fixed',
    left: `${rect.left - 8}px`,
    top: `${rect.top + rect.height * 0.62 - 1}px`,
    width: `${length}px`,
    height: '2px',
    borderRadius: '2px',
    // The eyes' ink in light mode; in dark mode a near-white line, so the cut shows on dark cards.
    background: window.matchMedia('(prefers-color-scheme: dark)').matches ? '#F2F2F7' : '#1C1D22',
    transformOrigin: '0 50%',
    transform: `rotate(${angle}deg) scaleX(0)`,
  });
  layer.appendChild(line);

  // 1. The slash draws across (150ms). 2. The halves part along it and fade (380ms).
  await line
    .animate([{ transform: `rotate(${angle}deg) scaleX(0)` }, { transform: `rotate(${angle}deg) scaleX(1)` }], {
      duration: 150,
      easing: EASE_OUT,
      fill: 'forwards',
    })
    .finished.catch(() => undefined);
  const part = { duration: 380, easing: EASE_OUT, fill: 'forwards' as const };
  await Promise.all([
    line.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).finished,
    top.animate(
      [
        { transform: 'none', opacity: 1 },
        { transform: 'translate(-6px, -14px) rotate(-3deg)', opacity: 0 },
      ],
      part,
    ).finished,
    bottom.animate(
      [
        { transform: 'none', opacity: 1 },
        { transform: 'translate(6px, 16px) rotate(3deg)', opacity: 0 },
      ],
      part,
    ).finished,
  ]).catch(() => undefined);
  layer.remove();
}

/** The folder's face while you decide: wide-eyed at the question, a happy squint of relief on Cancel. */
export function reactionMood(r: Reaction): 'wide' | 'happy' | undefined {
  return r === 'startled' ? 'wide' : r === 'relieved' ? 'happy' : undefined;
}

/** A quick side-to-side flinch for the folder when you click Delete. */
export const FLINCH = { x: [0, -3, 3, -2, 1, 0], transition: { duration: 0.32 } };
