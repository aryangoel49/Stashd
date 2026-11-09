// The tidy-up screens: naming untitled files, the fly-into-the-menu-bar animation, and the toast.

import { useEffect, useRef, useState } from 'react';
import type { Item, NamingRequest, OverlayPlay, ToastInfo } from '../shared/types';
import { api, useFitWindow, useSettings } from './api';
import { Button, FolderMark, motion, Motion, type Mood } from './ui';
import { ItemBadge, useMacIcon } from './visuals';
import { SiteTile } from './Break';
import { sound, type SoundName } from './sounds';

function usePayload<T>(): T | null {
  const [p, setP] = useState<T | null>(null);
  useEffect(() => {
    const load = () => void api.getPayload<T>().then(setP);
    load();
    return api.onPayload(load);
  }, []);
  return p;
}

// ---------- naming ----------

export function Naming() {
  useSettings();
  const ref = useFitWindow<HTMLFormElement>();
  const req = usePayload<NamingRequest>();
  const [names, setNames] = useState<string[]>([]);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!req) return;
    setNames(req.items.map((i) => i.suggested));
    setTimeout(() => first.current?.select(), 0);
  }, [req]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void api.finishNaming(req ? req.items.map(() => null) : []);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);

  if (!req) return <form ref={ref} className="save" />;
  const n = req.items.length;
  return (
    <form
      ref={ref}
      className="save drag"
      onSubmit={(e) => {
        e.preventDefault();
        void api.finishNaming(names.map((x) => x.trim() || null));
      }}
    >
      <div className="display" style={{ padding: '0 4px' }}>
        {n === 1 ? '1 file has no name yet' : `${n} files have no name yet`}
      </div>
      <div className="muted small" style={{ padding: '0 4px', marginTop: -6 }}>
        Name {n === 1 ? 'it' : 'them'} so {n === 1 ? 'it comes' : 'they come'} back with {req.jobName}.
      </div>
      {req.items.map((it, i) => (
        <label key={it.key} className="no-drag" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="faint tiny" style={{ padding: '0 4px' }}>
            {it.app.replace('Microsoft ', '')}: {it.label}
          </span>
          <input
            ref={i === 0 ? first : undefined}
            className="field"
            value={names[i] ?? ''}
            maxLength={120}
            onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))}
          />
        </label>
      ))}
      <div className="row no-drag">
        <span className="faint small">Saved in {req.folder}</span>
        <span style={{ display: 'inline-flex', gap: 8 }}>
          <Button onClick={() => void api.finishNaming(req.items.map(() => null))} title="Leave these windows open">
            Skip
          </Button>
          <Button variant="primary" type="submit">
            Save and pack <span style={{ opacity: 0.7 }}>↵</span>
          </Button>
        </span>
      </div>
    </form>
  );
}

// ---------- the fly-in animation ----------
// One gesture, in four beats: your apps settle into a frosted tray (one icon per app, with a count), gather
// into a stack, sweep in a curve into the menu bar icon, and land with a soft ripple. Unpacking plays it
// backwards. Only transform and opacity move, so it stays smooth while windows close behind it.

const APPEAR_MS = 220;
const HOLD_MS = 140;
const GATHER_MS = 180;
const FLY_MS = 440;
const STAGGER_MS = 28;
const TOTAL_MS = APPEAR_MS + HOLD_MS + GATHER_MS + FLY_MS;
const ICON = 60;
const GAP = 16;
const PAD = 20;

/** Wait (briefly) for icons to be decoded, so nothing pops in half-drawn. */
async function ready(imgs: HTMLImageElement[]): Promise<void> {
  await Promise.race([Promise.all(imgs.map((i) => i.decode().catch(() => undefined))), new Promise((r) => setTimeout(r, 80))]);
}

// ---------- sound ----------
/** The sound lands with the things: as they reach the menu bar, or as they leave it when unpacking. */
function playSound(play: OverlayPlay, count: number): void {
  if (!play.sound) return;
  const landing = APPEAR_MS + HOLD_MS + GATHER_MS + FLY_MS + STAGGER_MS * Math.max(0, count - 1) - 60;
  setTimeout(() => void sound(play.sound as SoundName, true), play.sound === 'unpack' ? 0 : landing);
}

const at = (ms: number) => ms / TOTAL_MS;
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)';

/** Builds one icon: outer moves sideways, middle up and down (two curves make the arc), inner scales and fades. */
function iconNode(item: OverlayPlay['items'][number], imgs: HTMLImageElement[]) {
  const x = document.createElement('div');
  x.className = 'fly';
  const y = document.createElement('div');
  y.className = 'fly-y';
  const tile = document.createElement('div');
  tile.className = 'fly-tile';
  if (item.icon) {
    const img = document.createElement('img');
    img.src = item.icon;
    img.alt = '';
    imgs.push(img);
    tile.appendChild(img);
  } else {
    tile.classList.add('plain');
    tile.textContent = (item.label[0] ?? '•').toUpperCase();
  }
  if ((item.count ?? 1) > 1) {
    const badge = document.createElement('span');
    badge.className = 'fly-count';
    badge.textContent = String(item.count);
    tile.appendChild(badge);
  }
  y.appendChild(tile);
  x.appendChild(y);
  return { x, y, tile };
}

async function playAnimation(layer: HTMLDivElement, play: OverlayPlay): Promise<void> {
  layer.innerHTML = '';
  const n = Math.max(1, play.items.length);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const imgs: HTMLImageElement[] = [];

  // The tray: just above the middle of the screen, as wide as its icons.
  const trayW = n * ICON + (n - 1) * GAP + PAD * 2;
  const trayH = ICON + PAD * 2 + 26;
  const left = play.size.width / 2 - trayW / 2;
  const top = play.size.height * 0.36 - trayH / 2;
  const tray = document.createElement('div');
  tray.className = 'fly-tray';
  Object.assign(tray.style, { left: `${left}px`, top: `${top}px`, width: `${trayW}px`, height: `${trayH}px` });
  const caption = document.createElement('span');
  caption.className = 'fly-caption';
  const total = play.total ?? play.items.reduce((s, i) => s + (i.count ?? 1), 0);
  caption.textContent = `${play.reverse ? 'Bringing back' : 'Tidying'} ${total} ${total === 1 ? 'thing' : 'things'}`;
  tray.appendChild(caption);
  layer.appendChild(tray);

  const rowY = top + PAD;
  const midX = play.size.width / 2 - ICON / 2;
  const nodes = play.items.map((item, i) => {
    const node = iconNode(item, imgs);
    layer.appendChild(node.x);
    const rowX = left + PAD + i * (ICON + GAP);
    // In the stack: a little fanned, the first icon on top.
    const spread = i - (n - 1) / 2;
    node.x.style.zIndex = String(n - i);
    // The stack dips a little before it launches (anticipation), so the flight reads as a throw.
    return { ...node, rowX, stackX: midX + spread * 7, stackY: rowY + 7 + Math.abs(spread) * 2, tilt: spread * 4 };
  });
  await ready(imgs);
  await new Promise((r) => requestAnimationFrame(r));
  if (!reduce) playSound(play, n);

  if (reduce) {
    // Reduce Motion: the tray simply appears and fades, no flying.
    const fade: Keyframe[] = [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }];
    const timing = { duration: 900, fill: 'both' as const };
    const all = [tray.animate(fade, timing).finished];
    for (const nd of nodes) {
      nd.x.style.transform = `translate3d(${nd.rowX}px, 0, 0)`;
      nd.y.style.transform = `translate3d(0, ${rowY}px, 0)`;
      all.push(nd.tile.animate(fade, timing).finished);
    }
    await Promise.all(all).catch(() => undefined);
    return;
  }

  const tx = play.target.x - ICON / 2;
  const ty = play.target.y - ICON / 2;
  const gatherAt = at(APPEAR_MS + HOLD_MS);
  const flyAt = at(APPEAR_MS + HOLD_MS + GATHER_MS);
  const flyEnd = TOTAL_MS + STAGGER_MS * (n - 1);

  const finished: Promise<unknown>[] = [];
  nodes.forEach((nd, i) => {
    const delay = i * STAGGER_MS;
    const timing: KeyframeAnimationOptions = { duration: TOTAL_MS, delay, fill: 'both' };
    // Sideways: still, then into the stack, then picking up speed towards the menu bar (and the reverse).
    // Up and down: rising early in the flight while sideways builds late, which bends the path into an arc.
    const xs: Keyframe[] = [
      { transform: `translate3d(${nd.rowX}px,0,0)` },
      { transform: `translate3d(${nd.rowX}px,0,0)`, offset: gatherAt, easing: EASE_IN_OUT },
      { transform: `translate3d(${nd.stackX}px,0,0)`, offset: flyAt, easing: 'cubic-bezier(0.5, 0, 0.75, 0.3)' },
      { transform: `translate3d(${tx}px,0,0)` },
    ];
    const ys: Keyframe[] = [
      { transform: `translate3d(0,${rowY + 10}px,0)`, easing: EASE_OUT },
      { transform: `translate3d(0,${rowY}px,0)`, offset: at(APPEAR_MS) },
      { transform: `translate3d(0,${rowY}px,0)`, offset: gatherAt, easing: EASE_IN_OUT },
      { transform: `translate3d(0,${nd.stackY}px,0)`, offset: flyAt, easing: 'cubic-bezier(0.33, 0, 0.4, 1)' },
      { transform: `translate3d(0,${ty}px,0)` },
    ];
    const looks: Keyframe[] = [
      { opacity: 0, transform: 'scale(0.86) rotate(0deg)', easing: EASE_OUT },
      { opacity: 1, transform: 'scale(1) rotate(0deg)', offset: at(APPEAR_MS) },
      { opacity: 1, transform: 'scale(1) rotate(0deg)', offset: gatherAt, easing: EASE_IN_OUT },
      { opacity: 1, transform: `scale(0.94) rotate(${nd.tilt}deg)`, offset: flyAt, easing: 'cubic-bezier(0.5, 0, 0.75, 0)' },
      { opacity: 1, transform: `scale(0.3) rotate(${nd.tilt * 2}deg)`, offset: 0.93 },
      { opacity: 0, transform: `scale(0.18) rotate(${nd.tilt * 2}deg)` },
    ];
    // Unpacking runs the same path backwards.
    const dir: PlaybackDirection = play.reverse ? 'reverse' : 'normal';
    finished.push(
      nd.x.animate(xs, { ...timing, direction: dir }).finished,
      nd.y.animate(ys, { ...timing, direction: dir }).finished,
      nd.tile.animate(looks, { ...timing, direction: dir }).finished,
    );
    // The count badge steps aside before the flight, so the stack reads as one bundle.
    nd.tile.querySelector('.fly-count')?.animate([{ opacity: 1 }, { opacity: 1, offset: gatherAt }, { opacity: 0, offset: flyAt }, { opacity: 0 }], { ...timing, direction: dir });
  });

  // The tray comes in with the icons and melts away as they gather (it reappears last when unpacking).
  const trayFrames: Keyframe[] = [
    { opacity: 0, transform: 'scale(0.96)', easing: EASE_OUT },
    { opacity: 1, transform: 'scale(1)', offset: at(APPEAR_MS) },
    { opacity: 1, transform: 'scale(1)', offset: gatherAt, easing: EASE_IN_OUT },
    { opacity: 0, transform: 'scale(0.97)', offset: flyAt },
    { opacity: 0, transform: 'scale(0.97)' },
  ];
  finished.push(tray.animate(trayFrames, { duration: TOTAL_MS, fill: 'both', direction: play.reverse ? 'reverse' : 'normal' }).finished);

  // A soft ripple where it all lands (or leaves from, when unpacking).
  const ripple = document.createElement('div');
  ripple.className = 'fly-ripple';
  Object.assign(ripple.style, { left: `${play.target.x - 20}px`, top: `${play.target.y - 20}px` });
  layer.appendChild(ripple);
  finished.push(
    ripple.animate([{ opacity: 0.55, transform: 'scale(0.3)' }, { opacity: 0, transform: 'scale(1.6)' }], {
      duration: 420,
      delay: play.reverse ? 0 : flyEnd - 60,
      easing: EASE_OUT,
      fill: 'both',
    }).finished,
  );
  // Packing lands with a small burst of sparks: the "done" moment.
  if (!play.reverse) {
    const SPARKS = 10;
    for (let i = 0; i < SPARKS; i++) {
      const spark = document.createElement('div');
      spark.className = 'fly-spark';
      Object.assign(spark.style, { left: `${play.target.x - 3}px`, top: `${play.target.y - 3}px` });
      layer.appendChild(spark);
      // Mostly downwards and to the sides: up is off the top of the screen.
      const angle = Math.PI * (0.05 + (0.9 * i) / (SPARKS - 1)) + (i % 2 ? 0.08 : -0.08);
      const dist = 26 + (i % 3) * 9;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      finished.push(
        spark.animate(
          [
            { opacity: 0, transform: 'translate3d(0,0,0) scale(0.6)' },
            { opacity: 1, transform: `translate3d(${dx * 0.35}px,${dy * 0.35}px,0) scale(1)`, offset: 0.2 },
            { opacity: 0, transform: `translate3d(${dx}px,${dy}px,0) scale(0.4)` },
          ],
          { duration: 460, delay: flyEnd - 40 + (i % 3) * 18, easing: EASE_OUT, fill: 'both' },
        ).finished,
      );
    }
  }
  await Promise.all(finished).catch(() => undefined);
}

export function Overlay() {
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    return api.onOverlayPlay((play) => {
      const el = layer.current;
      if (!el) return;
      void playAnimation(el, play).then(() => {
        el.innerHTML = '';
        void api.overlayDone();
      });
    });
  }, []);
  return <div ref={layer} className="fly-layer" />;
}

// ---------- the toast ----------

const gbText = (mb: number, digits = 1) => (mb >= 1024 ? `${(mb / 1024).toFixed(digits)} GB` : `${Math.round(mb)} MB`);

/** The memory freed, rolling up from zero (fast, then settling) and popping when it lands. */
function RollMemory({ mb, delay = 250 }: { mb: number; delay?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setShown(mb);
    const start = performance.now();
    const length = 900;
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start - delay) / length);
      setShown(t <= 0 ? 0 : mb * (1 - Math.pow(1 - t, 4)));
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [mb]);
  const landed = shown === mb;
  return (
    <span className={`mem-roll ${landed ? 'landed' : ''}`} aria-label={`${gbText(mb)} freed`}>
      {gbText(shown)}
      {landed && (
        <span className="mem-sparks" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <motion.i key={n} initial={{ opacity: 1, x: 0, y: 0, scale: 1 }} animate={{ opacity: 0, x: Math.cos((n / 6) * Math.PI * 2) * 26, y: Math.sin((n / 6) * Math.PI * 2) * 16, scale: 0.4 }} transition={{ duration: 0.6, ease: 'easeOut' }} />
          ))}
        </span>
      )}
    </span>
  );
}

/** Your Mac's memory as a bar: the part Tidy all freed glows, then drains away as the number rolls up. */
function MemoryDrop({ before, after, total }: { before: number; after: number; total: number }) {
  const pct = (mb: number) => `${Math.max(0, Math.min(100, (mb / total) * 100))}%`;
  return (
    <span className="mem-bar desk-toast-bar" aria-hidden="true">
      <span className="mem-used" style={{ width: pct(after) }} />
      <motion.span className="mem-freed" style={{ left: pct(after) }} initial={{ width: pct(before - after), opacity: 1 }} animate={{ width: '0%', opacity: 0.5 }} transition={{ delay: 0.3, duration: 1.05, ease: [0.33, 0, 0.2, 1] }} />
    </span>
  );
}

/** A thing's real icon: an app's from where it lives, a tab's site logo, a document's own icon. */
function FlyIcon({ item, size }: { item: Item; size: number }) {
  const appIcon = useMacIcon(item.kind === 'app' && item.path ? item.path : '');
  if (item.kind === 'app' && appIcon) return <img className="desk-fly-img" src={appIcon} width={size} height={size} alt="" draggable={false} />;
  if (item.kind === 'tab' && item.url) return <SiteTile url={item.url} size={size} fallback={<ItemBadge item={item} size={size} />} />;
  return <ItemBadge item={item} size={size} />;
}

const FLY_ICON = 32;
const FIRST_X = 62;
const STEP = 42;
const FOLDER_X = 22;
/** When each icon takes off, and how long it flies (ms). */
const TAKEOFF = 520;
const FLY_GAP = 130;
const FLIGHT = 520;

/**
 * Tidy all's payoff: what you closed lines up beside the Stashd folder (real app icons, then sites), then
 * each one arcs into it, nearest first. The folder gulps every one with a little bounce and a gold ripple.
 * When the last lands, the memory it gave back rolls up where they were. One quiet line and Undo below.
 */
function DeskToast({ info, desk, leaving, busy, onUndo }: { info: ToastInfo; desk: NonNullable<ToastInfo['desk']>; leaving: boolean; busy: boolean; onUndo: () => void }) {
  const calm = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const items = calm ? [] : (desk.items ?? []).slice(0, 6);
  const [landed, setLanded] = useState(0);
  const done = landed >= items.length;
  useEffect(() => {
    const ts = items.map((_, i) => setTimeout(() => setLanded(i + 1), TAKEOFF + i * FLY_GAP + FLIGHT - 40));
    return () => ts.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const freed = desk.freedMB;
  const things = info.count ?? 0;
  const apps = desk.went.find((w) => w.label === 'apps quit')?.count ?? 0;
  const line = [things ? `${things} ${things === 1 ? 'thing' : 'things'} put away` : '', apps ? `${apps} ${apps === 1 ? 'app' : 'apps'} quit` : '', desk.afterMB != null && desk.totalMB ? `${gbText(desk.afterMB)} of ${gbText(desk.totalMB, 0)} in use` : ''].filter(Boolean).join(' · ');
  return (
    <motion.div
      className={`desk-toast ${leaving ? 'leaving' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={freed != null ? `Desk clear. ${gbText(freed)} of memory freed.` : 'Desk clear.'}
      onMouseEnter={() => void api.holdToast(true)}
      onMouseLeave={() => void api.holdToast(false)}
      initial={{ opacity: 0, y: -10, scale: 0.96 }}
      animate={leaving ? { opacity: 0, y: -6, scale: 0.98 } : { opacity: 1, y: 0, scale: 1 }}
      transition={leaving ? { duration: 0.15 } : { type: 'spring', duration: 0.5, bounce: 0.28 }}
    >
      <div className="desk-stage">
        {/* The folder: wide-eyed while it eats, happy when it's done; a squash and a ripple for each one that lands. */}
        <span className="desk-folder">
          <motion.span key={landed} className="desk-folder-bounce" initial={landed ? { scale: 1.18, y: 1 } : false} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 600, damping: 13 }}>
            <FolderMark size={40} alive mood={done ? 'happy' : 'wide'} />
          </motion.span>
          {landed > 0 && <motion.span key={`r${landed}`} className="desk-ripple" initial={{ scale: 0.6, opacity: 0.7 }} animate={{ scale: 1.9, opacity: 0 }} transition={{ duration: 0.55, ease: 'easeOut' }} />}
        </span>

        {items.map((item, i) => {
          const x = FIRST_X + i * STEP;
          const dx = FOLDER_X - (x + FLY_ICON / 2);
          return (
            <motion.span key={item.key} className="desk-fly" style={{ left: x }} initial={{ opacity: 0, scale: 0.4, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', duration: 0.42, bounce: 0.35, delay: 0.06 + i * 0.05 }}>
              <motion.span
                className="desk-fly-inner"
                animate={{ x: [0, dx * 0.5, dx], y: [0, -20, 2], scale: [1, 0.92, 0.3], rotate: [0, -10, -24], opacity: [1, 1, 0] }}
                transition={{ delay: (TAKEOFF + i * FLY_GAP) / 1000, duration: FLIGHT / 1000, times: [0, 0.5, 1], ease: ['easeOut', 'easeIn'] }}
              >
                <FlyIcon item={item} size={FLY_ICON} />
              </motion.span>
            </motion.span>
          );
        })}

        {done && (
          <motion.span className="desk-result" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', duration: 0.45, bounce: 0.3 }}>
            {freed != null ? (
              <>
                <RollMemory mb={freed} delay={0} />
                <span className="desk-toast-label">freed</span>
              </>
            ) : (
              <span className="desk-toast-title">Desk clear</span>
            )}
          </motion.span>
        )}

        <button type="button" className="desk-toast-undo" tabIndex={-1} disabled={busy} onClick={onUndo}>
          Undo
        </button>
      </div>
      {line && <div className="desk-toast-line">{line}</div>}
      {desk.lifetimeMB != null && desk.times != null && desk.times > 1 && <div className="desk-toast-total">{gbText(desk.lifetimeMB)} freed with Stashd so far</div>}
      {info.ms ? <span className="desk-toast-time" style={{ animationDuration: `${info.ms}ms` }} aria-hidden /> : null}
    </motion.div>
  );
}

/** Counts up from 0 to n in about half a second (fast at first, settling at the end), then pops once. */
function CountUp({ n }: { n: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(n);
      return;
    }
    const start = performance.now();
    const length = Math.min(650, 260 + n * 30);
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - start) / length);
      setShown(Math.round(n * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [n]);
  return (
    <span className={`toast-count ${shown === n ? 'done' : ''}`} aria-label={`${n}`}>
      {shown}
    </span>
  );
}

export function Toast() {
  useSettings();
  // The window follows the card's height, so longer text wraps and is read whole, never cut off.
  const fit = useFitWindow<HTMLDivElement>();
  const [info, setInfo] = useState<ToastInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);
  const [leaving, setLeaving] = useState(false);
  // The folder starts the other way round, then takes the toast's mood: asleep after packing, wide-eyed
  // (then settled) when things come back.
  const [mood, setMood] = useState<Mood>('sleep');
  useEffect(() => {
    let wake: ReturnType<typeof setTimeout>;
    let settle: ReturnType<typeof setTimeout>;
    const show = (p: ToastInfo) => {
      setInfo(p);
      const to = p.mood ?? 'awake';
      setMood(to === 'sleep' ? 'awake' : 'sleep');
      clearTimeout(wake);
      clearTimeout(settle);
      wake = setTimeout(() => setMood(to), 200);
      if (to === 'wide') settle = setTimeout(() => setMood('awake'), 1100);
    };
    void api.getPayload<ToastInfo>().then((p) => p && show(p));
    const offShow = api.onToastShow((p) => {
      show(p);
      setBusy(false);
      setLeaving(false);
      setKey((k) => k + 1);
    });
    const offLeave = api.onToastLeave(() => setLeaving(true));
    return () => {
      clearTimeout(wake);
      clearTimeout(settle);
      offShow();
      offLeave();
    };
  }, []);
  // One element that stays while cards come and go, so the window can follow each card's height.
  return (
    <div ref={fit}>
      {info?.desk ? (
        <Motion>
          <DeskToast key={key} info={info} desk={info.desk} leaving={leaving} busy={busy} onUndo={() => {
            setBusy(true);
            void api.undoTidy();
          }} />
        </Motion>
      ) : info ? (
        <Motion>
          <div
            className={`toast ${leaving ? 'leaving' : ''}`}
            key={key}
            role="status"
            aria-live="polite"
            onMouseEnter={() => void api.holdToast(true)}
            onMouseLeave={() => void api.holdToast(false)}
          >
            {info.ms ? <span className="toast-time" style={{ animationDuration: `${info.ms}ms` }} aria-hidden /> : null}
            <motion.span initial={{ scale: 0.6, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}>
              <FolderMark size={34} alive mood={mood} />
            </motion.span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="toast-title">
                {info.title}
                {info.count ? <CountUp n={info.count} /> : null}
              </span>
              {info.detail ? <span className="muted small toast-detail">{info.detail}</span> : null}
            </span>
            {info.action ? (
              <>
                <Button
                  size="small"
                  // An offer on the side (Pack up after an automatic save) is plain text until you point at it.
                  variant={info.subtle ? 'ghost' : 'secondary'}
                  tabIndex={-1}
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void api.toastAction();
                  }}
                >
                  {info.action}
                </Button>
                <Button variant="ghost" className="close" tabIndex={-1} aria-label="Not now" onClick={() => void api.dismissToast()}>
                  ✕
                </Button>
              </>
            ) : info.canUndo ? (
              <Button
                size="small"
                tabIndex={-1}
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void api.undoTidy();
                }}
              >
                Undo
              </Button>
            ) : (
              <Button variant="ghost" className="close" tabIndex={-1} aria-label="Close" onClick={() => void api.dismissToast()}>
                ✕
              </Button>
            )}
          </div>
        </Motion>
      ) : null}
    </div>
  );
}
