// The glass panel under the menu bar icon: your jobs, and the brief for the one you pick.

import { useCallback, useEffect, useState } from 'react';
import type { BriefView, JobSummary, Settings } from '../shared/types';
import { api, errorText, prettyShortcut, timeAgo, useFitWindow, useSettings } from './api';
import { BriefCard } from './BriefCard';
import { Icon } from './icons';

export function Panel() {
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
      {selected ? (
        <div className="slide-in">
          <div className="panel-head" style={{ paddingBottom: 2 }}>
            <button className="btn ghost small" onClick={() => setSelected(null)} style={{ paddingLeft: 2 }}>
              <Icon name="back" /> Jobs
            </button>
            {view && <JobMenu view={view} onGone={() => setSelected(null)} />}
          </div>
          {view ? (
            <BriefCard view={view} />
          ) : (
            <div className="muted small" style={{ padding: '18px 8px' }}>
              <span className="spinner" /> Writing your brief…
            </div>
          )}
        </div>
      ) : (
        <JobList jobs={jobs} settings={settings} showDone={showDone} setShowDone={setShowDone} onPick={setSelected} />
      )}
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
  const active = (jobs ?? []).filter((j) => !j.done);
  const done = (jobs ?? []).filter((j) => j.done);
  return (
    <>
      <div className="panel-head">
        <span className="display" style={{ fontSize: 14 }}>Where Was I</span>
        <span className="faint tiny">
          <span className="kbd">{prettyShortcut(settings.shortcutSave)}</span>
        </span>
      </div>
      <div className="pack-actions">
        <button className="btn primary pack-btn" onClick={() => void api.openWindow('pack')} title="Save what's open and tidy it away">
          <Icon name="stack" /> Pack up
        </button>
        <button className="btn pack-btn" onClick={() => void api.openWindow('save')} title="Save what's open and keep it open">
          Save only
        </button>
      </div>

      {jobs && jobs.length === 0 && (
        <div className="empty">
          <div className="display">Nothing saved yet</div>
          <p>
            When you're in the middle of something, press <span className="kbd">{prettyShortcut(settings.shortcutSave)}</span>. Your tabs and files go into a
            job, and you get a short brief when you come back.
          </p>
          <button className="btn primary" onClick={() => void api.openWindow('save')}>
            Save what's open
          </button>
        </div>
      )}

      {active.map((j) => (
        <JobRow key={j.id} job={j} onPick={onPick} />
      ))}

      {done.length > 0 && (
        <>
          <button className="btn ghost small" style={{ justifyContent: 'flex-start' }} onClick={() => setShowDone(!showDone)}>
            {showDone ? 'Hide' : 'Show'} done ({done.length})
          </button>
          {showDone && done.map((j) => <JobRow key={j.id} job={j} onPick={onPick} />)}
        </>
      )}

      <div className="hr" />
      <div className="panel-foot">
        <button className="btn small" onClick={() => void api.openWindow('main')}>All jobs</button>
        <button className="btn small" onClick={() => void api.openWindow('settings')} title="Settings">
          <Icon name="gear" /> Settings
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn ghost tiny" onClick={() => void api.quit()}>Quit</button>
      </div>
    </>
  );
}

function JobRow({ job, onPick }: { job: JobSummary; onPick: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className={`job-row ${job.current ? 'current' : ''}`} role="button" tabIndex={0} onClick={() => onPick(job.id)} onKeyDown={(e) => e.key === 'Enter' && onPick(job.id)} style={job.done ? { opacity: 0.6 } : undefined}>
      <span className="icon">
        <Icon name={job.icon} />
      </span>
      <span className="grow">
        <span className="name" style={{ display: 'block' }}>{job.name}</span>
        <span className="hint" style={{ display: 'block' }}>
          {job.current ? 'Open now' : timeAgo(job.updatedAt)}
          {job.hint ? ` · ${job.hint}` : ''}
        </span>
      </span>
      {job.current && <span className="live" />}
      <button
        className="btn small unpack-btn"
        disabled={busy}
        title="Reopen everything in this job"
        onClick={(e) => {
          e.stopPropagation();
          setBusy(true);
          void api.openJob(job.id, null, 'all').finally(() => setBusy(false));
        }}
      >
        {busy ? <span className="spinner" /> : 'Unpack'}
      </button>
      <button
        className="btn ghost delete-btn"
        title={`Delete ${job.name}`}
        aria-label={`Delete ${job.name}`}
        onClick={(e) => {
          e.stopPropagation();
          void api.deleteJob(job.id);
        }}
      >
        <Icon name="trash" />
      </button>
    </div>
  );
}

function JobMenu({ view, onGone }: { view: BriefView; onGone: () => void }) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(view.job.name);
  if (renaming) {
    return (
      <form
        style={{ display: 'flex', gap: 6 }}
        onSubmit={(e) => {
          e.preventDefault();
          void api.renameJob(view.job.id, name).then(() => setRenaming(false));
        }}
      >
        <input className="field small" style={{ width: 170, padding: '4px 8px' }} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn small" type="submit">Save</button>
      </form>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {open ? (
        <>
          <button className="btn ghost tiny" onClick={() => setRenaming(true)}>Rename</button>
          <button className="btn ghost tiny" onClick={() => void api.setDone(view.job.id, !view.job.done).then(onGone)}>
            {view.job.done ? 'Not done' : 'Mark done'}
          </button>
          <button className="btn ghost tiny danger" onClick={() => void api.deleteJob(view.job.id).then((gone) => gone && onGone())}>Delete</button>
        </>
      ) : (
        <button className="btn ghost" aria-label="More" onClick={() => setOpen(true)}>
          <Icon name="more" />
        </button>
      )}
    </div>
  );
}
