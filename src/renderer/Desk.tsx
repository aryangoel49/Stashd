// Tidy all's desk: before anything closes, what's open now, already sorted into piles (into a folder,
// onto the Break shelf, closing, apps quitting, staying open). One button does it all. Choices are there
// only if you want them: open a pile and tap something to keep it open.

import { useEffect, useMemo, useState } from 'react';
import type { DeskPile, Item, Settings, TidyDesk } from '../shared/types';
import { api, errorText, prettyShortcut } from './api';
import { Icon } from './icons';
import { AnimatePresence, Button, FolderMark, motion } from './ui';
import { SiteTile } from './Break';
import { folderTone, ItemBadge, titleOf, toneStyle } from './visuals';

/** A tab shows its site's own logo; documents and apps their real icons. */
function Thing({ item, size }: { item: Item; size: number }) {
  if (item.kind === 'tab' && item.url) return <SiteTile url={item.url} size={size} />;
  return <ItemBadge item={item} size={size} />;
}

/** A pile's first few things, fanned like cards. */
function Stack({ items }: { items: Item[] }) {
  const shown = items.slice(0, 5);
  return (
    <span className="desk-stack" aria-hidden="true">
      {shown.map((i, n) => (
        <span key={i.key} className="desk-stack-card" style={{ zIndex: shown.length - n }}>
          <Thing item={i} size={24} />
        </span>
      ))}
      {items.length > shown.length && <span className="desk-stack-more">+{items.length - shown.length}</span>}
    </span>
  );
}

function PileMark({ pile }: { pile: DeskPile }) {
  if (pile.kind === 'folder') return <FolderMark size={22} tone={folderTone(pile.id.replace(/^folder:/, ''))} />;
  const icon = pile.kind === 'break' ? 'home' : pile.kind === 'apps' ? 'power' : pile.kind === 'stay' ? 'pin' : 'trash';
  return (
    <span className={`desk-mark ${pile.kind}`}>
      <Icon name={icon} />
    </span>
  );
}

/** Everything going, as one loose fan of icons (the first few, a count for the rest). */
function HeroStack({ items }: { items: Item[] }) {
  // One icon per site or app, so twelve Google Docs tabs don't fill the row.
  const seen = new Set<string>();
  const unique = items.filter((i) => {
    const id = i.kind === 'tab' && i.url ? (() => { try { return new URL(i.url).hostname; } catch { return i.key; } })() : i.app || i.key;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const shown = unique.slice(0, 7);
  const mid = (shown.length - 1) / 2;
  return (
    <span className="desk-hero-stack" aria-hidden="true">
      {shown.map((i, n) => (
        <motion.span
          key={i.key}
          className="desk-hero-card"
          style={{ zIndex: 10 - Math.abs(Math.round(n - mid)) }}
          initial={{ opacity: 0, y: 10, rotate: 0 }}
          animate={{ opacity: 1, y: Math.abs(n - mid) * 2, rotate: (n - mid) * 5 }}
          transition={{ type: 'spring', duration: 0.5, bounce: 0.2, delay: 0.04 * n }}
        >
          <Thing item={i} size={34} />
        </motion.span>
      ))}
    </span>
  );
}

const RANK: Record<Item['kind'], number> = { app: 0, doc: 1, folder: 2, tab: 3 };

/** "Into 2 folders · 2 for later · 5 closed · 7 apps" */
function summary(piles: DeskPile[]): string {
  const n = (kind: DeskPile['kind']) => piles.filter((p) => p.kind === kind).reduce((c, p) => c + p.items.length, 0);
  const folders = piles.filter((p) => p.kind === 'folder' && p.items.length).length;
  return [
    folders ? `Into ${folders} ${folders === 1 ? 'folder' : 'folders'}` : '',
    n('break') ? `${n('break')} for later` : '',
    n('close') ? `${n('close')} closed` : '',
    n('apps') ? `${n('apps')} ${n('apps') === 1 ? 'app' : 'apps'}` : '',
  ].filter(Boolean).join(' · ');
}

const memoryLabel = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);

export function TidyDeskView({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const [desk, setDesk] = useState<TidyDesk | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Things you tapped to keep open, and (if you keep what you're on) whether you let that one go after all.
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [frontGoes, setFrontGoes] = useState(false);
  const [openPile, setOpenPile] = useState<string | null>(null);
  // Starts as a calm summary; the piles (and every tab in them) are one click away.
  const [details, setDetails] = useState(false);
  const [going, setGoing] = useState(false);
  const keepFront = settings.tidyKeep === 'front';

  useEffect(() => {
    let live = true;
    void api.tidyDesk(settings.tidyKeep).then(
      (d) => live && setDesk(d),
      (e) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [settings.tidyKeep]);

  // What you keep moves to "Staying open"; everything else stays in its pile.
  const piles = useMemo(() => {
    if (!desk) return [];
    const kept = desk.piles.flatMap((p) => (p.kind === 'stay' ? [] : p.items.filter((i) => keep.has(i.key))));
    return desk.piles
      .map((p) => (p.kind === 'stay' ? { ...p, items: [...p.items, ...kept] } : { ...p, items: p.items.filter((i) => !keep.has(i.key)) }))
      .filter((p) => p.items.length || p.kind === 'stay');
  }, [desk, keep]);
  const goingCount = piles.filter((p) => p.kind !== 'stay').reduce((n, p) => n + p.items.length, 0) + (frontGoes ? 1 : 0);

  const go = () => {
    if (!desk || going || !goingCount) return;
    setGoing(true);
    // The piles lift away first, then the panel steps aside and everything flies into the menu bar.
    setTimeout(() => void api.tidyAll(keepFront && !frontGoes ? 'front' : 'all', { keep: [...keep] }), 420);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (openPile) setOpenPile(null);
        else if (details) setDetails(false);
        else onClose();
      } else if (e.key === 'Enter' && !(e.target as HTMLElement | null)?.closest('button, input, textarea')) {
        e.preventDefault();
        go();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const toggle = (pile: DeskPile, item: Item) => {
    if (desk && item.key === desk.frontKey && keepFront && !keep.has(item.key)) return setFrontGoes(!frontGoes);
    const next = new Set(keep);
    if (next.has(item.key)) next.delete(item.key);
    else if (pile.kind !== 'stay') next.add(item.key);
    setKeep(next);
  };
  // Everyday sites and Claude always stay; what you kept (or what you're on) can go back.
  const canToggle = (pile: DeskPile, item: Item) => pile.kind !== 'stay' || keep.has(item.key) || (keepFront && item.key === desk?.frontKey);

  return (
    <div className="desk">
      <div className="desk-head">
        <Button variant="ghost" size="small" onClick={onClose} style={{ paddingLeft: 2 }} aria-label="Back to folders">
          <Icon name="back" />
        </Button>
        <span className="grow desk-title">Clear your desk</span>
        {desk && details && (
          <button type="button" className="desk-less" onClick={() => setDetails(false)}>
            Less
          </button>
        )}
      </div>

      {error && <div className="banner">{error}</div>}

      {!desk && !error && (
        <div className="desk-hero" aria-busy="true">
          <span className="desk-hero-stack skeleton" />
          <span className="desk-hero-line muted">Looking at what’s open…</span>
        </div>
      )}

      {desk && goingCount === 0 && !piles.some((p) => p.kind !== 'stay') && (
        <motion.div className="desk-clear" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <FolderMark size={44} alive mood="happy" />
          <b>Your desk is already clear</b>
          <span className="muted small">Nothing to put away.</span>
        </motion.div>
      )}

      {desk && !details && goingCount > 0 && (
        <motion.div className="desk-hero" initial={{ opacity: 0, y: 6 }} animate={going ? { opacity: 0, y: -16, scale: 0.97 } : { opacity: 1, y: 0, scale: 1 }} transition={going ? { duration: 0.3, ease: [0.4, 0, 1, 1] } : { type: 'spring', duration: 0.45, bounce: 0.12 }}>
          {/* Apps and documents lead (their icons are clearest), then videos, then tabs. */}
          <HeroStack items={[...(['apps', 'folder', 'break', 'close'] as const)].flatMap((k) => piles.filter((p) => p.kind === k).flatMap((p) => p.items)).sort((a, b) => RANK[a.kind] - RANK[b.kind])} />
          <span className="desk-hero-count">
            <b>{goingCount}</b> {goingCount === 1 ? 'thing' : 'things'} to put away
          </span>
          <span className="desk-hero-line">{summary(piles)}</span>
          {desk.memoryMB ? <span className="desk-hero-mem">Your Mac is using {memoryLabel(desk.memoryMB)}</span> : null}
        </motion.div>
      )}

      {desk && details && (
        <div className="desk-piles">
          <AnimatePresence initial={true}>
            {piles.map((p, n) => {
              const expanded = openPile === p.id;
              const frontLeaving = (i: Item) => frontGoes && i.key === desk.frontKey;
              return (
                <motion.div
                  key={p.id}
                  layout
                  className={`desk-pile ${p.kind} ${expanded ? 'open' : ''}`}
                  style={p.kind === 'folder' ? toneStyle(folderTone(p.id.replace(/^folder:/, ''))) : undefined}
                  initial={{ opacity: 0, y: 8 }}
                  animate={going ? (p.kind === 'stay' ? { opacity: 1, y: 0 } : { opacity: 0, y: -18, scale: 0.96 }) : { opacity: 1, y: 0, scale: 1 }}
                  transition={going ? { duration: 0.28, delay: n * 0.05, ease: [0.4, 0, 1, 1] } : { type: 'spring', duration: 0.4, bounce: 0.1, delay: Math.min(n, 6) * 0.04 }}
                >
                  <button type="button" className="desk-pile-top" onClick={() => setOpenPile(expanded ? null : p.id)} aria-expanded={expanded} disabled={!p.items.length}>
                    <PileMark pile={p} />
                    <span className="grow desk-pile-text">
                      <span className="desk-pile-title">
                        {p.kind === 'folder' ? `Into ${p.title}` : p.title}
                      </span>
                      <span className="desk-pile-note">{p.items.length ? p.note || (p.kind === 'stay' ? 'Left just as it is' : '') : 'Nothing'}</span>
                    </span>
                    {!expanded && <Stack items={p.items} />}
                    <span className="desk-count">{p.items.length}</span>
                  </button>
                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.div className="desk-items" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>
                        {p.items.map((i) => (
                          <div key={i.key} className={`desk-item ${frontLeaving(i) ? 'leaving' : ''}`}>
                            <Thing item={i} size={20} />
                            <span className="grow desk-item-title" title={titleOf(i)}>
                              {titleOf(i)}
                            </span>
                            {canToggle(p, i) && (
                              <button type="button" className="desk-keep" onClick={() => toggle(p, i)}>
                                {p.kind === 'stay' ? (frontLeaving(i) ? 'Keep open' : 'Put away') : 'Keep open'}
                              </button>
                            )}
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {desk && goingCount > 0 && (
        <div className="desk-foot">
          <Button variant="primary" className="desk-go" disabled={going} onClick={go}>
            <Icon name="spark" /> Tidy up {goingCount} {goingCount === 1 ? 'thing' : 'things'}
            <span className="enter">↵</span>
          </Button>
          {!details ? (
            <button type="button" className="desk-more" onClick={() => setDetails(true)}>
              See what’s going <Icon name="chevron" />
            </button>
          ) : (
            <span className="faint small">Open a pile to keep something open · {prettyShortcut(settings.shortcutTidy)} skips this view</span>
          )}
        </div>
      )}
    </div>
  );
}
