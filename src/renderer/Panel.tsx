// The panel under the menu bar icon: your folders, and the brief for the one you pick.

import { useCallback, useEffect, useRef, useState } from 'react';
import { mostlyOpen, type BriefView, type JobSummary, type OpenState, type Settings } from '../shared/types';
import { api, errorText, prettyShortcut, timeAgo, useFitWindow, useSettings } from './api';
import { BriefCard, NameEdit } from './BriefCard';
import { Icon } from './icons';
import { deleteWithFeel, FLINCH, reactionMood, type Reaction } from './deleteFx';
import { Button, FolderMark, Kbd, motion, Motion, Swap } from './ui';
import { playMerge } from './mergeFx';
import { BreakView, ModeSwitch } from './Break';
import { PanelAsk } from './Ask';
import { useRecentlyTidied } from './Recent';
import { useSuggestions } from './Suggestions';
import { folderTone, ItemBadge, titleOf, toneStyle } from './visuals';

export function Panel() {
  return (
    <Motion>
      <PanelView />
    </Motion>
  );
}

function PanelView() {
  const settings = useSettings();
  const ref = useFitWindow<HTMLDivElement>();
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<BriefView | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Work (your folders) or Break (what you watch and listen to). Remembered between openings.
  const [mode, setModeState] = useState<'work' | 'break'>(() => {
    try {
      return localStorage.getItem('panelMode') === 'break' ? 'break' : 'work';
    } catch {
      return 'work';
    }
  });
  const setMode = (m: 'work' | 'break') => {
    setModeState(m);
    try {
      localStorage.setItem('panelMode', m);
    } catch {
      // not remembered this time
    }
  };
  const [openMap, setOpenMap] = useState<Record<string, OpenState>>({});
  const loadJobs = useCallback(() => {
    api.listJobs().then(setJobs, (e) => setError(errorText(e)));
    // A moment later: which folders are already open (so they don't offer an Unpack that does nothing).
    api.openState().then(setOpenMap, () => undefined);
  }, []);

  useEffect(() => {
    loadJobs();
    const offs = [
      api.onJobsChanged(loadJobs),
      api.onShowJob((id) => setSelected(id)),
      // Reset while hidden, so the panel opens already showing the list: no swap or resize as you watch.
      api.onWindowHidden(() => {
        setSelected(null);
        loadJobs();
      }),
      api.onWindowShown(loadJobs),
    ];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selected) setSelected(null);
        else void api.closeWindow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      offs.forEach((o) => o());
      window.removeEventListener('keydown', onKey);
    };
  }, [loadJobs, selected]);

  useEffect(() => {
    if (!selected) {
      setView(null);
      return;
    }
    let cancelled = false;
    setView(null);
    api.getBrief(selected).then(
      (v) => !cancelled && setView(v),
      (e) => !cancelled && setError(errorText(e)),
    );
    const off = api.onJobsChanged(() => {
      // The AI brief may arrive a moment after saving.
      api.getBrief(selected).then((v) => !cancelled && setView(v), () => undefined);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [selected]);

  if (!settings) return <div ref={ref} className="panel" />;

  return (
    <div ref={ref} className="panel">
      <Swap id={selected ?? 'list'} direction={selected ? 1 : -1}>
        {selected ? (
          <div>
            <div className="panel-head" style={{ paddingBottom: 2 }}>
              <Button variant="ghost" size="small" onClick={() => setSelected(null)} style={{ paddingLeft: 2 }}>
                <Icon name="back" /> Folders
              </Button>
              {view && <JobMenu view={view} onGone={() => setSelected(null)} />}
            </div>
            {view ? (
              <BriefCard view={view} current={!!jobs?.find((j) => j.id === view.job.id)?.current || mostlyOpen(openMap[view.job.id])} />
            ) : (
              <div className="muted small" style={{ padding: '18px 8px' }}>
                <span className="spinner" /> Getting your folder…
              </div>
            )}
          </div>
        ) : (
          <div>
            <PanelHead settings={settings} />
            <ModeSwitch mode={mode} onChange={setMode} />
            <Swap id={mode} direction={mode === 'break' ? 1 : -1}>
              {mode === 'break' ? (
                <BreakView />
              ) : (
                <PanelAsk jobs={jobs ?? []} onShow={setSelected}>
                  <JobList jobs={jobs} openMap={openMap} settings={settings} onPick={setSelected} />
                </PanelAsk>
              )}
            </Swap>
          </div>
        )}
      </Swap>
      {error && <div className="banner">{error}</div>}
    </div>
  );
}

/** The panel's top bar: the app, Tidy all, stash, the window and Settings. */
function PanelHead({ settings }: { settings: Settings }) {
  return (
    <>
      <div className="panel-head">
        <button className="brand brand-btn" onClick={() => void api.openWindow('main')} title="Open Stashd">
          <FolderMark size={24} awake alive />
          <span className="display" style={{ fontSize: 15 }}>Stashd</span>
        </button>
        <span className="head-tools">
          <Button variant="ghost" size="small" className="tidy-all-btn" onClick={() => void api.tidyAll()} title={`Save your open folders, keep loose tabs in a folder of their own, and close it all (${prettyShortcut(settings.shortcutTidy)})`}>
            <Icon name="spark" /> Tidy all
          </Button>
          <Button
            variant="ghost"
            size="small"
            className="icon-btn stash-plus-btn"
            onClick={() => void api.openWindow('save')}
            title={`Stash what's open (${prettyShortcut(settings.shortcutSave)})`}
            aria-label="Stash what's open"
          >
            <Icon name="plus" />
          </Button>
          <Button variant="ghost" size="small" className="icon-btn" onClick={() => void api.openWindow('main')} title="Open Stashd" aria-label="Open Stashd">
            <Icon name="open" />
          </Button>
          <Button variant="ghost" size="small" className="icon-btn" onClick={() => void api.openWindow('settings')} title="Settings" aria-label="Settings">
            <Icon name="gear" />
          </Button>
        </span>
      </div>
    </>
  );
}

function JobList(props: {
  jobs: JobSummary[] | null;
  openMap: Record<string, OpenState>;
  settings: Settings;
  onPick: (id: string) => void;
}) {
  const { jobs, openMap, settings, onPick } = props;
  const current = (jobs ?? []).find((j) => j.current && !j.done) ?? null;
  // The pinned folder (what ⌃O opens) comes first.
  const active = (jobs ?? []).filter((j) => !j.done && j !== current).sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const doneOpen = (jobs ?? []).filter((j) => j.done && (j.current || mostlyOpen(openMap[j.id])));
  return (
    <>

      {current ? (
        <motion.div layout className="now-card" style={toneStyle(folderTone(current.id))} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <div className="now-main" role="button" tabIndex={0} onClick={() => onPick(current.id)} onKeyDown={(e) => e.key === 'Enter' && onPick(current.id)} title="See the brief">
            <span className="eyebrow now-eyebrow">
              <span className="live" /> Open now
            </span>
            <NameEdit jobId={current.id} name={current.name} renamed={current.renamed} className="now-name" onClick={() => onPick(current.id)} />
          </div>
          <div className="now-actions">
            <Button variant="primary" size="small" onClick={() => void api.openWindow('pack', current.id)} title="Save this folder and close its windows">
              <Icon name="stack" /> Pack up <span className="enter">{prettyShortcut(settings.shortcutSave)}</span>
            </Button>
            <Button size="small" onClick={() => void api.openWindow('save')} title="Save without closing anything">
              Save
            </Button>
          </div>
        </motion.div>
      ) : null}

      <MergeOffer />

      {active.length > 0 && <div className="eyebrow list-label">Folders</div>}

      {jobs && jobs.length === 0 && (
        <motion.div className="empty" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <p>
            Nothing stashed yet. Press <Kbd>{prettyShortcut(settings.shortcutSave)}</Kbd> when you're in the middle of something, and <Kbd>{prettyShortcut(settings.shortcutRecap)}</Kbd> to pick it back up.
          </p>
        </motion.div>
      )}

      {active.map((j, i) => (
        <motion.div key={j.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 6) * 0.03 }}>
          <JobRow job={j} state={openMap[j.id]} onPick={onPick} openKey={prettyShortcut(settings.shortcutOpen)} />
        </motion.div>
      ))}

      {/* Finished folders live in the Stashd window. One you've opened again shows here, so it can be packed up. */}
      {doneOpen.map((j) => (
        <JobRow key={j.id} job={j} state={openMap[j.id]} onPick={onPick} />
      ))}

      <RecentlyClosed />

    </>
  );
}

function JobRow({ job, state, onPick, openKey }: { job: JobSummary; state?: OpenState; onPick: (id: string) => void; openKey?: string }) {
  const allOpen = !!state && state.total > 0 && state.open === state.total;
  const someOpen = !!state && state.open > 0 && !allOpen;
  // Open now: you unpacked it here, or most of its tabs and files are open anyway. A finished folder
  // you unpacked counts too, so it can be packed up again; it still stays under Finished.
  const openNow = job.current || mostlyOpen(state);
  const rowRef = useRef<HTMLDivElement>(null);
  const [reaction, setReaction] = useState<Reaction>(null);

  // A click opens it; double-click the name to rename it.
  return (
    <div
      ref={rowRef}
      data-job={job.id}
      className={`job-row ${openNow ? 'current' : ''} ${job.pinned ? 'pinned' : ''}`}
      style={{ ...toneStyle(folderTone(job.id)), ...(job.done ? { opacity: 0.6 } : {}) }}
      role="button"
      tabIndex={0}
      onClick={() => onPick(job.id)}
      onKeyDown={(e) => e.key === 'Enter' && onPick(job.id)}
    >
      <motion.span className="row-mark" style={{ display: 'flex' }} animate={reaction === 'startled' ? FLINCH : { x: 0 }}>
        <FolderMark size={30} awake={openNow} mood={reactionMood(reaction)} tone={folderTone(job.id)} />
      </motion.span>
      <span className="grow">
        <NameEdit jobId={job.id} name={job.name} renamed={job.renamed} className="name" onClick={() => onPick(job.id)} />
        <span className="hint" style={{ display: 'block' }}>
          <span>{allOpen ? 'All open' : someOpen ? `${state!.open} of ${state!.total} open` : job.current ? 'Open now' : timeAgo(job.updatedAt)}</span>
        </span>
      </span>
      {openNow && <span className="live" />}
      {openNow ? (
        <Button
          size="small"
          className="unpack-btn pack"
          title="Save this folder and close its windows"
          onClick={(e) => {
            e.stopPropagation();
            void api.openWindow('pack', job.id);
          }}
        >
          Pack up
        </Button>
      ) : (
        <Button
          size="small"
          className="unpack-btn"
          title={someOpen ? `Choose which of the other ${state!.total - state!.open} to open` : 'Choose what to open'}
          onClick={(e) => {
            // Unpack first shows the folder, so you can pick files, tabs, apps or chats before anything opens.
            e.stopPropagation();
            onPick(job.id);
          }}
        >
          Unpack
        </Button>
      )}
      {!job.done && (
        <Button
          variant="ghost"
          size="small"
          className={`tool-btn pin-btn ${job.pinned ? 'on' : ''}`}
          title={job.pinned ? 'Unpin' : `Pin: ${openKey ?? '⌃O'} opens this folder`}
          aria-label={job.pinned ? `Unpin ${job.name}` : `Pin ${job.name}`}
          aria-pressed={job.pinned}
          onClick={(e) => {
            e.stopPropagation();
            void api.setPinned(job.id, !job.pinned);
          }}
        >
          <Icon name="pin" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="small"
        className="tool-btn delete"
        title={`Delete ${job.name}`}
        aria-label={`Delete ${job.name}`}
        onClick={(e) => {
          e.stopPropagation();
          void deleteWithFeel(job.id, rowRef.current, setReaction);
        }}
      >
        <Icon name="trash" />
      </Button>
    </div>
  );
}

function JobMenu({ view, onGone }: { view: BriefView; onGone: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {open ? (
        <>
          {!view.job.done && (
            <Button variant="ghost" size="small" className="tiny" onClick={() => void api.setPinned(view.job.id, !view.job.pinned).then(() => setOpen(false))}>
              {view.job.pinned ? 'Unpin' : 'Pin'}
            </Button>
          )}
          <Button variant="ghost" size="small" className="tiny" onClick={() => void api.setDone(view.job.id, !view.job.done).then(onGone)}>
            {view.job.done ? 'Not finished' : 'Mark finished'}
          </Button>
          <Button
            variant="danger"
            size="small"
            className="tiny"
            onClick={(e) => void deleteWithFeel(view.job.id, e.currentTarget.closest<HTMLElement>('.brief'), () => undefined).then((gone) => gone && onGone())}
          >
            Delete
          </Button>
        </>
      ) : (
        <Button variant="ghost" aria-label="More" onClick={() => setOpen(true)}>
          <Icon name="more" />
        </Button>
      )}
    </div>
  );
}

/**
 * What Tidy all closed in the last 10 minutes: one quiet line at the bottom. Opened, it shows the first few
 * in small rows (reopen on hover); the full list is in the Stashd window. Then it's gone.
 */
function RecentlyClosed() {
  const { recent, minutesLeft } = useRecentlyTidied();
  const [open, setOpen] = useState(false);
  if (!recent) return null;
  const shown = recent.items.slice(0, 5);
  return (
    <div className="recent-closed">
      <button type="button" className="recent-line" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="grow">
          {recent.items.length} closed by Tidy all · back for {minutesLeft} min
        </span>
        <motion.span animate={{ rotate: open ? 90 : 0 }} style={{ display: 'inline-flex' }}>
          <Icon name="chevron" />
        </motion.span>
      </button>
      {open && (
        <div className="recent-body">
          {shown.map((it) => (
            <button key={it.key} type="button" className="recent-row" onClick={() => void api.reopenTidied(it.key)} title={`Reopen ${titleOf(it)}`}>
              <ItemBadge item={it} size={18} />
              <span className="recent-title">{titleOf(it)}</span>
              <span className="recent-reopen">Reopen</span>
            </button>
          ))}
          <div className="recent-foot">
            <button type="button" className="link tiny" onClick={() => void api.reopenTidied()}>
              Reopen all
            </button>
            {recent.items.length > shown.length && (
              <button type="button" className="link tiny" onClick={() => void api.openWindow('main', 'recent')}>
                See all {recent.items.length}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Two folders that are really one piece of work: Stashd offers to merge them (the pinned or named one
 * stays). Merge plays the merge on the rows below, then Undo is there for a few seconds.
 */
function MergeOffer() {
  const [list] = useSuggestions();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 5000);
    return () => clearTimeout(t);
  }, [done]);
  const s = list.find((x): x is Extract<typeof x, { kind: 'merge' }> => x.kind === 'merge');
  if (done) {
    return (
      <motion.div className="merge-done" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
        <Icon name="check" />
        <span className="grow">{done}</span>
        <button
          type="button"
          className="link tiny"
          onClick={() => {
            setDone(null);
            void api.undoSuggestion();
          }}
        >
          Undo
        </button>
      </motion.div>
    );
  }
  if (!s) return null;
  const merge = async () => {
    setBusy(true);
    try {
      await playMerge(s.from, s.into, folderTone(s.into).tile);
      await api.acceptSuggestion(s.id);
      setDone(`Merged into ${s.intoName}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <motion.div className="merge-offer" style={toneStyle(folderTone(s.into))} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
      <span className="merge-art" aria-hidden="true">
        <FolderMark size={26} tone={folderTone(s.from)} />
        <FolderMark size={26} tone={folderTone(s.into)} awake />
      </span>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="merge-title">
          {s.fromName} and {s.intoName} look like the same work
        </span>
        <span className="merge-why">{s.why.length ? s.why.join(', ') : 'Same kind of things in both'}</span>
      </span>
      <span className="merge-acts">
        <Button variant="primary" size="small" disabled={busy} onClick={() => void merge()} title={`Put ${s.fromName} into ${s.intoName}`}>
          Merge
        </Button>
        <Button variant="ghost" size="small" className="tool-btn" disabled={busy} title="Not now (asks again in a week)" aria-label="Not now" onClick={() => void api.dismissSuggestion(s.id, false)}>
          ✕
        </Button>
      </span>
    </motion.div>
  );
}
