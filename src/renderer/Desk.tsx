// Tidy all's desk: before anything closes, what's open now, already sorted into piles (into a folder,
// onto the Break shelf, closing, apps quitting, staying open). One button does it all. Choices are there
// only if you want them: open a pile and tap something to keep it open.

import { useEffect, useMemo, useState } from 'react';
import type { DeskPile, Item, Settings, TidyDesk } from '../shared/types';
import { api, errorText, prettyShortcut } from './api';
import { Icon } from './icons';
import { AnimatePresence, Button, FolderMark, motion } from './ui';
import { SiteTile } from './Break';
import { folderTone, ItemBadge, titleOf, toneStyle, useMacIcon } from './visuals';

/** An app's real icon, from where it lives on this Mac. */
function AppIcon({ item, size }: { item: Item; size: number }) {
  const icon = useMacIcon(item.path!);
  if (icon) return <img className="badge-icon badge-app" src={icon} width={size} height={size} alt="" aria-hidden="true" draggable={false} />;
  return <ItemBadge item={item} size={size} />;
}

/** A tab shows its site's own logo (or its browser's icon if the site has none); documents and apps their real icons. */
function Thing({ item, size }: { item: Item; size: number }) {
  if (item.kind === 'tab' && item.url) return <SiteTile url={item.url} size={size} fallback={<ItemBadge item={item} size={size} />} />;
  if (item.kind === 'app' && item.path) return <AppIcon item={item} size={size} />;
  return <ItemBadge item={item} size={size} />;
}

/** What a thing is called, short: "Logitech MX Master 3S - Amazon.com" → "Logitech MX Master 3S". */
function shortTitle(item: Item): string {
  const t = item.kind === 'app' ? item.app.replace(/^(Google|Microsoft) /, '') : titleOf(item).split(/\s+[-–|·:]\s+/)[0].trim();
  return t.length > 26 ? `${t.slice(0, 24).trimEnd()}…` : t;
}

/** A hint at what's going, one short line each: "Quits Chrome, Slack and 5 more apps", "Closes Hacker News and 4 more tabs". */
function hint(piles: DeskPile[]): string[] {
  // Apps have short names, so two fit; a tab's title is longer, so one.
  const line = (verb: string, items: Item[], show: number, noun: string) => {
    const names = [...new Set(items.map(shortTitle))];
    if (!names.length) return '';
    if (names.length <= show) return `${verb} ${names.join(' and ')}`;
    const rest = names.length - show;
    return `${verb} ${names.slice(0, show).join(', ')} and ${rest} more ${rest === 1 ? noun : `${noun}s`}`;
  };
  return [
    line('Quits', piles.filter((p) => p.kind === 'apps').flatMap((p) => p.items), 2, 'app'),
    line('Closes', piles.filter((p) => p.kind === 'close').flatMap((p) => p.items), 1, 'tab'),
  ].filter(Boolean);
}

/** A pile's first few things, fanned like cards. */
function Stack({ items }: { items: Item[] }) {
  const shown = items.slice(0, 5);
  return (
    <span className="desk-stack" aria-hidden="true">
      {shown.map((i, n) => (
        <span key={i.key} title={shortTitle(i)} className="desk-stack-card" style={{ zIndex: shown.length - n }}>
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
          title={shortTitle(i)}
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

/**
 * Your Mac's memory as a bar: what's in use, with the part the quitting apps hold marked at its end.
 * The numbers are Activity Monitor's ("Memory Used", and each app's own memory).
 */
function MemoryBar({ used, free, total }: { used: number; free: number; total: number }) {
  const pct = (mb: number) => `${Math.max(0, Math.min(100, (mb / total) * 100))}%`;
  return (
    <span className="desk-mem">
      <span className="mem-bar" aria-hidden="true">
        <span className="mem-used" style={{ width: pct(used - free) }} />
        {free > 0 && <motion.span className="mem-freeable" style={{ left: pct(used - free), width: pct(free) }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} />}
      </span>
      <span className="desk-mem-text">
        {free > 0 ? (
          <>
            About <b>{memoryLabel(free)}</b> to free · {memoryLabel(used)} of {memoryLabel(total, 0)} in use
          </>
        ) : (
          <>
            {memoryLabel(used)} of {memoryLabel(total, 0)} in use
          </>
        )}
      </span>
    </span>
  );
}

const memoryLabel = (mb: number, digits = 1) => (mb >= 1024 ? `${(mb / 1024).toFixed(digits)} GB` : `${Math.round(mb)} MB`);

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
  // What the apps that quit use now (as Activity Monitor counts it): roughly what Tidy up gives back.
  const freeable = desk ? piles.filter((p) => p.kind === 'apps').flatMap((p) => p.items).reduce((n, i) => n + (desk.appMB[i.key] ?? 0), 0) : 0;
  const showFree = freeable >= 100;

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
          {hint(piles).map((h) => (
            <span key={h} className="desk-hero-hint" title={h}>
              {h}
            </span>
          ))}
          {desk.memoryMB ? <MemoryBar used={desk.memoryMB} free={showFree ? freeable : 0} total={desk.totalMB} /> : null}
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
                            {p.kind === 'apps' && (desk.appMB[i.key] ?? 0) >= 50 && <span className="desk-item-mem">{memoryLabel(desk.appMB[i.key])}</span>}
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
            <Icon name="spark" /> {showFree ? `Tidy up and free about ${memoryLabel(freeable)}` : `Tidy up ${goingCount} ${goingCount === 1 ? 'thing' : 'things'}`}
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
