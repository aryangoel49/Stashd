// The tidy-up screens: naming untitled files, the fly-into-the-menu-bar animation, and the toast.

import { useEffect, useRef, useState } from 'react';
import type { NamingRequest, OverlayPlay, ToastInfo } from '../shared/types';
import { api, useFitWindow, useSettings } from './api';
import { Icon } from './icons';

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
          <button type="button" className="btn" onClick={() => void api.finishNaming(req.items.map(() => null))} title="Leave these windows open">
            Skip
          </button>
          <button type="submit" className="btn primary">
            Save and tidy <span style={{ opacity: 0.7 }}>↵</span>
          </button>
        </span>
      </div>
    </form>
  );
}

// ---------- the fly-in animation ----------

const POP_MS = 200;
const FLY_MS = 560;
const STAGGER_MS = 70;

/** Wait for icons to be decoded before animating, so nothing pops in half-drawn. */
async function ready(imgs: HTMLImageElement[]): Promise<void> {
  await Promise.race([Promise.all(imgs.map((i) => i.decode().catch(() => undefined))), new Promise((r) => setTimeout(r, 250))]);
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

  const tx = play.target.x - 50;
  const ty = play.target.y - 46;
  const animations = cards.map(({ card, label, x, y }, i) => {
    const at = `translate3d(${x}px, ${y}px, 0)`;
    const home = `translate3d(${tx}px, ${ty}px, 0)`;
    const frames: Keyframe[] = play.reverse
      ? [
          { transform: `${home} scale(0.12)`, opacity: 0, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
          { transform: `${at} scale(1)`, opacity: 1, offset: 0.75 },
          { transform: `${at} scale(1)`, opacity: 0 },
        ]
      : [
          { transform: `${at} scale(0.8)`, opacity: 0, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
          { transform: `${at} scale(1)`, opacity: 1, offset: POP_MS / (POP_MS + FLY_MS), easing: 'cubic-bezier(0.55, 0, 0.8, 0.2)' },
          { transform: `${home} scale(0.12)`, opacity: 0.3 },
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
  useEffect(() => {
    void api.getPayload<ToastInfo>().then((p) => p && setInfo(p));
    return api.onToastShow((p) => {
      setInfo(p);
      setBusy(false);
      setKey((k) => k + 1);
    });
  }, []);
  if (!info) return null;
  return (
    <div className="toast" key={key}>
      <span className="icon" style={{ width: 34, height: 34, color: 'var(--accent)' }}>
        <Icon name={info.canUndo ? 'stack' : 'check'} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="toast-title">{info.title}</span>
        <span className="muted small toast-detail">{info.detail}</span>
      </span>
      {info.canUndo ? (
        <button
          className="btn small"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void api.undoTidy();
          }}
        >
          Undo
        </button>
      ) : (
        <button className="btn ghost" aria-label="Close" onClick={() => void api.dismissToast()}>
          ✕
        </button>
      )}
    </div>
  );
}
