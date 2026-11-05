// The Break side of the menu bar panel: your places (YouTube, Netflix…) up top, then what you were watching
// (put here by Tidy all) as a row of thumbnails, and where they open. The first time you open something it asks which
// browser; the "Opens in …" line changes it any time.

import { useEffect, useMemo, useState } from 'react';
import type { BreakItem, BreakShelf } from '../shared/types';
import { api, errorText, timeAgo } from './api';
import { Icon } from './icons';
import { Button, FolderMark, motion } from './ui';

type Where = 'chrome' | 'arc' | 'safari' | 'window';
const WHERE: { id: Where; label: string }[] = [
  { id: 'chrome', label: 'Google Chrome' },
  { id: 'safari', label: 'Safari' },
  { id: 'arc', label: 'Arc' },
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

/** A site's own tile: its real mark for the well-known ones, else its first letter. */
function SiteTile({ url, size = 30 }: { url: string; size?: number }) {
  const h = hostOfUrl(url);
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
  return (
    <span className="site-tile" style={{ width: size, height: size, background: 'var(--well)', color: 'var(--text)', fontSize: size * 0.42 }} aria-hidden="true">
      {(h[0] ?? '•').toUpperCase()}
    </span>
  );
}

/** Episodes of one show sit together ("Shark Tank · 4 episodes"); everything else on its own. */
function showOf(title: string): string | null {
  const t = title.replace(/\s+[-–|·]\s+(YouTube|Netflix|Twitch|Prime Video|Disney\+)$/i, '').trim();
  const m = /^(.{3,40}?)\s*(?:[-–|:·,]\s*)?(?:S\d{1,2}\s*E\d{1,3}|Season\s+\d+|Episode\s+\d+|Ep\.?\s*\d+|Part\s+\d+|#\d+)\b/i.exec(t);
  return m ? m[1].replace(/[-–|:·,\s]+$/, '').trim() : null;
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

export function BreakView() {
  const [shelf, setShelf] = useState<BreakShelf | null>(null);
  const [asking, setAsking] = useState<string | null | 'change'>(null);
  const [adding, setAdding] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [renaming, setRenaming] = useState<{ url: string; name: string } | null>(null);
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

  const addPlace = () => {
    let url = newUrl.trim();
    if (!url) return setAdding(false);
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    let name = url;
    try {
      const h = new URL(url).hostname.replace(/^www\./, '');
      name = h.split('.')[0].replace(/^./, (c) => c.toUpperCase());
    } catch {
      return setError('That doesn’t look like a web address.');
    }
    void api.changeBreak({ addPlace: { name, url } }).then((s) => {
      setShelf(s);
      setNewUrl('');
      setAdding(false);
    }, (e) => setError(errorText(e)));
  };

  const renamePlace = () => {
    const r = renaming;
    if (!r) return;
    setRenaming(null);
    const name = r.name.trim();
    if (!name || shelf.places.find((p) => p.url === r.url)?.name === name) return;
    void api.changeBreak({ renamePlace: { url: r.url, name } }).then(setShelf, (e) => setError(errorText(e)));
  };
  const remove = (r: Row) => void Promise.all(r.items.map((it) => api.changeBreak({ removeItem: it.key }))).then((all) => all.length && setShelf(all[all.length - 1]));

  // Your places come first and largest: they're what you reach for. Under them, what you were watching sits
  // in one row of small thumbnails you scroll sideways, latest first.
  return (
    <div className="break-view nf">
      <div className="nf-label">Your places</div>
      <div className="nf-places">
        {shelf.places.map((p) =>
          renaming?.url === p.url ? (
            <form
              key={p.url}
              className="nf-place nf-place-renaming"
              onSubmit={(e) => {
                e.preventDefault();
                renamePlace();
              }}
            >
              <SiteTile url={p.url} size={44} />
              <input
                className="name-edit"
                autoFocus
                value={renaming.name}
                maxLength={40}
                aria-label={`New name for ${p.name}`}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setRenaming({ url: p.url, name: e.target.value })}
                onBlur={renamePlace}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setRenaming(null);
                  }
                }}
              />
            </form>
          ) : (
            <div key={p.url} className="nf-place-wrap">
              <button type="button" className="nf-place" onClick={() => open(p.url)} onDoubleClick={() => setRenaming({ url: p.url, name: p.name })} title={`Open ${p.name}. Double-click to rename.`}>
                <SiteTile url={p.url} size={44} />
                <span>{p.name}</span>
              </button>
              <span className="nf-place-tools">
                <button type="button" aria-label={`Rename ${p.name}`} title="Rename" onClick={() => setRenaming({ url: p.url, name: p.name })}>
                  <Icon name="pencil" />
                </button>
                <button type="button" aria-label={`Remove ${p.name}`} title="Remove" onClick={() => void api.changeBreak({ removePlace: p.url }).then(setShelf, (e) => setError(errorText(e)))}>
                  ✕
                </button>
              </span>
            </div>
          ),
        )}
        {adding ? (
          <form
            className="nf-place-form"
            onSubmit={(e) => {
              e.preventDefault();
              addPlace();
            }}
          >
            <input className="field small" autoFocus value={newUrl} placeholder="twitch.tv" aria-label="Web address to add" onChange={(e) => setNewUrl(e.target.value)} onBlur={addPlace} />
          </form>
        ) : (
          <button type="button" className="nf-place" onClick={() => setAdding(true)} title="Add a place">
            <span className="nf-add" aria-hidden="true">
              <Icon name="plus" />
            </span>
            <span>Add</span>
          </button>
        )}
      </div>

      <div className="nf-label">Continue watching</div>
      {list.length > 0 ? (
        <div className={`nf-row ${list.length > 2 ? 'more' : ''}`}>
          {list.map((r, i) => (
            <motion.div key={r.key} className="nf-card" initial={{ opacity: 0, transform: 'translateY(4px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} transition={{ duration: 0.2, delay: Math.min(i, 4) * 0.03 }}>
              <button type="button" className="nf-card-hit" onClick={() => open(r.url)} title={`${i === 0 ? 'Resume' : 'Open'} ${r.title}`}>
                <span className="nf-card-art">
                  <Artwork url={r.url} />
                  {r.items.length > 1 && <span className="nf-badge">{r.items.length} episodes</span>}
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
        </div>
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
