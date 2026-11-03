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

/** A site's own little tile: its colour and mark, so YouTube looks like YouTube. */
function siteLook(url: string): { bg: string; fg: string; mark: string } {
  let h = '';
  try {
    h = new URL(url).hostname.replace(/^(www|m)\./, '');
  } catch {
    // keep the plain tile
  }
  if (/youtube\.com|youtu\.be/.test(h)) return { bg: '#ff0033', fg: '#fff', mark: '▶' };
  if (/netflix\.com/.test(h)) return { bg: '#141414', fg: '#e50914', mark: 'N' };
  if (/spotify\.com/.test(h)) return { bg: '#1db954', fg: '#0b2a14', mark: '♫' };
  if (/twitch\.tv/.test(h)) return { bg: '#9146ff', fg: '#fff', mark: 'T' };
  if (/primevideo\.com/.test(h)) return { bg: '#1a98ff', fg: '#fff', mark: 'P' };
  if (/disneyplus\.com/.test(h)) return { bg: '#0b1e5b', fg: '#fff', mark: 'D' };
  if (/espn\.com/.test(h)) return { bg: '#d50a0a', fg: '#fff', mark: 'E' };
  return { bg: 'var(--well)', fg: 'var(--text)', mark: (h[0] ?? '•').toUpperCase() };
}

function SiteTile({ url, size = 30 }: { url: string; size?: number }) {
  const l = siteLook(url);
  return (
    <span className="site-tile" style={{ width: size, height: size, background: l.bg, color: l.fg, fontSize: size * 0.45 }} aria-hidden="true">
      {l.mark}
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
  for (const it of items) {
    const show = showOf(it.label);
    const site = it.detail || (it.url ? new URL(it.url).hostname.replace(/^www\./, '') : '');
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
