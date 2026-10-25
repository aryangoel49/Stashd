// The save box (⇧⌘S): a name, "Context for the robot", Tidy up, and Enter.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CollectorError, Item, SavePreview } from '../shared/types';
import { api, errorText, useFitWindow, useSettings } from './api';
import { Icon } from './icons';

const EXAMPLES = [
  'halfway through paragraph 3…',
  "waiting on Sam's reply before I send this",
  'need 2 more sources on sea levels',
  'flights booked, hotel still to pick',
  'stuck on question 4, ask in office hours',
];

function summary(items: Item[]): string {
  const docs = items.filter((i) => i.kind === 'doc' || i.kind === 'folder').length;
  const tabs = items.filter((i) => i.kind === 'tab').length;
  const apps = items.filter((i) => i.kind === 'app').length;
  const parts = [];
  if (docs) parts.push(`${docs} ${docs === 1 ? 'file' : 'files'}`);
  if (tabs) parts.push(`${tabs} ${tabs === 1 ? 'tab' : 'tabs'}`);
  if (apps) parts.push(`${apps} ${apps === 1 ? 'app' : 'apps'}`);
  return parts.join(' · ') || 'nothing selected';
}

export function Save() {
  useSettings();
  const ref = useFitWindow<HTMLFormElement>();
  const nameRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<SavePreview | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [tidy, setTidy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'saved'>('loading');
  const stateRef = useRef(state);
  stateRef.current = state;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (state !== 'loading') return setSlow(false);
    const t = setTimeout(() => setSlow(true), 2000);
    return () => clearTimeout(t);
  }, [state]);
  const [error, setError] = useState<string | null>(null);
  const [example, setExample] = useState(0);

  const modeRef = useRef<'save' | 'pack' | 'last'>('last');
  // Once you type in the name, an AI suggestion never replaces it.
  const nameTouched = useRef(false);
  const [aiNaming, setAiNaming] = useState(false);
  const load = async (opts: { asNew?: boolean; jobId?: string } = {}) => {
    setError(null);
    try {
      const p = await api.previewSave(opts);
      setPreview(p);
      setName(p.suggestedName);
      setTidy(modeRef.current === 'pack' ? true : modeRef.current === 'save' ? false : p.tidyUp);
      setPicked(new Set([...p.sure, ...p.kept].map((i) => i.key)));
      // Show the list straight away when there's something to decide: related things, kept things,
      // or when adding to an existing job.
      setExpanded(p.likely.length > 0 || p.kept.length > 0 || p.jobId !== null);
      setState('ready');
      nameTouched.current = false;
      if (!p.jobId && p.sure.length) {
        // A new job: ask Claude or Apple Intelligence (if set up) for a better name, in the background.
        setAiNaming(true);
        void api
          .aiName(p.sure.map((i) => i.key))
          .then((n) => {
            if (n && !nameTouched.current) setName(n);
          })
          .catch(() => undefined)
          .finally(() => setAiNaming(false));
      }
      setTimeout(() => noteRef.current?.focus(), 0);
    } catch (e) {
      setError(errorText(e));
      setState('ready');
    }
  };

  useEffect(() => {
    const begin = (mode: 'save' | 'pack' | 'last' = 'last') => {
      modeRef.current = mode;
      setState('loading');
      setPreview(null);
      setNote('');
      setExpanded(false);
      setExample(Math.floor(Math.random() * EXAMPLES.length));
      void load();
    };
    begin();
    const offs = [
      api.onSaveBegin(begin),
      api.onWindowBlur(() => {
        // Like Spotlight: clicking away closes it, unless you've typed a note. Not while it's still
        // looking, because macOS may be showing its "allow access?" pop-up, which takes focus.
        if (stateRef.current === 'ready' && !noteRef.current?.value) void cancel();
      }),
    ];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void cancel();
    };
    window.addEventListener('keydown', onKey);
    const t = setInterval(() => setExample((x) => (x + 1) % EXAMPLES.length), 3500);
    return () => {
      offs.forEach((o) => o());
      window.removeEventListener('keydown', onKey);
      clearInterval(t);
    };
  }, []);

  const cancel = async () => {
    await api.cancelSave();
    await api.closeWindow();
  };

  const all = useMemo(() => (preview ? [...preview.sure, ...preview.likely, ...preview.maybe, ...preview.kept] : []), [preview]);
  const chosen = all.filter((i) => picked.has(i.key));
  const maybeCount = preview ? [...preview.likely, ...preview.maybe].filter((i) => !picked.has(i.key)).length : 0;
  const likelyLeft = preview?.likely.filter((i) => !picked.has(i.key)) ?? [];

  const save = async () => {
    if (!preview || state !== 'ready') return;
    if (!name.trim()) {
      nameRef.current?.focus();
      return;
    }
    setState('saving');
    try {
      await api.commitSave({ jobId: preview.jobId, name: name.trim(), note, keys: chosen.map((i) => i.key), tidy });
      setState('saved');
      // With Tidy up, get out of the way quickly so the animation is visible.
      setTimeout(() => void api.closeWindow(), tidy ? 250 : 700);
    } catch (e) {
      setError(errorText(e));
      setState('ready');
    }
  };

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (state === 'saved') {
    return (
      <form ref={ref} className="save">
        <div className="saved fade-in">
          <span className="saved-check">
            <Icon name="check" />
          </span>
          <span>
            {tidy ? 'Packing up' : 'Saved to'} <b>{name}</b>
          </span>
        </div>
      </form>
    );
  }

  return (
    <form
      ref={ref}
      className="save drag"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {state === 'loading' ? (
        <div className="muted" style={{ padding: '6px 4px' }}>
          <span className="spinner" /> Looking at what's open…
          {slow && (
            <div className="small fade-in" style={{ marginTop: 8 }}>
              If macOS asks to let Where Was I see your apps, click <b>OK</b>. It only asks once per app.
            </div>
          )}
        </div>
      ) : (
        <>
          <input
            ref={nameRef}
            className="title-input no-drag"
            value={name}
            maxLength={80}
            onChange={(e) => {
              nameTouched.current = true;
              setName(e.target.value);
            }}
            aria-label="Job name"
            spellCheck={false}
          />

          {aiNaming && (
            <div className="faint tiny fade-in" style={{ padding: '0 4px', marginTop: -8 }}>
              Thinking of a name…
            </div>
          )}

          {preview && preview.jobOptions.length > 0 && (
            <div className="save-to no-drag">
              <span className="muted small">Save to</span>
              <select
                className="field small save-to-select"
                value={preview.jobId ?? 'new'}
                aria-label="Save to"
                onChange={(e) => {
                  const v = e.target.value;
                  setState('loading');
                  void load(v === 'new' ? { asNew: true } : { jobId: v });
                }}
              >
                <option value="new">New job</option>
                {preview.jobOptions.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name}
                    {j.current ? '  (open now)' : j.match === 'strong' ? '  (looks like a match)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <input
            ref={noteRef}
            className="field no-drag"
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
            placeholder={`Context for the robot 🤖  ${EXAMPLES[example]}`}
            aria-label="Context for the robot"
          />

          {expanded && preview && (
            <div className="groups no-drag fade-in">
              <div className="group">
                <div className="section-label">In this job</div>
                <Pills items={[...preview.sure, ...preview.kept]} picked={picked} frontKey={preview.frontKey} why={preview.why} onToggle={toggle} />
              </div>
              {preview.likely.length > 0 && (
                <div className="group likely-box">
                  <div className="section-label likely-label">
                    <span>Probably related</span>
                    {likelyLeft.length > 0 && (
                      <button type="button" className="link small" onClick={() => setPicked((prev) => new Set([...prev, ...likelyLeft.map((i) => i.key)]))}>
                        Add all
                      </button>
                    )}
                  </div>
                  <Pills items={preview.likely} picked={picked} frontKey={preview.frontKey} why={preview.why} onToggle={toggle} />
                </div>
              )}
              {preview.maybe.length > 0 && (
                <div className="group muted-group">
                  <div className="section-label">Probably not part of this job</div>
                  <Pills items={preview.maybe} picked={picked} frontKey={preview.frontKey} why={preview.why} onToggle={toggle} />
                </div>
              )}
              {preview.hiddenCount > 0 && (
                <div className="faint tiny" style={{ padding: '0 4px' }}>
                  {preview.hiddenCount} everyday {preview.hiddenCount === 1 ? 'thing' : 'things'} left out (like music and email)
                </div>
              )}
            </div>
          )}

          {preview && <PermissionNote errors={preview.errors} />}
          {error && <div className="banner no-drag">{error}</div>}

          <div className="row no-drag">
            <button type="button" className={`switch ${tidy ? 'on' : ''}`} onClick={() => setTidy(!tidy)} aria-pressed={tidy}>
              <span className="track" /> Tidy up after saving
            </button>
            <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
              <button type="button" className="summary" onClick={() => setExpanded(!expanded)} title="See what's included">
                {summary(chosen)}
                {maybeCount > 0 && ` · ${maybeCount} left out`}
                <span style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(-90deg)', display: 'inline-flex' }}>
                  <Icon name="back" />
                </span>
              </button>
              <button type="submit" className="btn primary" disabled={state !== 'ready' || chosen.length === 0}>
                {state === 'saving' ? (
                  <>
                    <span className="spinner on-accent" /> {tidy ? 'Packing…' : 'Saving…'}
                  </>
                ) : (
                  <>
                    {tidy ? 'Pack up' : 'Save'} <span style={{ opacity: 0.7 }}>↵</span>
                  </>
                )}
              </button>
            </span>
          </div>
        </>
      )}
    </form>
  );
}

function Pills(props: { items: Item[]; picked: Set<string>; frontKey: string | null; why: Record<string, string>; onToggle: (k: string) => void }) {
  const { items, picked, frontKey, why, onToggle } = props;
  return (
    <div className="pills">
      {items.map((i) => {
        const on = picked.has(i.key);
        const reason = i.notOpen ? 'Not open right now, kept in the job. Click to drop it.' : (why[i.key] ?? '');
        const tip = [i.label, i.detail, i.key === frontKey ? 'You were on this last' : '', reason].filter(Boolean).join('\n');
        return (
          <button key={i.key} type="button" className={`pill ${on ? 'in' : 'out'}`} onClick={() => onToggle(i.key)} title={tip} aria-pressed={on}>
            <span className="pill-mark">{on ? <Icon name="check" /> : <Icon name="plus" />}</span>
            <Icon name={i.kind} className="i kind" />
            <span className="pill-label">{i.label}</span>
            {i.notOpen && <span className="pill-tag">closed</span>}
            {i.key === frontKey && <span className="pill-dot" title="You were on this last" />}
          </button>
        );
      })}
    </div>
  );
}

const BROWSER_NAMES: Record<string, string> = { chrome: 'Chrome', arc: 'Arc', safari: 'Safari' };

function appName(collector: string): string {
  const [kind, name] = collector.split(':');
  return kind === 'browser' ? (BROWSER_NAMES[name] ?? name) : (name ?? collector).replace('Microsoft ', '');
}

function PermissionNote({ errors }: { errors: CollectorError[] }) {
  const names = [...new Set(errors.filter((e) => e.permissionDenied).map((e) => appName(e.collector)))];
  if (!names.length) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return (
    <div className="banner no-drag">
      <span>Where Was I isn't allowed to see inside {list} yet. Turn it on in System Settings, then save again.</span>
      <button type="button" className="btn small" onClick={() => void api.openAutomationSettings()}>
        Open Settings
      </button>
    </div>
  );
}
