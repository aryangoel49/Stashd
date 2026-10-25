import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectListItem, RecapItem, RecapView, RestoreResult, Settings, SnapshotSummary } from '../shared/types';
import { api, errorText, formatTime, prettyShortcut, timeAgo } from './api';

const MAX_REOPEN = 20;

function describeStatus(line: string): string {
  const code = line.slice(0, 2);
  const file = line.slice(3).replace(/^"|"$/g, '');
  const kind = code === '??' ? 'new' : code.includes('D') ? 'deleted' : code.includes('A') ? 'added' : code.includes('R') ? 'renamed' : 'edited';
  return `${file} (${kind})`;
}

export function MainWindow() {
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([api.listProjects(), api.getSettings()]);
      setProjects(p);
      setSettings(s);
      setSelected((cur) => {
        if (cur && p.some((x) => x.id === cur)) return cur;
        const withSnaps = [...p].filter((x) => x.lastSnapshotAt).sort((a, b) => (b.lastSnapshotAt ?? '').localeCompare(a.lastSnapshotAt ?? ''));
        return withSnaps[0]?.id ?? p[0]?.id ?? null;
      });
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const offs = [api.onSnapshotsChanged(() => void load()), api.onSettingsChanged(() => void load()), api.onShowProject((id) => setSelected(id))];
    return () => offs.forEach((off) => off());
  }, [load]);

  if (!projects || !settings) {
    return <div className="empty">{error ? <p>{error}</p> : <span className="spinner" />}</div>;
  }

  const addProject = async () => {
    try {
      const p = await api.addProject();
      if (p) setSelected(p.id);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-top drag" />
        <div className="sidebar-title">
          <h2>Projects</h2>
          <span className="faint">{projects.length || ''}</span>
        </div>
        <nav className="project-list">
          {projects.map((p) => (
            <button key={p.id} className={`project ${p.id === selected ? 'selected' : ''}`} onClick={() => setSelected(p.id)}>
              <span className="name">{p.name}</span>
              <span className={`when ${p.exists ? '' : 'missing'}`}>
                {!p.exists ? 'Folder not found' : p.lastSnapshotAt ? timeAgo(p.lastSnapshotAt) : 'No snapshots yet'}
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button onClick={addProject}>Add project</button>
          <button onClick={() => void api.openWindow('settings')}>Settings</button>
        </div>
      </aside>
      <main className="content">
        {projects.length === 0 ? (
          <Welcome settings={settings} onAdd={addProject} />
        ) : selected ? (
          <ProjectView key={selected} project={projects.find((p) => p.id === selected)!} settings={settings} />
        ) : null}
      </main>
    </div>
  );
}

function Welcome({ settings, onAdd }: { settings: Settings; onAdd: () => void }) {
  return (
    <div className="empty">
      <div className="drag" style={{ height: 30 }} />
      <h1>Pick up where you left off</h1>
      <p>Where Was I saves a snapshot of what you were doing, then tells you where you were and reopens your tabs and files.</p>
      <div className="steps">
        <div>
          <b>1.</b> Add a project folder (the folder where your code lives).
        </div>
        <div>
          <b>2.</b> When you stop working, press <kbd>{prettyShortcut(settings.shortcutSave)}</kbd> and type what you were about to do next.
        </div>
        <div>
          <b>3.</b> When you come back, press <kbd>{prettyShortcut(settings.shortcutRecap)}</kbd> to see your recap.
        </div>
      </div>
      <button className="primary" onClick={onAdd}>
        Add a project folder
      </button>
    </div>
  );
}

function ProjectView({ project, settings }: { project: ProjectListItem; settings: Settings }) {
  const [snapshots, setSnapshots] = useState<SnapshotSummary[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [view, setView] = useState<RecapView | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disclosure, setDisclosure] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    const list = await api.listSnapshots(project.id);
    setSnapshots(list);
    setCurrent((cur) => (cur && list.some((s) => s.id === cur) ? cur : list[0]?.id ?? null));
  }, [project.id]);

  useEffect(() => {
    void loadList().catch((e) => setError(errorText(e)));
    return api.onSnapshotsChanged(() => {
      // A new save should show up as the current snapshot.
      setCurrent(null);
      void loadList();
    });
  }, [loadList]);

  useEffect(() => {
    if (!current) {
      setView(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getRecap(project.id, current, false)
      .then((v) => !cancelled && setView(v))
      .catch((e) => !cancelled && setError(errorText(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [project.id, current]);

  const askAi = async (accepted = settings.aiDisclosureAccepted) => {
    if (!current) return;
    if (!accepted) {
      setDisclosure(await api.aiPayload(project.id, current));
      return;
    }
    setAiLoading(true);
    try {
      setView(await api.getRecap(project.id, current, true));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setAiLoading(false);
    }
  };

  const acceptDisclosure = async () => {
    setDisclosure(null);
    await api.updateSettings({ aiDisclosureAccepted: true });
    await askAi(true);
  };

  return (
    <>
      <header className="content-head drag">
        <div style={{ minWidth: 0 }}>
          <h1>{project.name}</h1>
          <div className="path selectable no-drag">{project.path}</div>
        </div>
        <button className="primary no-drag" onClick={() => void api.openWindow('quicksave')}>
          Save where I am <span style={{ opacity: 0.75 }}>{prettyShortcut(settings.shortcutSave)}</span>
        </button>
      </header>

      <div className="content-body">
        {error && <div className="banner error">{error}</div>}
        {!project.exists && <div className="banner">This folder was moved or deleted. Snapshots are still here, but reopening files may not work.</div>}

        {snapshots && snapshots.length === 0 && (
          <div className="card">
            <h2>No snapshots yet</h2>
            <p className="muted" style={{ marginTop: 6 }}>
              When you stop working on {project.name}, press <kbd>{prettyShortcut(settings.shortcutSave)}</kbd> (or use the menu bar icon) and write what you were
              about to do next. Your recap shows up here.
            </p>
          </div>
        )}

        {loading && !view && (
          <div className="muted">
            <span className="spinner" /> Reading the snapshot…
          </div>
        )}

        {view && (
          <>
            <PermissionBanner view={view} />
            {view.snapshot.note && (
              <div className="note selectable">
                <span className="label">You were about to</span>
                {view.snapshot.note}
              </div>
            )}
            <div className="cols">
              <div className="stack">
                <RecapCard view={view} settings={settings} aiLoading={aiLoading} onAskAi={() => void askAi()} />
                <DetailsCard view={view} />
              </div>
              <div className="stack">
                <ReopenCard key={view.snapshot.id} view={view} />
                {snapshots && snapshots.length > 0 && <Timeline snapshots={snapshots} current={current} onPick={setCurrent} />}
              </div>
            </div>
          </>
        )}
      </div>

      {disclosure !== null && (
        <div className="modal-back">
          <div className="modal">
            <h2>What gets sent to Claude</h2>
            <p className="muted">
              The AI recap sends only this summary to Anthropic's API using your own key: file names, git status and commit messages, tab titles and addresses,
              and your note. It never sends the contents of your files. Secrets are removed first. You will only see this message once.
            </p>
            <pre className="mono">{disclosure}</pre>
            <div className="actions">
              <button onClick={() => setDisclosure(null)}>Cancel</button>
              <button className="primary" onClick={() => void acceptDisclosure()}>
                Send and write recap
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PermissionBanner({ view }: { view: RecapView }) {
  const denied = view.snapshot.errors.filter((e) => e.permissionDenied);
  if (!denied.length) return null;
  return (
    <div className="banner">
      <span>
        {denied[0].message} To save your tabs, allow Where Was I under System Settings, Privacy &amp; Security, Automation, then save again.
      </span>
      <button className="no-drag" onClick={() => void api.openAutomationSettings()}>
        Open System Settings
      </button>
    </div>
  );
}

function RecapCard({ view, settings, aiLoading, onAskAi }: { view: RecapView; settings: Settings; aiLoading: boolean; onAskAi: () => void }) {
  const lines = view.recap.text.split('\n').filter(Boolean);
  const isFirstStep = (l: string) => /^first step:/i.test(l);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Where you were</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className={`badge ${view.recap.source === 'ai' ? 'accent' : ''}`}>{view.recap.source === 'ai' ? 'AI recap' : 'Offline recap'}</span>
          {settings.aiRecap && view.recap.source === 'local' && (
            <button className="link" disabled={aiLoading} onClick={onAskAi}>
              {aiLoading ? 'Asking Claude…' : 'Ask Claude'}
            </button>
          )}
        </div>
      </div>
      {view.recap.aiError && (
        <div className="banner" style={{ marginBottom: 10 }}>
          {view.recap.aiError}
        </div>
      )}
      <div className="recap-text selectable">
        {lines.map((l, i) => (
          <p key={i} className={isFirstStep(l) ? 'first-step' : undefined}>
            {l}
          </p>
        ))}
      </div>
      <p className="faint" style={{ marginTop: 10, fontSize: 11.5 }}>
        Saved {formatTime(view.snapshot.createdAt)}
        {view.snapshot.auto ? ' automatically' : ''}
        {view.snapshot.git ? ` on ${view.snapshot.git.branch}` : ''}
      </p>
    </section>
  );
}

function DetailsCard({ view }: { view: RecapView }) {
  const { snapshot, changes } = view;
  const dirty = snapshot.git?.status.filter((l) => !l.startsWith('## ')) ?? [];
  const nothingChanged = !changes.newCommits.length && !changes.editedAfter.length && !changes.missingFiles.length && !changes.branchChanged;
  const otherErrors = snapshot.errors.filter((e) => !e.permissionDenied);
  return (
    <section className="card">
      <div className="section">
        <h3>Unfinished then</h3>
        {snapshot.git ? (
          dirty.length ? (
            <ul className="list mono selectable">
              {dirty.slice(0, 12).map((l) => (
                <li key={l}>
                  <span className="grow">{describeStatus(l)}</span>
                </li>
              ))}
              {dirty.length > 12 && <li className="muted">and {dirty.length - 12} more</li>}
            </ul>
          ) : (
            <p className="muted">Everything was committed.</p>
          )
        ) : (
          <p className="muted">This folder is not a git repository, so there is no commit info.</p>
        )}
        {snapshot.git && snapshot.git.stashes.length > 0 && <p className="muted">Plus {snapshot.git.stashes.length} stashed change(s).</p>}
      </div>

      <div className="section">
        <h3>What changed since</h3>
        {nothingChanged ? (
          <p className="muted">Nothing. The folder looks the same as when you saved.</p>
        ) : (
          <ul className="list selectable">
            {changes.branchChanged && (
              <li>
                <span className="grow">
                  Branch changed from <code>{changes.branchChanged.from}</code> to <code>{changes.branchChanged.to}</code>
                </span>
              </li>
            )}
            {changes.newCommits.slice(0, 6).map((c) => (
              <li key={c.hash}>
                <span className="badge">commit</span>
                <span className="grow">{c.subject}</span>
              </li>
            ))}
            {changes.editedAfter.slice(0, 8).map((f) => (
              <li key={f.path}>
                <span className="badge">edited</span>
                <span className="grow mono">{f.path}</span>
              </li>
            ))}
            {changes.missingFiles.slice(0, 8).map((f) => (
              <li key={f}>
                <span className="badge">gone</span>
                <span className="grow mono">{f}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {snapshot.shell && snapshot.shell.length > 0 && (
        <div className="section">
          <h3>Recent commands</h3>
          <ul className="list mono selectable">
            {snapshot.shell.slice(-8).map((c, i) => (
              <li key={i}>
                <span className="grow">{c}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {otherErrors.length > 0 && (
        <div className="section">
          <h3>Could not save everything</h3>
          <ul className="list">
            {otherErrors.map((e, i) => (
              <li key={i} className="muted">
                <span className="grow">{e.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ReopenCard({ view }: { view: RecapView }) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(view.items.filter((i) => i.suggested).map((i) => i.key)));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tabs = useMemo(() => view.items.filter((i) => i.kind === 'tab'), [view.items]);
  const files = useMemo(() => view.items.filter((i) => i.kind === 'file'), [view.items]);

  const toggle = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const reopen = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.restore({ projectId: view.snapshot.projectId, snapshotId: view.snapshot.id, keys: [...checked] }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!view.items.length) {
    return (
      <section className="card">
        <h2>Reopen</h2>
        <p className="muted" style={{ marginTop: 6 }}>
          No tabs or recent files were saved in this snapshot.
        </p>
      </section>
    );
  }

  const group = (title: string, items: RecapItem[]) =>
    items.length > 0 && (
      <div className="items-group">
        <h3>{title}</h3>
        <ul className="items">
          {items.map((i) => (
            <li key={i.key}>
              <label className="item" title={i.detail}>
                <input type="checkbox" checked={checked.has(i.key)} onChange={() => toggle(i.key)} />
                <span className="icon">{i.kind === 'tab' ? '◎' : '▤'}</span>
                <span className="label">
                  {i.label}
                  <span className="detail">{i.detail}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    );

  const tooMany = checked.size > MAX_REOPEN;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Reopen</h2>
        <div className="btns">
          <button className="link" onClick={() => setChecked(new Set(view.items.slice(0, MAX_REOPEN).map((i) => i.key)))}>
            All
          </button>
          <button className="link" onClick={() => setChecked(new Set())}>
            None
          </button>
        </div>
      </div>
      {group('Tabs', tabs)}
      {group('Files', files)}
      <div className="items-foot">
        <span className={tooMany ? '' : 'muted'} style={tooMany ? { color: 'var(--danger)' } : undefined}>
          {tooMany ? `Pick at most ${MAX_REOPEN}` : `${checked.size} selected`}
        </span>
        <button className="primary" disabled={busy || checked.size === 0 || tooMany} onClick={() => void reopen()}>
          {busy ? 'Opening…' : 'Reopen selected'}
        </button>
      </div>
      {error && (
        <div className="banner error" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
      {result && (
        <div className={`banner ${result.missing.length || result.failed.length ? '' : 'info'}`} style={{ marginTop: 10, display: 'block' }}>
          Opened {result.opened} item{result.opened === 1 ? '' : 's'}.
          {result.missing.length > 0 && <> These files no longer exist: {result.missing.join(', ')}.</>}
          {result.failed.length > 0 && <> Could not open: {result.failed.join(', ')}.</>}
        </div>
      )}
    </section>
  );
}

function Timeline({ snapshots, current, onPick }: { snapshots: SnapshotSummary[]; current: string | null; onPick: (id: string) => void }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Timeline</h2>
        <span className="faint">{snapshots.length}</span>
      </div>
      <ul className="timeline">
        {snapshots.map((s) => (
          <li key={s.id}>
            <button className={s.id === current ? 'current' : ''} onClick={() => onPick(s.id)} title={formatTime(s.createdAt)}>
              <span style={{ whiteSpace: 'nowrap' }}>{timeAgo(s.createdAt)}</span>
              <span className="tnote">{s.note || (s.auto ? '' : 'No note')}</span>
              {s.auto && <span className="badge">auto</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
