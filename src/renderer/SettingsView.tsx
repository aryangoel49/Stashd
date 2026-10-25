// Settings, inside the app window. Changes save as you make them.

import { useEffect, useState, type ReactNode } from 'react';
import type { Accent, AppInfo, Settings } from '../shared/types';
import { CLAUDE_MODELS, modelInfo } from '../shared/models';
import { api, errorText, prettyShortcut, useSettings } from './api';

const ACCENTS: { id: Accent; color: string; name: string }[] = [
  { id: 'indigo', color: '#5e6ad2', name: 'Indigo' },
  { id: 'teal', color: '#2a9d8f', name: 'Teal' },
  { id: 'coral', color: '#e07a5f', name: 'Coral' },
];

export function SettingsView() {
  const s = useSettings();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const refreshInfo = () => void api.appInfo().then(setInfo);
  useEffect(refreshInfo, []);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 1400);
    return () => clearTimeout(t);
  }, [saved]);

  if (!s || !info) return <div className="detail"><span className="spinner" /></div>;

  const update = async (patch: Partial<Settings>) => {
    setError(null);
    try {
      await api.updateSettings(patch);
      setSaved(true);
      refreshInfo();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="detail settings fade-in">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="display" style={{ fontSize: 22 }}>Settings</div>
        {saved && <span className="faint small fade-in">Saved</span>}
      </div>
      {error && <div className="banner">{error}</div>}

      <div className="srow card glass-card" style={{ padding: '10px 14px' }}>
        <span>
          Briefs are written by <b>{writerNow(info, s.aiModel)}</b>
          <span className="faint small" style={{ display: 'block' }}>
            {!info.hasApiKey && info.appleAi !== 'available' && 'Connect Claude below, or turn on Apple Intelligence, for smarter briefs. '}
            Sorting what belongs to which job always happens on your Mac, with no AI.
          </span>
        </span>
      </div>

      <ClaudeCard connected={info.hasApiKey} model={s.aiModel} onChange={refreshInfo} onModel={(m) => void update({ aiModel: m })} />

      <Card title="Apple Intelligence" hint="Used for briefs when Claude isn't connected. It runs on your Mac, for free, and works offline.">
        <div className="srow">
          <span>{info.appleAi === 'available' ? 'Ready on this Mac' : info.appleAi === 'unknown' ? 'Checking…' : 'Not available right now'}</span>
          {info.appleAi !== 'available' && (
            <button className="btn small" onClick={() => void api.openAppleAiSettings()}>
              Open Apple Intelligence settings
            </button>
          )}
        </div>
        {info.appleAi !== 'available' && <p className="faint small" style={{ margin: '4px 0 0' }}>Turn on Apple Intelligence in System Settings. It may need a few minutes to download.</p>}
      </Card>

      <Card title="Look">
        <div className="srow">
          <span>Accent colour</span>
          <span style={{ display: 'inline-flex', gap: 10 }}>
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                className={`swatch ${s.accent === a.id ? 'on' : ''}`}
                style={{ background: a.color }}
                aria-label={a.name}
                title={a.name}
                onClick={() => void update({ accent: a.id })}
              />
            ))}
          </span>
        </div>
      </Card>

      <Card title="Keyboard shortcuts" hint="These work from any app. Use names like CommandOrControl, Shift and Alt, joined with +.">
        <TextRow label={`Save what I'm working on (${prettyShortcut(s.shortcutSave)})`} value={s.shortcutSave} onSave={(v) => void update({ shortcutSave: v })} />
        <TextRow label={`Show my brief (${prettyShortcut(s.shortcutRecap)})`} value={s.shortcutRecap} onSave={(v) => void update({ shortcutRecap: v })} />
        {info.shortcutErrors.map((e) => (
          <div key={e} className="banner" style={{ marginTop: 6 }}>
            {e} Try a different one.
          </div>
        ))}
      </Card>

      <Card title="Everyday apps and sites" hint="These are never part of a job and are never closed by Tidy up. The app also learns these as you go. One per line.">
        <ListRow label="Apps" value={s.lifestyleApps} onSave={(v) => void update({ lifestyleApps: v })} />
        <ListRow label="Sites" value={s.lifestyleSites} onSave={(v) => void update({ lifestyleSites: v })} />
      </Card>

      <Card title="Privacy" hint="Where Was I only looks when you press the shortcut. It never reads page contents, document text, passwords, cookies or private windows.">
        <ListRow label="Never save tabs from" value={s.excludedDomains} onSave={(v) => void update({ excludedDomains: v })} />
        {(['chrome', 'arc', 'safari'] as const).map((b) => (
          <Toggle key={b} label={`Read tabs from ${{ chrome: 'Google Chrome', arc: 'Arc', safari: 'Safari' }[b]}`} on={s.browsers[b]} onChange={(v) => void update({ browsers: { ...s.browsers, [b]: v } })} />
        ))}
        <Toggle label="Keep the part of addresses after ?" hint="Off by default. Secrets are removed either way." on={s.keepQueryStrings} onChange={(v) => void update({ keepQueryStrings: v })} />
        <div className="srow">
          <span>Permission to see your tabs and files</span>
          <button className="btn small" onClick={() => void api.openAutomationSettings()}>
            Open System Settings
          </button>
        </div>
      </Card>

      <Card title="General">
        <Toggle label="Open Where Was I when I log in" hint="Works in the installed app." on={s.launchAtLogin} onChange={(v) => void update({ launchAtLogin: v })} />
        <div className="srow">
          <span>Delete every saved job</span>
          <button className="btn small danger" onClick={() => void api.deleteAll()}>
            Delete everything…
          </button>
        </div>
      </Card>

      <p className="faint small" style={{ textAlign: 'center' }}>Where Was I {info.version}. Everything is stored on this Mac.</p>
    </div>
  );
}

function ClaudeCard({ connected, model, onChange, onModel }: { connected: boolean; model: string; onChange: () => void; onModel: (m: string) => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const connect = async (value: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await api.connectClaude(value);
      setKey('');
      setMsg(value ? 'Connected ✓' : 'Disconnected.');
      onChange();
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Claude" hint="Connect your own Claude account for the best briefs and job names. You pay Anthropic directly, a tiny amount per brief.">
      {connected ? (
        <div className="srow">
          <span>
            <span className="live" style={{ display: 'inline-block', marginRight: 8 }} />
            Connected
          </span>
          <button className="btn small" disabled={busy} onClick={() => void connect('')}>
            Disconnect
          </button>
        </div>
      ) : (
        <>
          <ol className="steps">
            <li>
              Open the Claude Console, sign in, and click <b>Create key</b>.{' '}
              <button className="link" onClick={() => void api.openClaudeKeysPage()}>
                Open Claude Console
              </button>
            </li>
            <li>Copy the key, paste it here, and click Connect.</li>
          </ol>
          <form
            style={{ display: 'flex', gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (key.trim()) void connect(key.trim());
            }}
          >
            <input className="field" type="password" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
            <button className="btn primary" type="submit" disabled={busy || !key.trim()}>
              {busy ? <span className="spinner" /> : 'Connect'}
            </button>
          </form>
          <details className="faint small" style={{ marginTop: 10 }}>
            <summary>What gets sent to Claude</summary>
            <p style={{ margin: '6px 0 0' }}>
              When you save, the names of your open files, your tab titles and addresses (with secrets removed), which one you were on last, and your note.
              Never what's inside your files or pages. Your key is stored encrypted in your Mac's keychain. Connecting means you're OK with this.
            </p>
          </details>
        </>
      )}
      {msg && <div className={msg.startsWith('Connected') ? 'small' : 'banner'} style={{ marginTop: 8, color: msg.startsWith('Connected') ? 'var(--accent)' : undefined }}>{msg}</div>}
      <ModelRow model={model} onModel={onModel} />
    </Card>
  );
}

function writerNow(info: AppInfo, model: string): string {
  if (info.hasApiKey) return `Claude ${modelInfo(model)?.name ?? model}`.trim();
  if (info.appleAi === 'available') return 'Apple Intelligence';
  return 'a simple template';
}

function ModelRow({ model, onModel }: { model: string; onModel: (m: string) => void }) {
  const info = modelInfo(model);
  return (
    <div className="srow">
      <span>
        Model
        <span className="faint small" style={{ display: 'block' }}>{info ? `${info.blurb} ${info.cost[0].toUpperCase()}${info.cost.slice(1)}.` : 'A model you typed in yourself.'}</span>
      </span>
      <select className="field save-to-select" aria-label="Claude model" value={model} onChange={(e) => onModel(e.target.value)}>
        {CLAUDE_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
        {!info && <option value={model}>{model}</option>}
      </select>
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card glass-card">
      <h3 style={{ margin: 0 }}>{title}</h3>
      {hint && <p className="muted small" style={{ margin: '4px 0 10px' }}>{hint}</p>}
      {!hint && <div style={{ height: 8 }} />}
      {children}
    </section>
  );
}

function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="srow">
      <span>
        {label}
        {hint && <span className="faint small" style={{ display: 'block' }}>{hint}</span>}
      </span>
      <button className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on} aria-label={label}>
        <span className="track" />
      </button>
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
    <div className="srow">
      <span>
        {label}
        {hint && <span className="faint small" style={{ display: 'block' }}>{hint}</span>}
      </span>
      <input className="field" style={{ width: 240 }} value={v} spellCheck={false} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </div>
  );
}

function ListRow({ label, value, onSave }: { label: string; value: string[]; onSave: (v: string[]) => void }) {
  const [text, setText] = useState(value.join('\n'));
  useEffect(() => setText(value.join('\n')), [value]);
  return (
    <div style={{ padding: '6px 0' }}>
      <div className="small" style={{ marginBottom: 4 }}>{label}</div>
      <textarea
        className="field"
        rows={4}
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const list = text.split('\n').map((l) => l.trim()).filter(Boolean);
          if (list.join('\n') !== value.join('\n')) onSave(list);
        }}
      />
    </div>
  );
}
