// The panel under the menu bar icon: your folders, and the brief for the one you pick.

import { useCallback, useEffect, useState } from 'react';
import type { BriefView, JobSummary, Settings } from '../shared/types';
import { api, errorText, prettyShortcut, timeAgo, useFitWindow, useSettings } from './api';
import { BriefCard } from './BriefCard';
import { Icon } from './icons';
import { Button, FolderMark, Kbd, motion, Motion, Swap } from './ui';
import { BadgeStrip, folderTone, toneStyle } from './visuals';

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

  const loadJobs = useCallback(() => {
    api.listJobs().then(setJobs, (e) => setError(errorText(e)));
  }, []);

  useEffect(() => {
    loadJobs();
    const offs = [
      api.onJobsChanged(loadJobs),
      api.onShowJob((id) => setSelected(id)),
      api.onWindowShown(() => {
        setSelected(null);
        loadJobs();
      }),
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
              <BriefCard view={view} current={jobs?.find((j) => j.id === view.job.id)?.current ?? false} />
            ) : (
              <div className="muted small" style={{ padding: '18px 8px' }}>
                <span className="spinner" /> Getting your folder…
              </div>
            )}
          </div>
        ) : (
          <JobList jobs={jobs} settings={settings} showDone={showDone} setShowDone={setShowDone} onPick={setSelected} />
        )}
      </Swap>
      {error && <div className="banner">{error}</div>}
    </div>
  );
}

function JobList(props: {
  jobs: JobSummary[] | null;
  settings: Settings;
  showDone: boolean;
  setShowDone: (v: boolean) => void;
  onPick: (id: string) => void;
}) {
  const { jobs, settings, showDone, setShowDone, onPick } = props;
  const current = (jobs ?? []).find((j) => j.current && !j.done) ?? null;
  const active = (jobs ?? []).filter((j) => !j.done && j !== current);
  const done = (jobs ?? []).filter((j) => j.done);
  return (
    <>
      <div className="panel-head">
        <button className="brand brand-btn" onClick={() => void api.openWindow('main')} title="Open Stashd">
          <FolderMark size={24} awake />
          <span className="display" style={{ fontSize: 15 }}>Stashd</span>
        </button>
        <span className="head-tools">
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
            <span className="now-strip">
              <BadgeStrip items={current.preview} size={18} />
            </span>
          </button>
          <div className="now-actions">
            <Button variant="primary" size="small" onClick={() => void api.openWindow('pack')} title="Save this folder and close its windows">
              <Icon name="stack" /> Pack up <span className="enter">{prettyShortcut(settings.shortcutSave)}</span>
            </Button>
            <Button size="small" onClick={() => void api.openWindow('save')} title="Save without closing anything">
              Save
            </Button>
          </div>
        </motion.div>
      ) : (
        <motion.button layout className="stash-card" onClick={() => void api.openWindow('save')} whileTap={{ scale: 0.98 }} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <span className="stash-plus">
            <Icon name="plus" />
          </span>
          <span className="grow">
            <span className="stash-title">Stash what's open</span>
            <span className="stash-sub">Your tabs and files go into a folder</span>
          </span>
          <Kbd>{prettyShortcut(settings.shortcutSave)}</Kbd>
        </motion.button>
      )}

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
          <JobRow job={j} onPick={onPick} />
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

function JobRow({ job, onPick }: { job: JobSummary; onPick: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);

  // Renaming happens in the app window (click a folder's title there); here a click just opens it.
  return (
    <div
      className={`job-row ${job.current ? 'current' : ''}`}
      style={{ ...toneStyle(folderTone(job.id)), ...(job.done ? { opacity: 0.6 } : {}) }}
      role="button"
      tabIndex={0}
      onClick={() => onPick(job.id)}
      onKeyDown={(e) => e.key === 'Enter' && onPick(job.id)}
    >
      <FolderMark size={30} awake={job.current} tone={folderTone(job.id)} />
      <span className="grow">
        <span className="name" style={{ display: 'block' }}>{job.name}</span>
        <span className="hint" style={{ display: 'block' }}>
          {opened ?? (
            <>
              <BadgeStrip items={job.preview} size={14} max={4} />
              <span>{job.current ? 'Open now' : timeAgo(job.updatedAt)}</span>
            </>
          )}
        </span>
      </span>
      {job.current && <span className="live" />}
      {job.current ? (
        <Button
          size="small"
          className="unpack-btn pack"
          title="Save this folder and close its windows"
          onClick={(e) => {
            e.stopPropagation();
            void api.openWindow('pack');
          }}
        >
          Pack up
        </Button>
      ) : (
        <Button
          size="small"
          className="unpack-btn"
          disabled={busy}
          title="Open what you need to carry on"
          onClick={(e) => {
            e.stopPropagation();
            setBusy(true);
            void api
              .openJob(job.id, null, 'needed')
              .then((r) => {
                const missing = r.missing.length + r.failed.length;
                setOpened(`Opened ${r.opened + r.alreadyOpen}${missing ? `, ${missing} not found` : ''}`);
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
          void api.deleteJob(job.id);
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
          <Button variant="danger" size="small" className="tiny" onClick={() => void api.deleteJob(view.job.id).then((gone) => gone && onGone())}>Delete</Button>
        </>
      ) : (
        <Button variant="ghost" aria-label="More" onClick={() => setOpen(true)}>
          <Icon name="more" />
        </Button>
      )}
    </div>
  );
}
