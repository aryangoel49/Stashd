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

export function Overlay() {
  const play = usePayload<OverlayPlay>();
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = layer.current;
    if (!play || !el) return;
    el.innerHTML = '';
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cols = Math.min(4, play.items.length);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    play.items.forEach((item, i) => {
      const card = document.createElement('div');
      card.className = 'fly';
      if (item.icon) {
        const img = document.createElement('img');
        img.src = item.icon;
        img.alt = '';
        card.appendChild(img);
      } else {
        card.classList.add('plain');
      }
      const label = document.createElement('span');
      label.textContent = item.label;
      card.appendChild(label);
      el.appendChild(card);

      // Start in a loose grid in the middle of the screen, fly into the menu bar icon.
      const col = i % cols;
      const row = Math.floor(i / cols);
      const sx = w / 2 + (col - (cols - 1) / 2) * 150;
      const sy = h * 0.42 + row * 120;
      const start = `translate(${sx - 50}px, ${sy - 45}px) scale(1)`;
      const end = `translate(${play.target.x - 50}px, ${play.target.y - 45}px) scale(0.08)`;
      const frames = [
        { transform: start, opacity: 0 },
        { transform: start, opacity: 1, offset: 0.25 },
        { transform: end, opacity: 0.2 },
      ];
      card.animate(play.reverse ? [...frames].reverse() : frames, {
        duration: reduce ? 1 : 950,
        delay: reduce ? 0 : i * 90,
        easing: 'cubic-bezier(0.55, 0, 0.25, 1)',
        fill: 'forwards',
      });
    });
  }, [play]);

  return <div ref={layer} className="fly-layer" />;
}

// ---------- the toast ----------

export function Toast() {
  useSettings();
  const info = usePayload<ToastInfo>();
  const [busy, setBusy] = useState(false);
  useEffect(() => setBusy(false), [info]);
  if (!info) return null;
  return (
    <div className="toast fade-in">
      <span className="icon" style={{ width: 34, height: 34, color: 'var(--accent)' }}>
        <Icon name={info.canUndo ? 'stack' : 'check'} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{info.title}</span>
        <span className="muted small">{info.detail}</span>
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
