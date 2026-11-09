// The Break side of the menu bar panel: your places (YouTube, Netflix…) up top, then what you were watching
// (put here by Tidy all) as a row of thumbnails, and where they open. The first time you open something it asks which
// browser; the "Opens in …" line changes it any time.

import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { useDragControls } from 'motion/react';
import type { BreakItem, BreakShelf, BrowserName } from '../shared/types';
import { api, errorText, timeAgo } from './api';
import { Icon } from './icons';
import { AnimatePresence, Button, FolderMark, motion } from './ui';
import { useMacIcon } from './visuals';
import { appPathOf, searchPlaces, type PlaceOption } from '../shared/places';

type Where = BrowserName | 'window';
const WHERE: { id: Where; label: string }[] = [
  { id: 'chrome', label: 'Google Chrome' },
  { id: 'safari', label: 'Safari' },
  { id: 'arc', label: 'Arc' },
  { id: 'brave', label: 'Brave' },
  { id: 'edge', label: 'Microsoft Edge' },
  { id: 'vivaldi', label: 'Vivaldi' },
  { id: 'window', label: 'Its own window, no tabs around it' },
];
const whereLabel = (w: BreakShelf['browser']) => (w === 'window' ? 'its own window' : (WHERE.find((x) => x.id === w)?.label ?? ''));

/** Work or Break, at the top of the panel. */
export function ModeSwitch({ mode, onChange }: { mode: 'work' | 'break'; onChange: (m: 'work' | 'break') => void }) {
  return (
    <div className="mode-seg" role="tablist" aria-label="Work or break">
      {(['work', 'break'] as const).map((m) => (
        <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => onChange(m)}>
          {mode === m && <motion.span layoutId="mode-pill" className="mode-pill" transition={{ type: 'spring', duration: 0.35, bounce: 0.15 }} />}
          <span className="mode-label">{m === 'work' ? 'Work' : 'Break'}</span>
        </button>
      ))}
    </div>
  );
}

/** Brand marks (from Simple Icons, CC0), drawn on a tile in the brand's own colours. */
const BRANDS: { test: RegExp; bg: string; fg: string; path: string; inset?: number }[] = [
  { test: /youtube\.com|youtu\.be/, bg: '#ffffff', fg: '#ff0000', path: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z', inset: 0.16 },
  { test: /netflix\.com/, bg: '#000000', fg: '#e50914', path: 'M5.398 0v.006c3.028 8.556 5.37 15.175 8.348 23.596 2.344.058 4.85.398 4.854.398-2.8-7.924-5.923-16.747-8.487-24zm8.489 0v9.63L18.6 22.951c-.043-7.86-.004-15.913.002-22.95zM5.398 1.05V24c1.873-.225 2.81-.312 4.715-.398v-9.22z', inset: 0.24 },
  { test: /spotify\.com/, bg: '#121212', fg: '#1ed760', path: 'M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z', inset: 0.2 },
  { test: /twitch\.tv/, bg: '#9146ff', fg: '#ffffff', path: 'M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z', inset: 0.24 },
  { test: /crunchyroll\.com/, bg: '#f47521', fg: '#ffffff', path: 'M2.933 13.467a10.55 10.55 0 1 1 21.067-.8V12c0-6.627-5.373-12-12-12S0 5.373 0 12s5.373 12 12 12h.8a10.617 10.617 0 0 1-9.867-10.533zM19.2 14a3.85 3.85 0 0 1-1.333-7.467A7.89 7.89 0 0 0 14 5.6a8.4 8.4 0 1 0 8.4 8.4 6.492 6.492 0 0 0-.133-1.6A3.415 3.415 0 0 1 19.2 14z', inset: 0.22 },
];

function hostOfUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^(www|m)\./, '');
  } catch {
    return '';
  }
}

/**
 * A place's own logo, loaded from the site itself (like opening it would). The big home-screen icon
 * first, since it stays sharp at tile size, then the classic favicon. Misses are remembered for the session.
 */
const ICON_PATHS = ['/apple-touch-icon.png', '/favicon.ico'];
const iconMisses = new Map<string, number>();

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** An app place's tile: the app's own icon from this Mac. */
function AppTile({ path, size }: { path: string; size: number }) {
  const icon = useMacIcon(path);
  const name = path.split('/').pop()?.replace(/\.app$/, '') ?? '';
  if (icon) return <img className="site-tile app-icon" src={icon} width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
  return (
    <span className="site-tile" style={{ width: size, height: size, background: 'var(--well)', color: 'var(--text)', fontSize: size * 0.42 }} aria-hidden="true">
      {(name[0] ?? '•').toUpperCase()}
    </span>
  );
}

/** A place's tile: an app's icon, a site's real mark for the well-known ones, else its logo, else its first letter. */
function SiteTile({ url, size = 30 }: { url: string; size?: number }) {
  const app = appPathOf(url);
  if (app) return <AppTile path={app} size={size} />;
  return <WebTile url={url} size={size} />;
}

function WebTile({ url, size }: { url: string; size: number }) {
  const h = hostOfUrl(url);
  const origin = originOf(url);
  const [step, setStep] = useState(() => (origin ? (iconMisses.get(origin) ?? 0) : ICON_PATHS.length));
  const b = BRANDS.find((x) => x.test.test(h));
  if (b) {
    const pad = Math.round(size * (b.inset ?? 0.2));
    return (
      <span className="site-tile brand" style={{ width: size, height: size, background: b.bg, padding: pad }} aria-hidden="true">
        <svg viewBox="0 0 24 24" width={size - pad * 2} height={size - pad * 2}>
          <path d={b.path} fill={b.fg} />
        </svg>
      </span>
    );
  }
  if (origin && step < ICON_PATHS.length) {
    // The home-screen icon is a full square with its own background; a favicon sits on the tile.
    const full = step === 0;
    return (
      <img
        key={step}
        className={`site-tile site-logo ${full ? 'full' : ''}`}
        src={origin + ICON_PATHS[step]}
        width={size}
        height={size}
        style={full ? undefined : { padding: Math.round(size * 0.2) }}
        alt=""
        aria-hidden="true"
        draggable={false}
        referrerPolicy="no-referrer"
        onError={() => {
          iconMisses.set(origin, step + 1);
          setStep(step + 1);
        }}
      />
    );
  }
  return (
    <span className="site-tile" style={{ width: size, height: size, background: 'var(--well)', color: 'var(--text)', fontSize: size * 0.42 }} aria-hidden="true">
      {(h[0] ?? '•').toUpperCase()}
    </span>
  );
}

/**
 * A place while you edit, like the Home Screen: pick its logo up and it lifts and follows the pointer,
 * the others slide aside, and it settles into its new spot when you let go. Arrow keys move it too.
 */
function EditPlace({ place, onLift, onMove, onDrop, onStep, onRename, onRemove, onDone, ref }: {
  place: { name: string; url: string };
  onLift: () => void;
  onMove: (x: number, y: number) => void;
  onDrop: () => void;
  onStep: (step: -1 | 1) => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  onDone: () => void;
  ref?: Ref<HTMLDivElement>;
}) {
  const controls = useDragControls();
  const [held, setHeld] = useState(false);
  return (
    <motion.div
      ref={ref}
      layout
      drag
      dragControls={controls}
      dragListener={false}
      dragSnapToOrigin
      dragMomentum={false}
      dragElastic={1}
      // Settling home: critically damped, carrying the speed you let go at.
      dragTransition={{ bounceStiffness: 420, bounceDamping: 41 }}
      transition={{ type: 'spring', duration: 0.35, bounce: 0 }}
      exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.18, ease: [0.23, 1, 0.32, 1] } }}
      whileDrag={{ scale: 1.1 }}
      onDragStart={() => {
        setHeld(true);
        onLift();
      }}
      onDrag={(e, info) => onMove('clientX' in e ? e.clientX : info.point.x, 'clientY' in e ? e.clientY : info.point.y)}
      onDragEnd={() => {
        setHeld(false);
        onDrop();
      }}
      style={{ zIndex: held ? 5 : 1 }}
      className={`nf-place nf-place-editing ${held ? 'held' : ''}`}
    >
      <span
        className="nf-tile-wrap nf-drag"
        tabIndex={0}
        role="button"
        aria-label={`Move ${place.name}. Use the arrow keys.`}
        title="Drag to move"
        onPointerDown={(e) => controls.start(e)}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
          if (!step) return;
          e.preventDefault();
          const target = e.currentTarget;
          onStep(step);
          requestAnimationFrame(() => target.focus());
        }}
      >
        <SiteTile url={place.url} size={44} />
        <motion.button
          type="button"
          className="nf-remove"
          aria-label={`Remove ${place.name}`}
          title="Remove"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: held ? 0 : 1, scale: held ? 0.5 : 1 }}
          transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
        >
          <svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true">
            <path d="M1.5 5h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </motion.button>
      </span>
      <input
        className="nf-name-edit"
        defaultValue={place.name}
        maxLength={40}
        aria-label={`Name for ${place.name}`}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => onRename(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            e.stopPropagation();
            e.currentTarget.value = place.name;
            onDone();
          }
        }}
      />
    </motion.div>
  );
}

/**
 * Continue watching scrolls sideways. So it's clear there's more: the next card peeks in, the edge fades only
 * where there's more to see, round arrows page through it (for mice without sideways scrolling), and the
 * first time the row has more than fits, it nudges a little to the side and settles back.
 */
function ScrollRow({ count, children }: { count: number; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const measure = () => {
    const el = row.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft < 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  };
  useEffect(() => {
    measure();
    const el = row.current;
    if (!el || el.scrollWidth <= el.clientWidth + 4) return;
    // Once per run: a small sideways nudge that says "this scrolls".
    if (nudged || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    nudged = true;
    const t = setTimeout(() => {
      el.scrollTo({ left: 36, behavior: 'smooth' });
      setTimeout(() => el.scrollTo({ left: 0, behavior: 'smooth' }), 420);
    }, 500);
    return () => clearTimeout(t);
  }, [count]);
  const page = (dir: 1 | -1) => {
    const el = row.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>('.nf-card');
    const step = card ? (card.offsetWidth + 10) * 2 : el.clientWidth * 0.8;
    el.scrollBy({ left: dir * step, behavior: 'smooth' });
  };
  return (
    <div className="nf-row-wrap">
      <div ref={row} className={`nf-row ${edges.start ? '' : 'fade-l'} ${edges.end ? '' : 'fade-r'}`} onScroll={measure}>
        {children}
      </div>
      <button type="button" className={`nf-arrow left ${edges.start ? 'gone' : ''}`} aria-label="Show earlier videos" tabIndex={edges.start ? -1 : 0} onClick={() => page(-1)}>
        <Icon name="chevron" />
      </button>
      <button type="button" className={`nf-arrow right ${edges.end ? 'gone' : ''}`} aria-label="Show more videos" tabIndex={edges.end ? -1 : 0} onClick={() => page(1)}>
        <Icon name="chevron" />
      </button>
    </div>
  );
}
let nudged = false;

/** Episodes of one show sit together ("Shark Tank · 4 episodes"); everything else on its own. */
function showOf(title: string): string | null {
  const t = title.replace(/\s+[-–|·]\s+(YouTube|Netflix|Twitch|Prime Video|Disney\+)$/i, '').trim();
  const m = /^(.{3,40}?)\s*(?:[-–|:·,]\s*)?(?:S\d{1,2}\s*E\d{1,3}|Season\s+\d+|Episode\s+\d+|Ep\.?\s*\d+|Part\s+\d+|#\d+)\b/i.exec(t);
  return m ? m[1].replace(/[-–|:·,\s]+$/, '').trim() : null;
}

/**
 * A live stream (a Twitch or Kick channel, a YouTube live page): it has no length, so it gets a Live tag.
 * A YouTube stream on an ordinary video address is told by the extension instead (noted with length 0).
 */
export function isStream(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m)\./, '');
    const p = u.pathname.replace(/\/+$/, '');
    if (host === 'twitch.tv' || host === 'kick.com') return /^\/[\w]+$/.test(p) && !/^\/(directory|search|settings|subscriptions|downloads|turbo|wallet|drops|inventory|p|videos|categories|browse|following)$/.test(p);
    if (host === 'youtube.com') return /^\/live(\/|$)/.test(p) || /^\/@[^/]+\/live$/.test(p);
    return false;
  } catch {
    return false;
  }
}

type Row = { key: string; title: string; site: string; meta: string; url: string; items: BreakItem[] };

function rows(items: BreakItem[]): Row[] {
  const out: Row[] = [];
  const shows = new Map<string, Row>();
  for (const raw of items) {
    // YouTube puts your notification count in front of titles: "(182) Stop Sending Clips".
    const it = { ...raw, label: raw.label.replace(/^\(\d+\)\s+/, '') };
    const show = showOf(it.label);
    const site = hostOfUrl(it.url ?? '');
    if (show) {
      const id = show.toLowerCase();
      const row = shows.get(id);
      if (row) {
        row.items.push(it);
        row.meta = `${row.items.length} episodes`;
        continue;
      }
      const r: Row = { key: `show:${id}`, title: show, site, meta: it.savedAt ? timeAgo(it.savedAt) : '', url: it.url!, items: [it] };
      shows.set(id, r);
      out.push(r);
    } else {
      out.push({ key: it.key, title: it.label.replace(/\s+[-–|·]\s+YouTube$/i, ''), site, meta: it.savedAt ? timeAgo(it.savedAt) : '', url: it.url!, items: [it] });
    }
  }
  return out;
}

/** A YouTube video's own picture: YouTube serves every video's thumbnail at a fixed address. */
function thumbOf(url: string): string | null {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^(www|m)\./, '');
    const id = h === 'youtu.be' ? u.pathname.slice(1) : h === 'youtube.com' ? (u.searchParams.get('v') ?? /^\/(?:live|embed)\/([\w-]+)/.exec(u.pathname)?.[1]) : null;
    return id && /^[\w-]{11}$/.test(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
  } catch {
    return null;
  }
}

/** A card's artwork: the video's thumbnail when there is one, else the site's mark with a soft glow of its colour. */
function Artwork({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const thumb = failed ? null : thumbOf(url);
  if (thumb) return <img className="nf-art" src={thumb} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  const b = BRANDS.find((x) => x.test.test(hostOfUrl(url)));
  // Most marks sit on white or black; the colour that says "this site" is then the mark's own.
  const glow = b ? (/^#(fff|ffffff|000|000000|121212)$/i.test(b.bg) ? b.fg : b.bg) : '#9a9488';
  return (
    <span className="nf-art nf-poster" style={{ background: `radial-gradient(circle at 70% 25%, ${glow}33, transparent 65%), var(--well)` }} aria-hidden="true">
      {b ? (
        <svg viewBox="0 0 24 24" className="nf-mark">
          <path d={b.path} fill={b.fg} />
        </svg>
      ) : (
        <span className="nf-letter">{(hostOfUrl(url)[0] ?? '•').toUpperCase()}</span>
      )}
    </span>
  );
}

/** How far into the video you were (0 to 1), when the Chrome extension noted it. */
function doneOf(r: Row): number | null {
  const p = r.items[0].progress;
  return p && p.d > 0 && Number.isFinite(p.t) ? Math.min(1, Math.max(0, p.t / p.d)) : null;
}

/** "12 min left", like a streaming app, or the usual meta line when there's no position. */
function leftOf(r: Row): string | null {
  const p = r.items[0].progress;
  if (!p || !(p.d > 0) || r.items.length > 1) return null;
  const min = Math.round((p.d - p.t) / 60);
  if (min < 1) return 'Less than a minute left';
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min left` : `${min} min left`;
}

const Bar = ({ done }: { done: number | null }) =>
  done === null ? null : (
    <span className="nf-progress" aria-hidden="true">
      <span style={{ width: `${Math.max(4, done * 100)}%` }} />
    </span>
  );

const Play = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" />
  </svg>
);

/** Most places you can have (matches the limit kept in the main process). */
const MAX_PLACES = 12;

/**
 * Adding a place: type a few letters ("spo") and pick Spotify, the app on this Mac or the site, with a
 * click or the arrow keys and Return. Any web address works too. Escape (or leaving it empty) closes it.
 */
function PlaceSearch({ taken, onPick, onClose }: { taken: string[]; onPick: (p: PlaceOption) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [apps, setApps] = useState<{ name: string; path: string }[]>([]);
  const [at, setAt] = useState(0);
  useEffect(() => {
    void api.breakApps().then(setApps, () => undefined);
  }, []);
  const options = useMemo(() => searchPlaces(text, apps, taken), [text, apps, taken]);
  const pick = (p: PlaceOption | undefined) => p && onPick(p);
  const kindLabel = (p: PlaceOption) => (p.kind === 'app' ? 'App on this Mac' : p.kind === 'address' ? 'Web address' : 'Website');
  return (
    <div className="nf-search">
      <input
        className="field small"
        autoFocus
        value={text}
        placeholder="Search apps and sites, or type an address"
        aria-label="Search apps and sites to add"
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls="nf-search-list"
        aria-activedescendant={options[at] ? `nf-opt-${at}` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setAt(0);
        }}
        onBlur={() => !text.trim() && onClose()}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setAt((i) => Math.min(options.length - 1, i + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setAt((i) => Math.max(0, i - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(options[at]);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />
      {text.trim() && (
        <div className="nf-options" id="nf-search-list" role="listbox" aria-label="Matches">
          {options.length ? (
            options.map((p, i) => (
              <button
                key={p.url}
                id={`nf-opt-${i}`}
                type="button"
                role="option"
                aria-selected={i === at}
                className={`nf-option ${i === at ? 'on' : ''}`}
                // Keep the box focused, so it doesn't close before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setAt(i)}
                onClick={() => pick(p)}
              >
                <SiteTile url={p.url} size={24} />
                <span className="grow">{p.name}</span>
                <span className="faint small">{kindLabel(p)}</span>
              </button>
            ))
          ) : (
            <div className="nf-option-none">No app or site called that. Type its address, like {text.trim().toLowerCase().replace(/\s+/g, '')}.com</div>
          )}
        </div>
      )}
    </div>
  );
}

export function BreakView() {
  const [shelf, setShelf] = useState<BreakShelf | null>(null);
  const [asking, setAsking] = useState<string | null | 'change'>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  // While you drag a place: the order so far, and which one you're holding.
  const [order, setOrder] = useState<string[] | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => api.breakShelf().then(setShelf, () => undefined);
    load();
    const offs = [api.onJobsChanged(load), api.onWindowShown(load)];
    return () => offs.forEach((o) => o());
  }, []);
  const list = useMemo(() => (shelf ? rows(shelf.items) : []), [shelf]);
  if (!shelf) return <div className="break-view" />;

  const open = (url: string) => {
    if (!shelf.browser) return setAsking(url);
    void api.openBreak(url).catch((e) => setError(errorText(e)));
  };
  const choose = (w: Where) => {
    const url = asking;
    void api.changeBreak({ browser: w }).then((s) => {
      setShelf(s);
      setAsking(null);
      if (url && url !== 'change') void api.openBreak(url);
    }, (e) => setError(errorText(e)));
  };

  // The first time (or after "Change"): where should break things open?
  if (asking) {
    return (
      <div className="break-view">
        <div className="pick-head">
          <span className="pick-title">Where should these open?</span>
          <span className="pick-sub">Stashd remembers this. You can change it any time.</span>
        </div>
        <div className="pick-list">
          {WHERE.map((w) => (
            <button key={w.id} type="button" className={`pick-row ${shelf.browser === w.id ? 'on' : ''}`} onClick={() => choose(w.id)}>
              <span className="grow">{w.label}</span>
              {shelf.browser === w.id && <Icon name="check" />}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="small" onClick={() => setAsking(null)}>
          <Icon name="back" /> Back
        </Button>
      </div>
    );
  }

  const addPlace = (p: PlaceOption) => {
    setError(null);
    void api.changeBreak({ addPlace: { name: p.name, url: p.url } }).then((s) => {
      setShelf(s);
      setAdding(false);
    }, (e) => setError(errorText(e)));
  };

  const renamePlace = (url: string, value: string) => {
    const name = value.trim();
    if (!name || shelf.places.find((p) => p.url === url)?.name === name) return;
    void api.changeBreak({ renamePlace: { url, name } }).then(setShelf, (e) => setError(errorText(e)));
  };
  // Move a place: live while you drag (the others slide aside), saved when you let go.
  const moveTo = (url: string, to: number, from = order ?? shelf.places.map((p) => p.url)) => {
    const next = from.filter((u) => u !== url);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, url);
    return next;
  };
  const saveOrder = (urls: string[]) => {
    setOrder(urls);
    void api.changeBreak({ orderPlaces: urls }).then((s) => {
      setShelf(s);
      setOrder(null);
    }, (e) => {
      setOrder(null);
      setError(errorText(e));
    });
  };
  // Which spot in the grid (4 across) the pointer is over, counted the way the places are laid out.
  const slotAt = (x: number, y: number, count: number) => {
    const g = grid.current;
    const first = g?.firstElementChild as HTMLElement | null;
    if (!g || !first) return 0;
    const r = g.getBoundingClientRect();
    const col = Math.min(3, Math.max(0, Math.floor(((x - r.left) / r.width) * 4)));
    const row = Math.max(0, Math.floor((y - r.top) / (first.offsetHeight + 4)));
    return Math.min(count - 1, row * 4 + col);
  };
  const byUrl = new Map(shelf.places.map((p) => [p.url, p]));
  const places = order ? order.map((u) => byUrl.get(u)).filter((p): p is (typeof shelf.places)[number] => !!p) : shelf.places;
  const remove = (r: Row) => void Promise.all(r.items.map((it) => api.changeBreak({ removeItem: it.key }))).then((all) => all.length && setShelf(all[all.length - 1]));

  // Your places come first and largest: they're what you reach for. Under them, what you were watching sits
  // in one row of small thumbnails you scroll sideways, latest first.
  return (
    <div className="break-view nf">
      {/* Edit turns every name into a text box and gives each place a remove badge; right-click a place does the same. */}
      <div className="nf-label nf-label-row">
        <span>Your places</span>
        <button type="button" className={`nf-edit ${editing ? 'on' : ''}`} onClick={() => setEditing(!editing)}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      {editing && places.length > 1 && <div className="nf-hint">Drag a logo to move it.</div>}
      <div className="nf-places" ref={grid}>
        {editing ? (
          <AnimatePresence mode="popLayout" initial={false}>
            {places.map((p, i) => (
              <EditPlace
                key={p.url}
                place={p}
                onLift={() => setOrder(places.map((x) => x.url))}
                onMove={(x, y) => {
                  const to = slotAt(x, y, places.length);
                  if (to !== i) setOrder(moveTo(p.url, to));
                }}
                onDrop={() => {
                  if (order && order.join() !== shelf.places.map((x) => x.url).join()) saveOrder(order);
                  else setOrder(null);
                }}
                onStep={(step) => saveOrder(moveTo(p.url, i + step, places.map((x) => x.url)))}
                onRename={(name) => renamePlace(p.url, name)}
                onRemove={() => void api.changeBreak({ removePlace: p.url }).then(setShelf, (e) => setError(errorText(e)))}
                onDone={() => setEditing(false)}
              />
            ))}
          </AnimatePresence>
        ) : (
          places.map((p) => (
            <button
              key={p.url}
              type="button"
              className="nf-place"
              onClick={() => open(p.url)}
              onContextMenu={(e) => {
                e.preventDefault();
                setEditing(true);
              }}
              title={`Open ${p.name}`}
            >
              <SiteTile url={p.url} size={44} />
              <span>{p.name}</span>
            </button>
          ))
        )}
        {editing || adding || places.length >= MAX_PLACES ? null : (
          <button
            type="button"
            className="nf-place"
            onClick={() => {
              setError(null);
              setAdding(true);
            }}
            title="Add an app or a site"
          >
            <span className="nf-add" aria-hidden="true">
              <Icon name="plus" />
            </span>
            <span>Add</span>
          </button>
        )}
      </div>
      {adding && !editing && <PlaceSearch taken={places.map((p) => p.url)} onPick={addPlace} onClose={() => setAdding(false)} />}

      <div className="nf-label nf-label-row">
        <span>Continue watching</span>
        {list.length > 2 && <span className="nf-count">{list.length}</span>}
      </div>
      {list.length > 0 ? (
        <ScrollRow count={list.length}>
          {list.map((r, i) => (
            <motion.div key={r.key} className="nf-card" initial={{ opacity: 0, transform: 'translateY(4px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} transition={{ duration: 0.2, delay: Math.min(i, 4) * 0.03 }}>
              <button type="button" className="nf-card-hit" onClick={() => open(r.url)} title={`${i === 0 ? 'Resume' : 'Open'} ${r.title}`}>
                <span className="nf-card-art">
                  <Artwork url={r.url} />
                  {r.items.length > 1 && <span className="nf-badge">{r.items.length} episodes</span>}
                  {(isStream(r.url) || r.items[0].progress?.d === 0) && <span className="nf-live">Live</span>}
                  <span className="nf-play" aria-hidden="true">
                    <Play />
                  </span>
                  <Bar done={doneOf(r)} />
                </span>
                <span className="nf-card-title">{r.title}</span>
                <span className="nf-card-meta">{r.items.length > 1 ? r.site : (leftOf(r) ?? [r.site, r.meta].filter(Boolean).join(' · '))}</span>
              </button>
              <button type="button" className="nf-x" aria-label={`Remove ${r.title}`} title="Done with it: remove" onClick={() => remove(r)}>
                ✕
              </button>
            </motion.div>
          ))}
        </ScrollRow>
      ) : (
        <div className="nf-empty">
          <FolderMark size={30} mood="sleep" />
          <span>Videos you close, or that Tidy all puts away, show up here so you can carry on.</span>
        </div>
      )}

      <div className="nf-foot">
        <span>{shelf.browser ? `Opens in ${whereLabel(shelf.browser)}` : 'Asks where to open the first time'}</span>
        <button type="button" className="link small" onClick={() => setAsking('change')}>
          Change
        </button>
      </div>
      {error && <div className="banner">{error}</div>}
    </div>
  );
}
