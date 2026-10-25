import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AppInfo, ProjectListItem, Settings } from '../shared/types';
import { api, errorText, prettyShortcut, timeAgo } from './api';

type Info = AppInfo & { shortcutErrors: string[] };

export function SettingsWindow() {
  const [s, setS] = useState<Settings | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(0);

  const load = useCallback(async () => {
    const [settings, appInfo, list] = await Promise.all([api.getSettings(), api.appInfo(), api.listProjects()]);
    setS(settings);
    setInfo(appInfo);
    setProjects(list);
  }, []);

  useEffect(() => {
    void load().catch((e) => setError(errorText(e)));
    const offs = [api.onSettingsChanged(() => void load()), api.onSnapshotsChanged(() => void load())];
    return () => offs.forEach((o) => o());
  }, [load]);

  useEffect(() => {
    if (!savedAt) return;
    const t = setTimeout(() => setSavedAt(0), 1500);
    return () => clearTimeout(t);
  }, [savedAt]);

  if (!s || !info) return <div className="settings">{error ?? <span className="spinner" />}</div>;

  const update = async (patch: Partial<Settings>) => {
    setError(null);
    try {
      setS(await api.updateSettings(patch));
      setInfo(await api.appInfo());
      setSavedAt(Date.now());
    } catch (e) {
      setError(errorText(e));
      void load();
    }
  };

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="settings">
      <div className="drag" style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 36 }} />
      <h1>Settings</h1>
      {error && <div className="banner error">{error}</div>}

      <Card title="Project folders" hint="The folders Where Was I takes snapshots of. Usually one per coding project.">
        <div className="projects-table">
          {projects.length === 0 && <p className="muted">No folders yet.</p>}
          {projects.map((p) => (
            <div className="row" key={p.id}>
              <div className="text">
                <b>{p.name}</b>
                <div className="p selectable">{p.path}</div>
                <small>
                  {p.snapshotCount} snapshot{p.snapshotCount === 1 ? '' : 's'}
                  {p.lastSnapshotAt ? `, last ${timeAgo(p.lastSnapshotAt)}` : ''}
                  {!p.exists ? '. Folder not found.' : ''}
                </small>
              </div>
              <div className="btns">
                <button className="danger" disabled={p.snapshotCount === 0} onClick={() => void run(() => api.deleteProjectSnapshots(p.id))}>
                  Delete snapshots
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`Remove ${p.name} from the list? Its snapshots are deleted too.`)) void run(() => api.removeProject(p.id, true));
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10 }}>
          <button className="primary" onClick={() => void run(() => api.addProject())}>
            Add a project folder…
          </button>
        </div>
      </Card>

      <Card title="Browser tabs" hint="Where Was I asks running browsers for tab titles and addresses. It never opens a browser to do this, never reads private or incognito windows, and never reads cookies, history, passwords or page contents.">
        {(['chrome', 'arc', 'safari'] as const).map((b) => (
          <Toggle
            key={b}
            label={{ chrome: 'Google Chrome', arc: 'Arc', safari: 'Safari' }[b]}
            checked={s.browsers[b]}
            onChange={(v) => void update({ browsers: { ...s.browsers, [b]: v } })}
          />
        ))}
        <Toggle
          label="Keep the part of addresses after ?"
          hint="Off by default, because that part often holds search terms or login codes. Secrets are removed either way."
          checked={s.keepQueryStrings}
          onChange={(v) => void update({ keepQueryStrings: v })}
        />
        <div className="row" style={{ display: 'block' }}>
          <div className="text" style={{ marginBottom: 6 }}>
            Never save tabs from
            <small>One per line. A domain (like mail.google.com) also covers its subdomains. A word without a dot (like bank) blocks any address that contains it.</small>
          </div>
          <ListEditor value={s.excludedDomains} onSave={(v) => void update({ excludedDomains: v })} />
        </div>
      </Card>

      <Card title="What a snapshot includes">
        <NumberRow label="Look back this many hours for edited files" min={1} max={168} value={s.lookbackHours} onSave={(n) => void update({ lookbackHours: n })} />
        <Toggle
          label="Recent terminal commands"
          hint="Reads the last commands from ~/.zsh_history, with passwords and tokens removed. Off by default."
          checked={s.shellHistory}
          onChange={(v) => void update({ shellHistory: v })}
        />
      </Card>

      <Card title="Automatic snapshots">
        <Toggle
          label="Save automatically when I step away"
          hint="When the screen locks, the Mac sleeps, or you are idle for 15 minutes, and only for projects whose files changed in the last hour. At most one per project every 30 minutes."
          checked={s.autoSnapshot}
          onChange={(v) => void update({ autoSnapshot: v })}
        />
      </Card>

      <Card title="Keeping snapshots" hint="Older snapshots are deleted automatically. Automatic ones go first. The newest one is always kept.">
        <NumberRow label="Snapshots to keep per project" min={1} max={500} value={s.retentionCount} onSave={(n) => void update({ retentionCount: n })} />
        <NumberRow label="Delete snapshots older than (days)" min={1} max={3650} value={s.retentionDays} onSave={(n) => void update({ retentionDays: n })} />
      </Card>

      <Card title="Opening files">
        <Toggle
          label="Open files in VS Code"
          hint={info.vscodeAvailable ? 'Opens the project folder and the chosen files in one VS Code window.' : 'VS Code was not found, so files open in their default app.'}
          checked={s.openFilesInVSCode}
          onChange={(v) => void update({ openFilesInVSCode: v })}
        />
      </Card>

      <Card title="Keyboard shortcuts" hint="These work from any app. Use names like CommandOrControl, Shift, Alt joined with +.">
        <TextRow label={`Save where I am (${prettyShortcut(s.shortcutSave)})`} value={s.shortcutSave} onSave={(v) => void update({ shortcutSave: v })} />
        <TextRow label={`Show my recap (${prettyShortcut(s.shortcutRecap)})`} value={s.shortcutRecap} onSave={(v) => void update({ shortcutRecap: v })} />
        {info.shortcutErrors.map((e) => (
          <div key={e} className="banner" style={{ marginTop: 8 }}>
            {e} Try a different shortcut.
          </div>
        ))}
      </Card>

      <Card title="General">
        <Toggle label="Open Where Was I when I log in" hint="Only works in the installed app, not while testing with npm start." checked={s.launchAtLogin} onChange={(v) => void update({ launchAtLogin: v })} />
      </Card>

      <AiCard s={s} info={info} update={update} reload={load} />

      <p className="faint" style={{ textAlign: 'center' }}>Where Was I {info.version}. Everything is stored on this Mac.</p>
      {savedAt > 0 && <span className="badge accent saved-pill">Saved</span>}
    </div>
  );
}

function AiCard({ s, info, update, reload }: { s: Settings; info: Info; update: (p: Partial<Settings>) => Promise<void>; reload: () => Promise<void> }) {
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const saveKey = async (value: string) => {
    setMsg(null);
    try {
      await api.setApiKey(value);
      setKey('');
      setMsg(value ? 'Key saved in your Mac keychain.' : 'Key removed.');
      await reload();
    } catch (e) {
      setMsg(errorText(e));
    }
  };

  return (
    <Card
      title="AI recap (optional)"
      hint="Uses your own Claude API key to write a smarter recap. Off until you turn it on. Sends only the snapshot summary (file names, git status, tab titles and addresses, your note), never file contents, with secrets removed. This is the only part of the app that uses the internet."
    >
      <Toggle label="Use the AI recap" checked={s.aiRecap} onChange={(v) => void update({ aiRecap: v })} />
      <div className="row">
        <div className="text">
          Claude API key
          <small>{info.hasApiKey ? 'A key is saved (encrypted with your Mac keychain).' : 'Get one at console.anthropic.com. Stored encrypted, never in plain text.'}</small>
        </div>
        <div className="btns">
          <input type="password" placeholder={info.hasApiKey ? '••••••••' : 'sk-ant-…'} value={key} onChange={(e) => setKey(e.target.value)} />
          <button disabled={!key} onClick={() => void saveKey(key.trim())}>
            Save
          </button>
          {info.hasApiKey && (
            <button className="danger" onClick={() => void saveKey('')}>
              Remove
            </button>
          )}
        </div>
      </div>
      {msg && <p className="muted" style={{ paddingBottom: 6 }}>{msg}</p>}
      <TextRow label="Model name" hint="claude-haiku-5-5 is fast and low cost." value={s.aiModel} onSave={(v) => void update({ aiModel: v })} />
    </Card>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {hint ? <p className="muted">{hint}</p> : <div style={{ height: 6 }} />}
      {children}
    </section>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="row check">
      <span className="text">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function NumberRow({ label, value, min, max, onSave }: { label: string; value: number; min: number; max: number; onSave: (n: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Number.parseInt(v, 10);
    if (Number.isInteger(n) && n !== value) onSave(Math.min(max, Math.max(min, n)));
    else setV(String(value));
  };
  return (
    <div className="row">
      <span className="text">{label}</span>
      <input type="number" min={min} max={max} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </div>
  );
}

function TextRow({ label, hint, value, onSave }: { label: string; hint?: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    if (v.trim() && v.trim() !== value) onSave(v.trim());
    else setV(value);
  };
  return (
    <div className="row">
      <span className="text">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="text" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} spellCheck={false} />
    </div>
  );
}

function ListEditor({ value, onSave }: { value: string[]; onSave: (v: string[]) => void }) {
  const [text, setText] = useState(value.join('\n'));
  useEffect(() => setText(value.join('\n')), [value]);
  return (
    <textarea
      rows={6}
      value={text}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const list = text
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        if (list.join('\n') !== value.join('\n')) onSave(list);
      }}
    />
  );
}
