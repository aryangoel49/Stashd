// The app window. "All folders" shows every folder as a card in its own colour; open one to see its
// brief and everything inside as cards you can click to reopen. Drag a card onto another folder in
// the sidebar to move it. The layout reflows to any window size, full screen included.

import { useCallback, useEffect, useState } from 'react';
import type { BriefView, Item, JobSummary } from '../shared/types';
import { api, errorText, prettyShortcut, timeAgo, useSettings } from './api';
import { BriefCard } from './BriefCard';
import { Icon } from './icons';
import { SettingsView } from './SettingsView';
import { AnimatePresence, Button, FolderMark, motion, Motion } from './ui';
import { BadgeStrip, describe, folderTone, ItemBadge, titleOf, toneStyle } from './visuals';

type View = 'home' | 'settings' | string;

export function Main() {
  return (
    <Motion>
      <MainView />
    </Motion>
  );
}

function MainView() {
  const settings = useSettings();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [view, setView] = useState<View>('home');
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const load = useCallback(() => {
    void api.listJobs().then((list) => {
      setJobs(list);
      setView((cur) => (cur === 'home' || cur === 'settings' || list.some((j) => j.id === cur) ? cur : 'home'));
    });
  }, []);

  useEffect(() => {
    load();
    const offs = [api.onJobsChanged(load), api.onMainShow((v) => (v === 'settings' ? setView('settings') : load()))];
    return () => offs.forEach((o) => o());
  }, [load]);

  const active = jobs.filter((j) => !j.done);
  const done = jobs.filter((j) => j.done);

  const row = (j: JobSummary) => (
    <button
      key={j.id}
      className={`side-row ${view === j.id ? 'on' : ''} ${dropTarget === j.id ? 'drop' : ''}`}
      style={toneStyle(folderTone(j.id))}
      onClick={() => setView(j.id)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-wwi-item') && view !== j.id) {
          e.preventDefault();
          setDropTarget(j.id);
        }
      }}
      onDragLeave={() => setDropTarget(null)}
      onDrop={(e) => {
        e.preventDefault();
        setDropTarget(null);
        const raw = e.dataTransfer.getData('application/x-wwi-item');
        if (!raw) return;
        const { from, key } = JSON.parse(raw) as { from: string; key: string };
        void api.moveItem(from, key, j.id);
      }}
    >
      <FolderMark size={22} awake={j.current} tone={folderTone(j.id)} />
      <span className="grow">
        <span className="t">{j.name}</span>
        <span className="s">{j.current ? 'Open now' : timeAgo(j.updatedAt)}</span>
      </span>
      {j.current && <span className="live" />}
    </button>
  );

  return (
    <div className="main-grid">
      <aside className="side">
        <div className="drag" style={{ height: 44 }} />
        <div className="side-brand drag">
          <FolderMark size={26} awake />
          <span className="display" style={{ fontSize: 16 }}>Stashd</span>
        </div>
        <button className={`side-row ${view === 'home' ? 'on' : ''}`} onClick={() => setView('home')}>
          <Icon name="stack" />
          <span className="grow">
            <span className="t">All folders</span>
          </span>
          <span className="faint tiny">{jobs.length}</span>
        </button>
        <div className="side-title">Folders</div>
        <div className="side-list">
          {active.map(row)}
          {done.length > 0 && <div className="side-title" style={{ marginTop: 14 }}>Finished</div>}
          {done.map(row)}
        </div>
        <div className="side-foot">
          <button className={`side-row ${view === 'settings' ? 'on' : ''}`} onClick={() => setView('settings')}>
            <Icon name="gear" />
            <span className="grow">
              <span className="t">Settings</span>
            </span>
          </button>
        </div>
      </aside>
      <main className="content">
        <div className="drag" style={{ height: 30, position: 'sticky', top: 0, zIndex: 2 }} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {view === 'settings' ? (
              <SettingsView />
            ) : view === 'home' ? (
              <Home jobs={jobs} onOpen={setView} shortcut={settings ? prettyShortcut(settings.shortcutSave) : '⌃S'} />
            ) : (
              <JobDetail jobId={view} jobs={jobs} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

// ---------- all folders ----------

function Home({ jobs, onOpen, shortcut }: { jobs: JobSummary[]; onOpen: (id: string) => void; shortcut: string }) {
  if (!jobs.length) {
    return (
      <div className="empty" style={{ paddingTop: 90 }}>
        <FolderMark size={64} />
        <div className="display" style={{ marginTop: 14 }}>Nothing stashed yet</div>
        <p>
          Press <span className="kbd">{shortcut}</span> while you're working to make your first folder.
        </p>
      </div>
    );
  }
  const active = jobs.filter((j) => !j.done);
  const done = jobs.filter((j) => j.done);
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Stashd</div>
          <h1 className="page-title">All folders</h1>
        </div>
        <span className="muted small">
          {active.length} {active.length === 1 ? 'folder' : 'folders'}
          {done.length ? ` · ${done.length} finished` : ''}
        </span>
      </header>
      <div className="folder-grid">
        {[...active, ...done].map((j, i) => (
          <FolderCard key={j.id} job={j} index={i} onOpen={() => onOpen(j.id)} />
        ))}
      </div>
    </div>
  );
}

function FolderCard({ job, index, onOpen }: { job: JobSummary; index: number; onOpen: () => void }) {
  const tone = folderTone(job.id);
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);
  const counts = [
    job.counts.tabs && `${job.counts.tabs} ${job.counts.tabs === 1 ? 'tab' : 'tabs'}`,
    job.counts.files && `${job.counts.files} ${job.counts.files === 1 ? 'file' : 'files'}`,
    job.counts.apps && `${job.counts.apps} ${job.counts.apps === 1 ? 'app' : 'apps'}`,
  ].filter(Boolean);
  return (
    <motion.div
      className={`folder-card ${job.done ? 'is-done' : ''}`}
      style={toneStyle(tone)}
      layout
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: Math.min(index, 10) * 0.035 }}
      whileHover={{ y: -3 }}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <div className="folder-card-top">
        <motion.span animate={{ rotate: hover ? -6 : 0, scale: hover ? 1.06 : 1 }}>
          <FolderMark size={44} awake={hover || job.current} tone={tone} />
        </motion.span>
        {job.current && <span className="tag-live">Open now</span>}
      </div>
      <div className="folder-card-name">{job.name}</div>
      <div className="folder-card-meta">
        {timeAgo(job.updatedAt)}
        {counts.length > 0 && ` · ${counts.join(' · ')}`}
      </div>
      {job.hint && <div className="folder-card-hint">{job.hint}</div>}
      <div className="folder-card-foot">
        <BadgeStrip items={job.preview} />
        {!job.current && (
          <Button
            size="small"
            className="tone-btn"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              setBusy(true);
              void api.openJob(job.id, null, 'needed').finally(() => setBusy(false));
            }}
          >
            {busy ? <span className="spinner" /> : 'Unpack'}
          </Button>
        )}
      </div>
    </motion.div>
  );
}

// ---------- one folder ----------

function JobDetail({ jobId, jobs }: { jobId: string; jobs: JobSummary[] }) {
  const [entryId, setEntryId] = useState<string | undefined>(undefined);
  const [view, setView] = useState<BriefView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tone = folderTone(jobId);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api.getBrief(jobId, entryId).then(
        (v) => !cancelled && setView(v),
        (e) => !cancelled && setError(errorText(e)),
      );
    void load();
    const off = api.onJobsChanged(() => void load());
    return () => {
      cancelled = true;
      off();
    };
  }, [jobId, entryId]);

  if (error) return <div className="banner" style={{ margin: 24 }}>{error}</div>;
  if (!view) return <div className="muted" style={{ padding: 28 }}><span className="spinner" /> Getting your folder…</div>;
  const latest = view.history[0]?.id === view.entry.id;
  const others = jobs.filter((j) => j.id !== jobId && !j.done);
  const items = view.entry.items;
  const groups: [string, Item[]][] = [
    ['Tabs', items.filter((i) => i.kind === 'tab')],
    ['Files', items.filter((i) => i.kind === 'doc' || i.kind === 'folder')],
    ['Apps', items.filter((i) => i.kind === 'app')],
  ];

  return (
    <div className="page" style={toneStyle(tone)}>
      <header className="detail-hero">
        <motion.span initial={{ scale: 0.7, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 18 }}>
          <FolderMark size={56} awake={jobs.find((j) => j.id === jobId)?.current} tone={tone} />
        </motion.span>
        <div className="grow">
          <div className="eyebrow tone-ink">{tone.name} folder</div>
          <h1 className="page-title">{view.job.name}</h1>
        </div>
      </header>

      <div className="detail-cols">
        <div className="glass-card brief-col">
          <BriefCard view={view} hideTitle />
        </div>

        <div className="items-col">
          {groups.map(
            ([label, list]) =>
              list.length > 0 && (
                <section key={label}>
                  <div className="section-head">
                    <h3>
                      {label} <span className="faint">{list.length}</span>
                    </h3>
                    {label === 'Tabs' && latest && others.length > 0 && <span className="faint tiny">Drag a card onto a folder on the left to move it</span>}
                  </div>
                  <div className="item-grid">
                    {list.map((it, i) => (
                      <ItemCard key={it.key} item={it} index={i} jobId={jobId} front={it.key === view.entry.frontKey} editable={latest} />
                    ))}
                  </div>
                </section>
              ),
          )}
          {items.length === 0 && <span className="faint small">Empty</span>}

          <section>
            <div className="section-head">
              <h3>History</h3>
              <span className="faint tiny">{view.history.length} {view.history.length === 1 ? 'save' : 'saves'}</span>
            </div>
            <div className="history">
              {view.history.map((h, i) => (
                <button key={h.id} className={`hist ${h.id === view.entry.id ? 'on' : ''}`} onClick={() => setEntryId(i === 0 ? undefined : h.id)} title={h.note || 'No note'}>
                  <span>{new Date(h.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  <span className="faint">{new Date(h.savedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                </button>
              ))}
            </div>
            {!latest && <div className="muted small" style={{ marginTop: 8 }}>You're looking at an older save. Reopening it opens what was open back then.</div>}
          </section>
        </div>
      </div>
    </div>
  );
}

/** One tab, file or app. Click to open just that; drag onto another folder to move it. */
function ItemCard({ item, index, jobId, front, editable }: { item: Item; index: number; jobId: string; front: boolean; editable: boolean }) {
  const [state, setState] = useState<'idle' | 'opening' | 'opened' | 'missing'>('idle');
  const open = () => {
    setState('opening');
    api.openItem(jobId, item.key).then(
      (r) => setState(r.opened || r.alreadyOpen ? 'opened' : 'missing'),
      () => setState('missing'),
    );
    setTimeout(() => setState('idle'), 2200);
  };
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 12) * 0.025 }}>
    <div
      className={`item-card ${front ? 'front' : ''} ${state}`}
      draggable={editable}
      onDragStart={(e) => e.dataTransfer.setData('application/x-wwi-item', JSON.stringify({ from: jobId, key: item.key }))}
      onClick={open}
      onKeyDown={(e) => e.key === 'Enter' && open()}
      role="button"
      tabIndex={0}
      title={`${item.label}\n${item.url ?? item.path ?? item.detail}${front ? '\nYou were on this last' : ''}\nClick to open`}
    >
      <ItemBadge item={item} size={32} />
      <span className="grow">
        <span className="item-title">{titleOf(item)}</span>
        <span className="item-sub">
          {state === 'opening' ? 'Opening…' : state === 'opened' ? 'Opened' : state === 'missing' ? "Couldn't find it" : describe(item)}
        </span>
      </span>
      {front && <span className="pill-dot" title="You were on this last" />}
      {editable && (
        <button
          className="x"
          aria-label={`Remove ${item.label}`}
          title="Take out of this folder"
          onClick={(e) => {
            e.stopPropagation();
            void api.removeItem(jobId, item.key);
          }}
        >
          ✕
        </button>
      )}
    </div>
    </motion.div>
  );
}
