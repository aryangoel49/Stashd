// The tidy-up screens: naming untitled files, the fly-into-the-menu-bar animation, and the toast.

import { useEffect, useRef, useState } from 'react';
import type { NamingRequest, OverlayPlay, ToastInfo } from '../shared/types';
import { api, useFitWindow, useSettings } from './api';
import { Button, FolderMark, motion, Motion } from './ui';

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

const POP_MS = 140;
const FLY_MS = 420;
const STAGGER_MS = 40;

/** Wait (briefly) for icons to be decoded, so nothing pops in half-drawn. */
async function ready(imgs: HTMLImageElement[]): Promise<void> {
  await Promise.race([Promise.all(imgs.map((i) => i.decode().catch(() => undefined))), new Promise((r) => setTimeout(r, 80))]);
}

// ---------- sound ----------
// Made on the fly with Web Audio, so there are no sound files: a soft whoosh as things fly,
// then a small wooden "tock" as they land in the folder.

let audio: AudioContext | null = null;

function whoosh(ctx: AudioContext, at: number, length: number, reverse: boolean): void {
  const n = Math.floor(ctx.sampleRate * length);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 0.9;
  band.frequency.setValueAtTime(reverse ? 2400 : 500, at);
  band.frequency.exponentialRampToValueAtTime(reverse ? 500 : 2400, at + length);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.09, at + length * 0.45);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  src.connect(band).connect(gain).connect(ctx.destination);
  src.start(at);
  src.stop(at + length);
}

function tock(ctx: AudioContext, at: number): void {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, at);
  osc.frequency.exponentialRampToValueAtTime(330, at + 0.12);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.16, at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + 0.18);
}

function playSound(count: number, reverse: boolean): void {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    void ctx.resume();
    const t = ctx.currentTime + 0.02;
    const total = (POP_MS + FLY_MS + STAGGER_MS * Math.max(0, count - 1)) / 1000;
    whoosh(ctx, t + (reverse ? 0 : POP_MS / 1000), total - (reverse ? 0.1 : POP_MS / 1000), reverse);
    if (!reverse) tock(ctx, t + total - 0.04);
  } catch {
    // no sound, no problem
  }
}

async function playAnimation(layer: HTMLDivElement, play: OverlayPlay): Promise<void> {
  layer.innerHTML = '';
  const w = play.size.width;
  const h = play.size.height;
  const n = play.items.length;
  const perRow = Math.min(6, n);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const imgs: HTMLImageElement[] = [];
  const cards = play.items.map((item, i) => {
    const card = document.createElement('div');
    card.className = 'fly';
    const tile = document.createElement('div');
    tile.className = 'fly-tile';
    if (item.icon) {
      const img = document.createElement('img');
      img.src = item.icon;
      img.alt = '';
      imgs.push(img);
      tile.appendChild(img);
    }
    const label = document.createElement('span');
    label.textContent = item.label;
    card.append(tile, label);
    layer.appendChild(card);

    // A neat row (or two) just above the middle of the screen.
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, n - row * perRow);
    const col = i % perRow;
    const x = w / 2 + (col - (inRow - 1) / 2) * 116 - 50;
    const y = h * 0.4 + row * 120 - 46;
    return { card, label, x, y };
  });
  await ready(imgs);
  await new Promise((r) => requestAnimationFrame(r));
  if (play.sound && !reduce) playSound(n, play.reverse);

  const tx = play.target.x - 50;
  const ty = play.target.y - 46;
  const animations = cards.map(({ card, label, x, y }, i) => {
    const at = `translate3d(${x}px, ${y}px, 0)`;
    const home = `translate3d(${tx}px, ${ty}px, 0)`;
    const frames: Keyframe[] = play.reverse
      ? [
          { transform: `${home} scale(0.12)`, opacity: 0, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
          { transform: `${at} scale(1)`, opacity: 1, offset: 0.75 },
          { transform: `${at} scale(1)`, opacity: 0 },
        ]
      : [
          { transform: `${at} scale(0.85)`, opacity: 0, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
          { transform: `${at} scale(1)`, opacity: 1, offset: POP_MS / (POP_MS + FLY_MS), easing: 'cubic-bezier(0.6, 0, 0.75, 0.25)' },
          { transform: `${home} scale(0.1)`, opacity: 0.2 },
        ];
    const timing: KeyframeAnimationOptions = { duration: reduce ? 1 : POP_MS + FLY_MS, delay: reduce ? 0 : i * STAGGER_MS, fill: 'both' };
    // Labels fade out as the icons start to fly, so the motion stays clean.
    label.animate([{ opacity: 1 }, { opacity: 1, offset: 0.3 }, { opacity: 0, offset: 0.45 }, { opacity: 0 }], timing);
    return card.animate(frames, timing).finished;
  });
  await Promise.all(animations).catch(() => undefined);
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

export function Toast() {
  useSettings();
  const [info, setInfo] = useState<ToastInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(0);
  const [leaving, setLeaving] = useState(false);
  // The folder starts the other way round, then closes its eyes (packed) or wakes up (unpacked).
  const [awake, setAwake] = useState(false);
  useEffect(() => {
    let wake: ReturnType<typeof setTimeout>;
    const show = (p: ToastInfo) => {
      setInfo(p);
      setAwake(p.canUndo);
      clearTimeout(wake);
      wake = setTimeout(() => setAwake(!p.canUndo), 200);
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
      offShow();
      offLeave();
    };
  }, []);
  if (!info) return null;
  return (
    <Motion>
      <div className={`toast ${leaving ? 'leaving' : ''}`} key={key}>
        <motion.span initial={{ scale: 0.6, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}>
          <FolderMark size={34} awake={awake} />
        </motion.span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="toast-title">{info.title}</span>
          <span className="muted small toast-detail">{info.detail}</span>
        </span>
        {info.canUndo ? (
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
  );
}
