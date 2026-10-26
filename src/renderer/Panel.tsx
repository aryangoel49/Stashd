// The panel under the menu bar icon: your folders, and the brief for the one you pick.

import { useCallback, useEffect, useRef, useState } from 'react';
import { mostlyOpen, type BriefView, type JobSummary, type OpenState, type Settings } from '../shared/types';
import { api, errorText, prettyShortcut, timeAgo, useFitWindow, useSettings } from './api';
import { BriefCard } from './BriefCard';
import { Icon } from './icons';
import { deleteWithFeel, FLINCH, reactionMood, type Reaction } from './deleteFx';
import { Button, FolderMark, Kbd, motion, Motion, Swap } from './ui';
import { folderTone, toneStyle } from './visuals';

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
  const [showDone, setShowDone] = useState(false);

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
              <BriefCard view={view} current={!view.job.done && (!!jobs?.find((j) => j.id === view.job.id)?.current || mostlyOpen(openMap[view.job.id]))} />
            ) : (
              <div className="muted small" style={{ padding: '18px 8px' }}>
                <span className="spinner" /> Getting your folder…
              </div>
            )}
          </div>
        ) : (
          <JobList jobs={jobs} openMap={openMap} settings={settings} showDone={showDone} setShowDone={setShowDone} onPick={setSelected} />
        )}
      </Swap>
      {error && <div className="banner">{error}</div>}
    </div>
  );
}

function JobList(props: {
  jobs: JobSummary[] | null;
  openMap: Record<string, OpenState>;
  settings: Settings;
  showDone: boolean;
  setShowDone: (v: boolean) => void;
  onPick: (id: string) => void;
}) {
  const { jobs, openMap, settings, showDone, setShowDone, onPick } = props;
  const current = (jobs ?? []).find((j) => j.current && !j.done) ?? null;
  const active = (jobs ?? []).filter((j) => !j.done && j !== current);
  const done = (jobs ?? []).filter((j) => j.done);
  return (
    <>
      <div className="panel-head">
        <button className="brand brand-btn" onClick={() => void api.openWindow('main')} title="Open Stashd">
          <FolderMark size={24} awake alive />
          <span className="display" style={{ fontSize: 15 }}>Stashd</span>
        </button>
        <span className="head-tools">
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

      {current ? (
        <motion.div layout className="now-card" style={toneStyle(folderTone(current.id))} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <button className="now-main" onClick={() => onPick(current.id)} title="See the brief">
            <span className="eyebrow now-eyebrow">
              <span className="live" /> Open now
            </span>
            <span className="now-name">{current.name}</span>
          </button>
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
          <JobRow job={j} state={openMap[j.id]} onPick={onPick} />
        </motion.div>
      ))}

      {done.length > 0 && (
        <>
          <Button variant="ghost" size="small" style={{ justifyContent: 'flex-start' }} onClick={() => setShowDone(!showDone)}>
            {showDone ? 'Hide' : 'Show'} finished ({done.length})
          </Button>
          {showDone && done.map((j) => <JobRow key={j.id} job={j} onPick={onPick} />)}
        </>
      )}

    </>
  );
}

function JobRow({ job, state, onPick }: { job: JobSummary; state?: OpenState; onPick: (id: string) => void }) {
  const allOpen = !!state && state.total > 0 && state.open === state.total;
  const someOpen = !!state && state.open > 0 && !allOpen;
  // Open now: you unpacked it here, or most of its tabs and files are open anyway.
  const openNow = !job.done && (job.current || mostlyOpen(state));
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [reaction, setReaction] = useState<Reaction>(null);

  // Renaming happens in the app window (click a folder's title there); here a click just opens it.
  return (
    <div
      ref={rowRef}
      className={`job-row ${openNow ? 'current' : ''}`}
      style={{ ...toneStyle(folderTone(job.id)), ...(job.done ? { opacity: 0.6 } : {}) }}
      role="button"
      tabIndex={0}
      onClick={() => onPick(job.id)}
      onKeyDown={(e) => e.key === 'Enter' && onPick(job.id)}
    >
      <motion.span style={{ display: 'flex' }} animate={reaction === 'startled' ? FLINCH : { x: 0 }}>
        <FolderMark size={30} awake={openNow} mood={reactionMood(reaction)} tone={folderTone(job.id)} />
      </motion.span>
      <span className="grow">
        <span className="name" style={{ display: 'block' }}>{job.name}</span>
        <span className="hint" style={{ display: 'block' }}>
          {opened ?? (
            <>
              <span>{allOpen ? 'All open' : someOpen ? `${state!.open} of ${state!.total} open` : job.current ? 'Open now' : timeAgo(job.updatedAt)}</span>
            </>
          )}
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
          disabled={busy}
          title={someOpen ? `Open the other ${state!.total - state!.open}` : 'Open what you need to carry on'}
          onClick={(e) => {
            e.stopPropagation();
            setBusy(true);
            void api
              .openJob(job.id, null, 'all')
              .then((r) => {
                const missing = r.missing.length + r.failed.length;
                setOpened(
                  r.opened === 0 && r.alreadyOpen > 0
                    ? 'Already open'
                    : `Opened ${r.opened}${r.alreadyOpen ? `, ${r.alreadyOpen} already open` : ''}${missing ? `, ${missing} not found` : ''}`,
                );
                setTimeout(() => setOpened(null), 4000);
              })
              .catch(() => setOpened("Couldn't open this folder"))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? <span className="spinner" /> : 'Unpack'}
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
