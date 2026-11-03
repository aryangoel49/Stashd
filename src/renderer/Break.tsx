// The Break side of the menu bar panel: what you were watching or listening to (put here by Tidy all),
// your places (YouTube, Netflix…), and where they open. The first time you open something it asks which
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

type Row = { key: string; title: string; sub: string; url: string; items: BreakItem[] };

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
        row.sub = `${row.items.length} episodes · ${site}`;
        continue;
      }
      const r: Row = { key: `show:${id}`, title: show, sub: site, url: it.url!, items: [it] };
      shows.set(id, r);
      out.push(r);
    } else {
      out.push({ key: it.key, title: it.label.replace(/\s+[-–|·]\s+YouTube$/i, ''), sub: `${site}${it.savedAt ? ` · ${timeAgo(it.savedAt)}` : ''}`, url: it.url!, items: [it] });
    }
  }
  return out;
}

export function BreakView() {
  const [shelf, setShelf] = useState<BreakShelf | null>(null);
  const [asking, setAsking] = useState<string | null | 'change'>(null);
  const [adding, setAdding] = useState(false);
  const [newUrl, setNewUrl] = useState('');
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

  return (
    <div className="break-view">
      {list.length > 0 ? (
        <>
          <div className="eyebrow list-label">Pick up where you left off</div>
          <div className="break-rows">
            {list.slice(0, 6).map((r, i) => (
              <motion.div key={r.key} className="break-row" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 6) * 0.03 }}>
                <button type="button" className="break-main" onClick={() => open(r.url)} title={`Open ${r.title}`}>
                  <SiteTile url={r.url} />
                  <span className="grow">
                    <span className="break-title">{r.title}</span>
                    <span className="break-sub">{r.sub}</span>
                  </span>
                  <span className="break-play" aria-hidden="true">▶</span>
                </button>
                <Button
                  variant="ghost"
                  size="small"
                  className="tool-btn delete"
                  aria-label={`Remove ${r.title}`}
                  title="Remove from the shelf"
                  onClick={() => void Promise.all(r.items.map((it) => api.changeBreak({ removeItem: it.key }))).then((all) => all.length && setShelf(all[all.length - 1]))}
                >
                  <Icon name="trash" />
                </Button>
              </motion.div>
            ))}
          </div>
        </>
      ) : (
        <div className="break-empty">
          <FolderMark size={34} mood="sleep" />
          <span>When you Tidy all, what you were watching lands here, ready to pick up.</span>
        </div>
      )}

      <div className="eyebrow list-label">Your places</div>
      <div className="place-grid">
        {shelf.places.map((p) => (
          <button key={p.url} type="button" className="place" onClick={() => open(p.url)} title={`Open ${p.name}`}>
            <SiteTile url={p.url} size={36} />
            <span>{p.name}</span>
          </button>
        ))}
        {adding ? (
          <form
            className="place-add"
            onSubmit={(e) => {
              e.preventDefault();
              addPlace();
            }}
          >
            <input className="field small" autoFocus value={newUrl} placeholder="twitch.tv" aria-label="Web address to add" onChange={(e) => setNewUrl(e.target.value)} onBlur={addPlace} />
          </form>
        ) : (
          <button type="button" className="place" onClick={() => setAdding(true)} title="Add a place">
            <span className="site-tile add" style={{ width: 36, height: 36 }} aria-hidden="true">
              <Icon name="plus" />
            </span>
            <span>Add</span>
          </button>
        )}
      </div>

      <div className="break-foot">
        <span>{shelf.browser ? `Opens in ${whereLabel(shelf.browser)}` : 'Asks where to open the first time'}</span>
        <button type="button" className="link small" onClick={() => setAsking('change')}>
          Change
        </button>
      </div>
      {error && <div className="banner">{error}</div>}
    </div>
  );
}
