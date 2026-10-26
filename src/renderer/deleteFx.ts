// Deleting a folder, with a little feeling that stays in the small folder face: it flinches wide-eyed
// before the "Delete?" question and squints with relief if you cancel. On Delete it shuts its eyes,
// gives a tiny shrug, folds down to a dot and goes "poof", while its card or row just fades, fast.
// It plays on the real element (the question is asked first, the folder is removed after), with WAAPI
// on transform and opacity only, so text is never scaled or squashed. Reduce Motion: a quick fade.

import { api } from './api';

export type Reaction = 'startled' | 'relieved' | null;

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const done = (a: Animation) =>
  a.finished.then(
    () => undefined,
    () => undefined,
  );

/** Ask to delete a folder. `el` is the card or row that goes; `react` shows the folder's face. Resolves true if deleted. */
export async function deleteWithFeel(jobId: string, el: HTMLElement | null, react: (r: Reaction) => void): Promise<boolean> {
  const reduce = reduced();
  react('startled');
  if (!reduce) await wait(320);
  const yes = await api.confirmDelete(jobId).catch(() => false);
  if (!yes) {
    react('relieved');
    setTimeout(() => react(null), 900);
    return false;
  }
  if (el?.isConnected) await goodbye(el, reduce);
  return api.deleteJob(jobId).catch(() => false);
}

async function goodbye(el: HTMLElement, reduce: boolean): Promise<void> {
  const fade = (delay: number) => done(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, delay, easing: EASE_OUT, fill: 'forwards' }));
  const mark = el.querySelector<SVGSVGElement>('.folder-mark');
  if (reduce || !mark) return fade(0);

  // The folder: eyes shut (80ms), a tiny shrug, then it folds down to a dot (400ms in all).
  mark.style.transformOrigin = '50% 50%';
  mark.querySelectorAll('ellipse').forEach((eye) => {
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
  setTimeout(() => poof(mark), 300);
  // The card or row fades as the folder finishes; nothing on it is scaled.
  await Promise.all([done(fold), fade(240)]);
}

/** A few specks in the folder's colour puff out from where it was. */
function poof(mark: SVGSVGElement): void {
  const m = mark.getBoundingClientRect();
  const tint = mark.querySelector('rect')?.getAttribute('fill') ?? '#F2CD5C';
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '1000' });
  document.body.appendChild(layer);
  const specks = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const r = m.width * 0.45;
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
    return done(
      speck.animate(
        [
          { transform: 'scale(1)', opacity: 1 },
          { transform: `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r}px) scale(0.4)`, opacity: 0 },
        ],
        { duration: 260, easing: EASE_OUT, fill: 'forwards' },
      ),
    );
  });
  void Promise.all(specks).then(() => layer.remove());
}

/** The folder's face while you decide: wide-eyed at the question, a happy squint of relief on Cancel. */
export function reactionMood(r: Reaction): 'wide' | 'happy' | undefined {
  return r === 'startled' ? 'wide' : r === 'relieved' ? 'happy' : undefined;
}

/** A quick side-to-side flinch for the folder when you click Delete. */
export const FLINCH = { x: [0, -3, 3, -2, 1, 0], transition: { duration: 0.32 } };
