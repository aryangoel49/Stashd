// The app window: a bigger version of the menu bar panel. Jobs on the left; the brief, what's
// inside and the history on the right. Drag an item onto another job to move it.

import { useCallback, useEffect, useState } from 'react';
import type { BriefView, JobSummary } from '../shared/types';
import { api, errorText, prettyShortcut, timeAgo, useSettings } from './api';
import { BriefCard } from './BriefCard';
import { Icon } from './icons';
import { SettingsView } from './SettingsView';

export function Main() {
  const settings = useSettings();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [selected, setSelected] = useState<string | 'settings' | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const load = useCallback(() => {
    void api.listJobs().then((list) => {
      setJobs(list);
      setSelected((cur) => (cur === 'settings' || (cur && list.some((j) => j.id === cur)) ? cur : (list.find((j) => j.current) ?? list.find((j) => !j.done) ?? list[0])?.id ?? null));
    });
  }, []);

  useEffect(() => {
    load();
    const offs = [api.onJobsChanged(load), api.onMainShow((v) => (v === 'settings' ? setSelected('settings') : load()))];
    return () => offs.forEach((o) => o());
  }, [load]);

  const active = jobs.filter((j) => !j.done);
  const done = jobs.filter((j) => j.done);

  const row = (j: JobSummary) => (
    <button
      key={j.id}
      className={`side-row ${selected === j.id ? 'on' : ''} ${dropTarget === j.id ? 'drop' : ''}`}
      onClick={() => setSelected(j.id)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-wwi-item') && selected !== j.id) {
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
      <Icon name={j.icon} />
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
        <div className="drag" style={{ height: 46 }} />
        <div className="side-title">Jobs</div>
        <div className="side-list">
          {active.map(row)}
          {done.length > 0 && <div className="side-title" style={{ marginTop: 14 }}>Done</div>}
          {done.map(row)}
          {jobs.length === 0 && <div className="faint small" style={{ padding: '6px 12px' }}>No jobs yet</div>}
        </div>
        <div className="side-foot">
          <button className={`side-row ${selected === 'settings' ? 'on' : ''}`} onClick={() => setSelected('settings')}>
            <Icon name="gear" />
            <span className="grow">
              <span className="t">Settings</span>
            </span>
          </button>
        </div>
      </aside>
      <main className="content">
        <div className="drag" style={{ height: 30, position: 'sticky', top: 0 }} />
        {selected === 'settings' ? (
          <SettingsView />
        ) : selected ? (
          <JobDetail key={selected} jobId={selected} jobs={jobs} />
        ) : (
          <div className="empty" style={{ paddingTop: 80 }}>
            <div className="display">Nothing saved yet</div>
            <p>
              Press <span className="kbd">{settings ? prettyShortcut(settings.shortcutSave) : '⌃S'}</span> while you're working to save your first job.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function JobDetail({ jobId, jobs }: { jobId: string; jobs: JobSummary[] }) {
  const [entryId, setEntryId] = useState<string | undefined>(undefined);
  const [view, setView] = useState<BriefView | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  if (!view) return <div className="muted" style={{ padding: 28 }}><span className="spinner" /> Writing your brief…</div>;
  const latest = view.history[0]?.id === view.entry.id;
  const others = jobs.filter((j) => j.id !== jobId && !j.done);

  return (
    <div className="detail fade-in">
      <div className="card glass-card" style={{ maxWidth: 560 }}>
        <BriefCard view={view} />
      </div>

      <section>
        <div className="section-head">
          <h3>What's inside</h3>
          {latest && others.length > 0 && <span className="faint tiny">Drag an item onto another job to move it</span>}
        </div>
        <div className="chips">
          {view.entry.items.map((it) => (
            <div
              key={it.key}
              className={`chip ${it.key === view.entry.frontKey ? 'front' : ''}`}
              draggable={latest}
              onDragStart={(e) => e.dataTransfer.setData('application/x-wwi-item', JSON.stringify({ from: jobId, key: it.key }))}
              title={`${it.label}\n${it.detail}${it.key === view.entry.frontKey ? '\nYou were on this last' : ''}`}
            >
              <Icon name={it.kind} />
              <span className="lbl">{it.label}</span>
              {latest && (
                <button className="x" aria-label={`Remove ${it.label}`} onClick={() => void api.removeItem(jobId, it.key)}>
                  ✕
                </button>
              )}
            </div>
          ))}
          {view.entry.items.length === 0 && <span className="faint small">Empty</span>}
        </div>
      </section>

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
  );
}
