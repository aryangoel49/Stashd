// Deleting a folder, with a little feeling that stays in the small folder face: it flinches wide-eyed
// before the "Delete?" question and squints with relief if you cancel. On Delete it shuts its eyes,
// gives a tiny shrug, folds down to a dot and goes "poof"; the card around it just fades, fast.
// It plays on a copy laid over the page (the real card is gone by then), with WAAPI on transform
// and opacity only. Reduce Motion: no flinch, the card simply fades.

import { api } from './api';

export type Reaction = 'startled' | 'relieved' | null;

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ask to delete a folder. `el` is the card or row that goes; `react` shows the folder's face. Resolves true if deleted. */
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
  if (snap) void farewell(snap.copy, snap.rect, el, reduce);
  return true;
}

async function farewell(copy: HTMLElement, rect: DOMRect, original: HTMLElement | null, reduce: boolean): Promise<void> {
  if (original?.isConnected) original.style.opacity = '0';
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '1000' });
  Object.assign(copy.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    opacity: '1',
    transform: 'none',
  });
  layer.appendChild(copy);
  document.body.appendChild(layer);
  const done = (a: Animation) => a.finished.catch(() => undefined);
  const fadeCard = () =>
    done(
      copy.animate(
        [
          { opacity: 1, transform: 'none' },
          { opacity: 0, transform: 'scale(0.98)' },
        ],
        { duration: 200, easing: EASE_OUT, fill: 'forwards' },
      ),
    );

  const mark = copy.querySelector<SVGSVGElement>('.folder-mark');
  if (reduce || !mark) {
    await fadeCard();
    layer.remove();
    return;
  }

  // The folder: eyes shut (80ms), a tiny shrug, then it folds down to a dot (400ms in all).
  mark.style.transformOrigin = '50% 50%';
  mark.querySelectorAll('ellipse').forEach((eye) => {
    eye.style.transformBox = 'fill-box';
    eye.style.transformOrigin = '50% 70%';
    eye.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(0.06)' }], { duration: 80, easing: 'ease-in', fill: 'forwards' });
  });
  const fold = mark.animate(
    [
      { transform: 'none', opacity: 1 },
      { transform: 'translateY(-2px) scale(1.06, 0.94)', opacity: 1, offset: 0.25 },
      { transform: 'scale(0.96, 1.04)', opacity: 1, offset: 0.45 },
      { transform: 'scale(0.05)', opacity: 0 },
    ],
    { duration: 400, easing: EASE_OUT, fill: 'forwards' },
  );

  // Poof: a few specks in the folder's colour puff out from where it was.
  const m = mark.getBoundingClientRect();
  const tint = mark.querySelector('rect')?.getAttribute('fill') ?? '#F2CD5C';
  setTimeout(() => {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const speck = document.createElement('div');
      Object.assign(speck.style, {
        position: 'fixed',
        left: `${m.left + m.width / 2 - 2.5}px`,
        top: `${m.top + m.height / 2 - 2.5}px`,
        width: '5px',
        height: '5px',
        borderRadius: '50%',
        background: tint,
      });
      layer.appendChild(speck);
      const r = m.width * 0.45;
      speck.animate(
        [
          { transform: 'scale(1)', opacity: 1 },
          { transform: `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r}px) scale(0.4)`, opacity: 0 },
        ],
        { duration: 260, easing: EASE_OUT, fill: 'forwards' },
      );
    }
  }, 300);

  await done(fold);
  await fadeCard();
  layer.remove();
}

/** The folder's face while you decide: wide-eyed at the question, a happy squint of relief on Cancel. */
export function reactionMood(r: Reaction): 'wide' | 'happy' | undefined {
  return r === 'startled' ? 'wide' : r === 'relieved' ? 'happy' : undefined;
}

/** A quick side-to-side flinch for the folder when you click Delete. */
export const FLINCH = { x: [0, -3, 3, -2, 1, 0], transition: { duration: 0.32 } };
