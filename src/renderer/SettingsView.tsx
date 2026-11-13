// Settings, inside the app window. Changes save as you make them.

import { useEffect, useState, type ReactNode } from 'react';
import type { AppInfo, Settings } from '../shared/types';
import { CLAUDE_MODELS, modelInfo } from '../shared/models';
import { Switch } from './components/ui/switch';
import { Icon } from './icons';
import { AnimatePresence, Button, motion, spring } from './ui';
import { api, errorText, prettyShortcut, useSettings } from './api';
import { UpdateRow } from './Update';


type Section = 'general' | 'briefs' | 'privacy';
const SECTIONS: [Section, string][] = [
  ['general', 'General'],
  ['briefs', 'Briefs & AI'],
  ['privacy', 'Privacy'],
];

export function SettingsView() {
  const s = useSettings();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<Section>('general');

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

      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {SECTIONS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {tab === id && <motion.span layoutId="settings-tab" className="tab-thumb" transition={spring} />}
            <span className="seg-label">{label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} className="settings-body" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
          {tab === 'general' && (
            <>
      <Card title="Look and sound">
        <div className="srow">
          <span>Appearance</span>
          <span className="segmented" role="radiogroup" aria-label="Appearance">
            {(
              [
                ['light', 'Light'],
                ['dark', 'Dark'],
                ['system', 'Match Mac'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="radio" aria-checked={s.appearance === id} className={s.appearance === id ? 'on' : ''} onClick={() => void update({ appearance: id })}>
                {s.appearance === id && <motion.span layoutId="seg" className="seg-thumb" transition={spring} />}
                <span className="seg-label">{label}</span>
              </button>
            ))}
          </span>
        </div>
        <Toggle label="Sounds" hint="Short sounds when you stash, pack up, unpack and tidy, when Stashd names a folder, and when something doesn't come back." on={s.sounds} onChange={(v) => void update({ sounds: v })} />
      </Card>
      <Card title="Keyboard shortcuts" hint="These work from any app. Use names like Control, Alt (Option), Shift and Command, joined with +.">
        <TextRow label={`Save what I'm working on (${prettyShortcut(s.shortcutSave)})`} value={s.shortcutSave} onSave={(v) => void update({ shortcutSave: v })} />
        <TextRow label={`Show my brief (${prettyShortcut(s.shortcutRecap)})`} value={s.shortcutRecap} onSave={(v) => void update({ shortcutRecap: v })} />
        <TextRow label={`Open my pinned folder, or the last one (${prettyShortcut(s.shortcutOpen)})`} value={s.shortcutOpen} onSave={(v) => void update({ shortcutOpen: v })} />
        <TextRow label={`Tidy all (${prettyShortcut(s.shortcutTidy)})`} value={s.shortcutTidy} onSave={(v) => void update({ shortcutTidy: v })} />
        <Toggle label="Smart Tidy all" hint="Before closing, each piece of work you have open is saved: into its folder, or a new one you name afterwards. Clutter just closes. Off: Tidy all saves the folders you have open, then simply closes everything else." on={s.tidySort} onChange={(v) => void update({ tidySort: v })} />
        <Toggle label="Tidy all with a four-finger double tap" hint="Tap the trackpad twice with four fingers to tidy, like the shortcut. Uses your last choice: keep what you're on, or close everything." on={s.tidyGesture} onChange={(v) => void update({ tidyGesture: v })} />
        {info.shortcutErrors.map((e) => (
          <div key={e} className="banner" style={{ marginTop: 6 }}>
            {e} Try a different one.
          </div>
        ))}
      </Card>
      <Card title="Automatic saving" hint="Stashd saves your work by itself when you move on to something else, close the lid, lock or shut down your Mac, or walk away. It never closes anything.">
        <Toggle label="Save automatically" on={s.autoSave} onChange={(v) => void update({ autoSave: v })} />
        <Toggle
          label="Show short cards"
          hint="“Saved Climate essay” when you move on, “Saved before your Mac slept” when you’re back, and “Bring it back?” after a restart. Off: Stashd saves quietly and shows no cards."
          on={s.autoSaveTalk === 'helpful'}
          onChange={(v) => void update({ autoSaveTalk: v ? 'helpful' : 'quiet' })}
        />
        <Toggle
          label="Save new work for me too"
          hint="Work you have open but never saved (two or more things that belong together) is kept under “Saved for you” when you step away, close the lid or shut down. Nothing is closed, and ones you don’t use go after 14 days."
          on={s.autoSave && s.autoSaveNew}
          onChange={(v) => void update({ autoSaveNew: v })}
        />
      </Card>
      <Card title="Updates" hint="Stashd updates itself: it downloads new versions quietly and installs them the next time it starts. It only asks GitHub which version is the latest.">
        <UpdateRow />
      </Card>
      <Card title="Unpack">
        <Toggle
          label="Put windows back exactly where they were"
          hint="Unpack moves and resizes your windows to the places they had when you saved, using the window you have open. Off: tabs go into your open window and nothing is moved. Needs Accessibility for apps other than browsers."
          on={s.windowPlaces}
          onChange={(v) => {
            void update({ windowPlaces: v });
            if (v) void api.setupAccessibility();
          }}
        />
      </Card>
      <ChromeHelperCard />
      <Card title="Startup">
        <Toggle label="Open Stashd when I log in" hint="Works in the installed app." on={s.launchAtLogin} onChange={(v) => void update({ launchAtLogin: v })} />
        <div className="srow">
          <span>
            The welcome
            <span className="faint small" style={{ display: 'block' }}>Permissions, Stashd AI and the Chrome helper, step by step.</span>
          </span>
          <Button size="small" onClick={() => void api.openWindow('welcome')}>
            Show it again
          </Button>
        </div>
        <div className="srow">
          <span>
            Quit Stashd
            <span className="faint small" style={{ display: 'block' }}>Your shortcuts stop working until you open it again.</span>
          </span>
          <Button size="small" onClick={() => void api.quit()}>
            <Icon name="power" /> Quit
          </Button>
        </div>
      </Card>
            </>
          )}
          {tab === 'briefs' && (
            <>
      <div className="srow card glass-card" style={{ padding: '10px 14px' }}>
        <span>
          Briefs are written by <b>{writerNow(info, s)}</b>
          <span className="faint small" style={{ display: 'block' }}>
            {!info.hasApiKey && !s.stashdAi && 'Turn on Stashd AI below for smarter briefs. '}
            Sorting what belongs in which folder always happens on your Mac, using a small built-in model. Free, offline and private.
          </span>
        </span>
      </div>
      <Card title="Stashd AI" hint="Writes your briefs and folder names with Claude, for free, the same way on every Mac.">
        <Toggle
          label="Use Stashd AI"
          hint="Each brief sends Stashd’s server the names and titles of what you saved, cleaned web addresses, your note and the end of an open AI chat (secrets removed). Never file contents. The server passes it to Claude, made by Anthropic, and keeps nothing. Free for everyday use, with a daily limit."
          on={s.stashdAi}
          onChange={(v) => void update({ stashdAi: v })}
        />
      </Card>
      <ClaudeCard connected={info.hasApiKey} model={s.aiModel} onChange={refreshInfo} onModel={(m) => void update({ aiModel: m })} />
            </>
          )}
          {tab === 'privacy' && (
            <>
      <Card title="Privacy" hint="Stashd looks at what's open when you press the shortcut, and now and then to spot work you've packed and to know roughly how long each thing was in front (for better briefs; that's kept on this Mac for a few hours). It never reads page contents, document text, passwords, cookies or private windows.">
        <ListRow label="Never save tabs from" value={s.excludedDomains} onSave={(v) => void update({ excludedDomains: v })} />
        {(['chrome', 'brave', 'edge', 'vivaldi', 'arc', 'safari'] as const).map((b) => (
          <Toggle key={b} label={`Read tabs from ${{ chrome: 'Google Chrome', brave: 'Brave', edge: 'Microsoft Edge', vivaldi: 'Vivaldi', arc: 'Arc', safari: 'Safari' }[b]}`} on={s.browsers[b]} onChange={(v) => void update({ browsers: { ...s.browsers, [b]: v } })} />
        ))}
        <Toggle label="Keep the part of addresses after ?" hint="Off by default: only the parts that say which page it is (like a YouTube video) are kept. Secrets are removed either way." on={s.keepQueryStrings} onChange={(v) => void update({ keepQueryStrings: v })} />
        <MemoryRow />
        <div className="srow">
          <span>Permission to see your tabs and files</span>
          <Button size="small" onClick={() => void api.openAutomationSettings()}>
            Open System Settings
          </Button>
        </div>
      </Card>
      <Card title="Everyday apps and sites" hint="These never go in a folder and are never closed by Pack up. The app also learns these as you go. One per line.">
        <ListRow label="Apps" value={s.lifestyleApps} onSave={(v) => void update({ lifestyleApps: v })} />
        <ListRow label="Sites" value={s.lifestyleSites} onSave={(v) => void update({ lifestyleSites: v })} />
      </Card>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      <p className="faint small" style={{ textAlign: 'center' }}>Stashd {info.version}. Everything is stored on this Mac.</p>
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
    <Card title="Your own Claude key (optional)" hint="Only if you’d rather use your own Anthropic account, with no daily limit. You pay Anthropic directly, a tiny amount per brief.">
      {connected ? (
        <div className="srow">
          <span>
            <span className="live" style={{ display: 'inline-block', marginRight: 8 }} />
            Connected
          </span>
          <Button size="small" disabled={busy} onClick={() => void connect('')}>
            Disconnect
          </Button>
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
            <Button variant="primary" type="submit" disabled={busy || !key.trim()}>
              {busy ? <span className="spinner" /> : 'Connect'}
            </Button>
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

function writerNow(info: AppInfo, s: Settings): string {
  if (info.hasApiKey) return `Claude ${modelInfo(s.aiModel)?.name ?? s.aiModel} (your key)`.trim();
  if (s.stashdAi) return 'Stashd AI';
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
      <Switch checked={on} onCheckedChange={onChange} aria-label={label} />
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

/** Stashd's memory: how much it remembers, and a way to make it forget (asks once more before it does). */
function MemoryRow() {
  const [info, setInfo] = useState<{ moments: number; since: string | null; chats: number } | null>(null);
  const [sure, setSure] = useState(false);
  useEffect(() => {
    void api.memoryInfo().then(setInfo, () => undefined);
  }, []);
  const since = info?.since ? new Date(info.since).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : null;
  return (
    <div className="srow">
      <span>
        Stashd’s memory
        <span className="faint small" style={{ display: 'block' }}>
          When you saved and what was open (titles and sites, never page contents), so Stashd can learn your habits. It stays on this Mac.
          {info && info.moments > 0 && ` ${info.moments} ${info.moments === 1 ? 'moment' : 'moments'} since ${since}.`}
        </span>
      </span>
      <Button
        size="small"
        variant={sure ? 'danger' : 'secondary'}
        // Ask Stashd chats count too: they're cleared by the same button.
        disabled={!info || (info.moments === 0 && !info.chats)}
        onClick={() => {
          if (!sure) return setSure(true);
          setSure(false);
          void api.forgetMemory().then(setInfo, () => undefined);
        }}
        onBlur={() => setSure(false)}
      >
        {sure ? 'Forget all of it' : 'Forget my history'}
      </Button>
    </div>
  );
}

/** Stashd's Chrome extension: added (Chrome has talked to Stashd), or a button to add it, with the same
 *  guide as the welcome. For anyone who skipped it there. */
function ChromeHelperCard() {
  const [added, setAdded] = useState<boolean | null>(null);
  useEffect(() => {
    void api.chromeHelperAdded().then(setAdded, () => setAdded(false));
    return api.onChromeHelperAdded(() => setAdded(true));
  }, []);
  return (
    <Card title="Chrome extension" hint="Each folder's tabs sit in a Chrome tab group named after it, when you save them and when you unpack. Stashd also remembers how far into a video you were.">
      <div className="srow">
        <span>
          {added ? 'Added to Chrome' : 'Not added yet'}
          <span className="muted small" style={{ display: 'block' }}>
            {added
              ? 'Add it again if you removed it from Chrome or it stopped working.'
              : "Add to Chrome opens Chrome's extensions page, with a small card beside it that walks you through it."}
          </span>
        </span>
        <Button size="small" variant={added ? undefined : 'primary'} onClick={() => void api.setupChromeGroups()}>
          {added ? 'Add again' : 'Add to Chrome'}
        </Button>
      </div>
    </Card>
  );
}
