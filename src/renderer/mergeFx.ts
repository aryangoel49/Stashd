// The merge, played in the menu bar panel: one folder lifts off its row and arcs into the other, which
// swallows it with a bounce, a ring and a small burst in its colour, while the empty row folds away.
// Transforms and opacity only; skipped (just a fade) with Reduce Motion.

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function center(el: Element): { x: number; y: number; w: number; h: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}

/** Plays the merge between two rows (elements with data-job), and resolves when it's done. */
export async function playMerge(fromId: string, intoId: string, tone: string): Promise<void> {
  const fromRow = document.querySelector<HTMLElement>(`[data-job="${fromId}"]`);
  const intoRow = document.querySelector<HTMLElement>(`[data-job="${intoId}"]`);
  const fromMark = fromRow?.querySelector<HTMLElement>('.row-mark');
  const intoMark = intoRow?.querySelector<HTMLElement>('.row-mark');
  if (!fromRow || !intoRow || !fromMark || !intoMark) return;
  if (reduce()) {
    await fromRow.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }).finished;
    return;
  }

  // 1. The folder lifts off its row and arcs into the other one.
  const a = center(fromMark);
  const b = center(intoMark);
  const ghost = fromMark.cloneNode(true) as HTMLElement;
  Object.assign(ghost.style, { position: 'fixed', left: `${a.x - a.w / 2}px`, top: `${a.y - a.h / 2}px`, width: `${a.w}px`, height: `${a.h}px`, zIndex: '50', pointerEvents: 'none', margin: '0' });
  document.body.appendChild(ghost);
  fromMark.style.visibility = 'hidden';
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lift = Math.min(-36, -Math.abs(dy) * 0.35);
  const flight = ghost.animate(
    [
      { transform: 'translate(0, 0) scale(1) rotate(0deg)' },
      { transform: `translate(${dx * 0.12}px, ${lift * 0.6}px) scale(1.12) rotate(-8deg)`, offset: 0.22 },
      { transform: `translate(${dx * 0.6}px, ${dy * 0.5 + lift}px) scale(0.9) rotate(6deg)`, offset: 0.62 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.35) rotate(0deg)`, opacity: 0.2 },
    ],
    { duration: 620, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'forwards' },
  );

  // 2. Meanwhile its row empties and folds away.
  const h = fromRow.getBoundingClientRect().height;
  fromRow.style.overflow = 'hidden';
  const fold = fromRow.animate(
    [
      { opacity: 1, height: `${h}px` },
      { opacity: 0, height: `${h}px`, offset: 0.4 },
      { opacity: 0, height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px' },
    ],
    { duration: 560, delay: 160, easing: EASE_OUT, fill: 'forwards' },
  );

  await flight.finished;
  ghost.remove();

  // 3. The other folder swallows it: a bounce, a ring and a burst in its colour, and the row lights up.
  intoMark.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.32) rotate(-6deg)' }, { transform: 'scale(0.92) rotate(3deg)' }, { transform: 'scale(1)' }],
    { duration: 520, easing: EASE_OUT },
  );
  intoRow.animate([{ boxShadow: `inset 0 0 0 2px ${tone}` }, { boxShadow: 'inset 0 0 0 0px transparent' }], { duration: 900, easing: EASE_OUT });
  const layer = document.createElement('div');
  Object.assign(layer.style, { position: 'fixed', left: `${b.x}px`, top: `${b.y}px`, width: '0', height: '0', zIndex: '50', pointerEvents: 'none' });
  document.body.appendChild(layer);
  const ring = document.createElement('span');
  Object.assign(ring.style, { position: 'absolute', left: '-20px', top: '-20px', width: '40px', height: '40px', borderRadius: '50%', border: `2px solid ${tone}` });
  layer.appendChild(ring);
  const bursts = [ring.animate([{ transform: 'scale(0.6)', opacity: 0.9 }, { transform: 'scale(2.4)', opacity: 0 }], { duration: 560, easing: EASE_OUT, fill: 'forwards' }).finished];
  for (let i = 0; i < 12; i++) {
    const dot = document.createElement('span');
    const size = i % 3 === 0 ? 7 : 5;
    Object.assign(dot.style, { position: 'absolute', left: `${-size / 2}px`, top: `${-size / 2}px`, width: `${size}px`, height: `${size}px`, borderRadius: '50%', background: i % 4 === 0 ? '#fff' : tone });
    layer.appendChild(dot);
    const angle = (i / 12) * Math.PI * 2 + (i % 2 ? 0.2 : -0.1);
    const dist = 30 + (i % 3) * 9;
    bursts.push(
      dot.animate(
        [
          { transform: 'translate(0, 0) scale(1)', opacity: 1 },
          { transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) scale(0.2)`, opacity: 0 },
        ],
        { duration: 520 + (i % 3) * 60, easing: EASE_OUT, fill: 'forwards' },
      ).finished,
    );
  }
  await Promise.all([...bursts, fold.finished]);
  layer.remove();
}
