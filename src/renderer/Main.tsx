// The app window. "All folders" shows every folder as a card in its own colour; open one to see its
// brief and everything inside as cards you can click to reopen. Drag a card onto another folder in
// the sidebar to move it. The layout reflows to any window size, full screen included.

import { useCallback, useEffect, useState } from 'react';
import type { BriefView, Item, JobSummary, OpenState, Suggestion } from '../shared/types';
import { api, errorText, prettyShortcut, timeAgo, useSettings } from './api';
import { BriefCard } from './BriefCard';
import { Icon } from './icons';
import { SettingsView } from './SettingsView';
import { FolderMergeHint, SuggestionStrip, useSuggestions } from './Suggestions';
import { AnimatePresence, Button, FolderMark, motion, Motion } from './ui';
import { describe, folderTone, ItemBadge, titleOf, toneStyle } from './visuals';

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
  const [showFinished, setShowFinished] = useState(false);

  const load = useCallback(() => {
    void api.listJobs().then((list) => {
      setJobs(list);
      setView((cur) => (cur === 'home' || cur === 'settings' || list.some((j) => j.id === cur) ? cur : 'home'));
    });
  }, []);

  useEffect(() => {
    load();
    const offs = [
      api.onJobsChanged(load),
      api.onMainShow((v) => {
        // "Open Stashd" always lands on your folders; only the gear opens Settings.
        setView(v === 'settings' ? 'settings' : 'home');
        load();
      }),
    ];
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
          <FolderMark size={26} awake alive />
          <span className="display" style={{ fontSize: 16 }}>Stashd</span>
        </div>
        <nav className="side-nav">
          <button className={`side-row nav ${view === 'home' ? 'on' : ''}`} onClick={() => setView('home')}>
            <Icon name="home" />
            <span className="grow">
              <span className="t">Home</span>
            </span>
            <span className="side-count">{active.length}</span>
          </button>
          <button className="side-row nav soon" disabled title="Ask about your folders and pick up work by chatting. Coming in a future version.">
            <Icon name="spark" />
            <span className="grow">
              <span className="t">Ask Stashd</span>
            </span>
            <span className="soon-tag">Soon</span>
          </button>
        </nav>
        <div className="side-title">Folders</div>
        <div className="side-list">
          {active.map(row)}
          {active.length === 0 && <div className="faint small" style={{ padding: '4px 10px' }}>No folders yet</div>}
          {done.length > 0 && (
            <button className="side-title side-toggle" onClick={() => setShowFinished(!showFinished)}>
              <motion.span animate={{ rotate: showFinished ? 90 : 0 }} style={{ display: 'inline-flex' }}>
                <Icon name="chevron" />
              </motion.span>
              Finished <span className="faint">{done.length}</span>
            </button>
          )}
          {showFinished && done.map(row)}
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
  const [query, setQuery] = useState('');
  const [openMap, setOpenMap] = useState<Record<string, OpenState>>({});
  useEffect(() => {
    api.openState().then(setOpenMap, () => undefined);
  }, [jobs]);
  const [showFinished, setShowFinished] = useState(false);

  const q = query.trim().toLowerCase();
  const matches = (j: JobSummary) => !q || j.name.toLowerCase().includes(q) || j.hint.toLowerCase().includes(q) || j.preview.some((i) => i.label.toLowerCase().includes(q));
  const order = (list: JobSummary[]) => [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const current = jobs.filter((j) => j.current && !j.done && matches(j));
  const active = order(jobs.filter((j) => !j.current && !j.done && matches(j)));
  const done = order(jobs.filter((j) => j.done && matches(j)));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Home</div>
          <h1 className="page-title">Your folders</h1>
        </div>
        <Button variant="primary" onClick={() => void api.openWindow('save')} title="Save what's open into a folder">
          <Icon name="plus" /> Stash what's open <span className="enter">{shortcut}</span>
        </Button>
      </header>

      {jobs.length === 0 ? (
        <div className="empty" style={{ paddingTop: 60 }}>
          <FolderMark size={64} />
          <div className="display" style={{ marginTop: 14 }}>Nothing stashed yet</div>
          <p>
            Press <span className="kbd">{shortcut}</span> while you're working to make your first folder.
          </p>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <label className="search">
              <Icon name="search" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search folders, tabs and files" aria-label="Search" spellCheck={false} />
              {query && (
                <button className="x" onClick={() => setQuery('')} aria-label="Clear search">
                  ✕
                </button>
              )}
            </label>
          </div>

          {!q && <SuggestionStrip />}

          {current.length > 0 && (
            <Section title="Open now">
              {current.map((j, i) => (
                <FolderCard key={j.id} job={j} index={i} state={openMap[j.id]} onOpen={() => onOpen(j.id)} />
              ))}
            </Section>
          )}
          <Section title="Folders" count={active.length}>
            {active.map((j, i) => (
              <FolderCard key={j.id} job={j} index={i} state={openMap[j.id]} onOpen={() => onOpen(j.id)} />
            ))}
          </Section>
          {active.length === 0 && current.length === 0 && <p className="muted small">{q ? `Nothing matches “${query}”.` : 'Every folder is finished.'}</p>}
          {done.length > 0 && (
            <section>
              <button className="section-toggle" onClick={() => setShowFinished(!showFinished)}>
                <motion.span animate={{ rotate: showFinished ? 90 : 0 }} style={{ display: 'inline-flex' }}>
                  <Icon name="chevron" />
                </motion.span>
                Finished <span className="faint">{done.length}</span>
              </button>
              {showFinished && (
                <div className="folder-grid" style={{ marginTop: 12 }}>
                  {done.map((j, i) => (
                    <FolderCard key={j.id} job={j} index={i} state={openMap[j.id]} onOpen={() => onOpen(j.id)} />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section>
      <div className="section-head">
        <h3>
          {title} {count !== undefined && <span className="faint">{count}</span>}
        </h3>
      </div>
      <div className="folder-grid">{children}</div>
    </section>
  );
}

function FolderCard({ job, index, state, onOpen }: { job: JobSummary; index: number; state?: OpenState; onOpen: () => void }) {
  const allOpen = !!state && state.total > 0 && state.open === state.total;
  const tone = folderTone(job.id);
  const [hover, setHover] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(job.name);
  const finishRename = (save: boolean) => {
    setRenaming(false);
    const next = name.trim();
    if (save && next && next !== job.name) void api.renameJob(job.id, next);
    else setName(job.name);
  };
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
      onHoverEnd={() => {
        setHover(false);
        setMenu(false);
      }}
      onClick={() => !renaming && onOpen()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <div className="folder-card-top">
        <motion.span animate={{ rotate: hover ? -6 : 0, scale: hover ? 1.06 : 1 }}>
          <FolderMark size={44} awake={hover || job.current} tone={tone} />
        </motion.span>
        <span className="card-tools">
          {job.current && <span className="tag-live">Open now</span>}
          <button
            className="card-more"
            aria-label={`More for ${job.name}`}
            title="Rename, finish or delete"
            onClick={(e) => {
              e.stopPropagation();
              setMenu(!menu);
            }}
          >
            <Icon name="more" />
          </button>
        </span>
        <AnimatePresence>
          {menu && (
            <motion.div className="card-menu" initial={{ opacity: 0, y: -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }} onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { setMenu(false); setRenaming(true); }}>
                <Icon name="pencil" /> Rename
              </button>
              <button onClick={() => { setMenu(false); void api.setDone(job.id, !job.done); }}>
                <Icon name="check" /> {job.done ? 'Not finished' : 'Mark finished'}
              </button>
              <button className="danger" onClick={() => { setMenu(false); void api.deleteJob(job.id); }}>
                <Icon name="trash" /> Delete…
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {renaming ? (
        <input
          className="field rename-field"
          autoFocus
          value={name}
          maxLength={60}
          aria-label="Folder name"
          onClick={(e) => e.stopPropagation()}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => finishRename(true)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') finishRename(true);
            if (e.key === 'Escape') finishRename(false);
          }}
        />
      ) : (
        <div className="folder-card-name">{job.name}</div>
      )}
      <div className="folder-card-meta">
        {timeAgo(job.updatedAt)}
        {counts.length > 0 && ` · ${counts.join(' · ')}`}
      </div>
      {job.hint && <div className="folder-card-hint">{job.hint}</div>}
      <div className="folder-card-foot">
        {!job.current && allOpen && (
          <span className="open-tag" title="Everything in this folder is already open">
            <Icon name="check" /> Open
          </span>
        )}
        {!job.current && !allOpen && (
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
  const [suggestions] = useSuggestions();

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
          <EditableTitle jobId={jobId} name={view.job.name} />
        </div>
      </header>
      <FolderMergeHint jobId={jobId} list={suggestions} />

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
                      <ItemCard
                        key={it.key}
                        item={it}
                        index={i}
                        jobId={jobId}
                        front={it.key === view.entry.frontKey}
                        editable={latest}
                        moveTo={suggestions.find((s): s is Extract<Suggestion, { kind: 'move' }> => s.kind === 'move' && s.from === jobId && s.itemKey === it.key)}
                      />
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

/** A folder's name: click it to rename, Enter to save, Esc to cancel. */
function EditableTitle({ jobId, name }: { jobId: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  const finish = (save: boolean) => {
    setEditing(false);
    const next = value.trim();
    if (save && next && next !== name) void api.renameJob(jobId, next);
    else setValue(name);
  };
  if (editing) {
    return (
      <input
        className="page-title title-edit"
        autoFocus
        value={value}
        maxLength={60}
        aria-label="Folder name"
        onFocus={(e) => e.target.select()}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(true);
          if (e.key === 'Escape') finish(false);
        }}
      />
    );
  }
  return (
    <button className="page-title title-button" onClick={() => setEditing(true)} title="Click to rename">
      {name}
    </button>
  );
}

/** One tab, file or app. Click to open just that; drag onto another folder to move it. */
function ItemCard(props: { item: Item; index: number; jobId: string; front: boolean; editable: boolean; moveTo?: Extract<Suggestion, { kind: 'move' }> }) {
  const { item, index, jobId, front, editable, moveTo } = props;
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
        {moveTo ? (
          <button
            className="belongs-chip"
            style={toneStyle(folderTone(moveTo.to))}
            title={`${moveTo.why.join(' · ')}\nClick to move it there`}
            onClick={(e) => {
              e.stopPropagation();
              void api.acceptSuggestion(moveTo.id);
            }}
          >
            Belongs in {moveTo.toName}? Move
          </button>
        ) : (
          <span className="item-sub">
            {state === 'opening' ? 'Opening…' : state === 'opened' ? 'Opened' : state === 'missing' ? "Couldn't find it" : describe(item)}
          </span>
        )}
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
