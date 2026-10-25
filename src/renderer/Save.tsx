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
      // Show the list straight away when there's something new to look at or something kept.
      setExpanded(p.likely.length > 0 || p.kept.length > 0);
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

          {preview?.isSuggestion && preview.jobName && (
            <div className="suggest no-drag fade-in">
              <span style={{ flex: 1 }}>
                Looks like <b>{preview.jobName}</b>. Adding to it.
              </span>
              <button type="button" className="btn small" onClick={() => void load({ asNew: true })}>
                Make a new job
              </button>
            </div>
          )}
          {preview && !preview.isSuggestion && preview.jobId && (
            <div className="muted small" style={{ padding: '0 4px', marginTop: -6 }}>
              Updating this job
              <button type="button" className="link small" style={{ marginLeft: 8 }} onClick={() => void load({ asNew: true })}>
                Save as a new job instead
              </button>
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
            <div className="no-drag fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Pills items={preview.sure} picked={picked} frontKey={preview.frontKey} onToggle={toggle} />
              {preview.likely.length > 0 && (
                <div className="likely-box">
                  <div className="section-label likely-label">
                    <span>New since you unpacked</span>
                    {likelyLeft.length > 0 && (
                      <button type="button" className="link small" onClick={() => setPicked((prev) => new Set([...prev, ...likelyLeft.map((i) => i.key)]))}>
                        Add all
                      </button>
                    )}
                  </div>
                  <Pills items={preview.likely} picked={picked} frontKey={preview.frontKey} onToggle={toggle} maybe likely />
                </div>
              )}
              {preview.maybe.length > 0 && (
                <>
                  <div className="section-label">Not sure about these</div>
                  <Pills items={preview.maybe} picked={picked} frontKey={preview.frontKey} onToggle={toggle} maybe />
                </>
              )}
              {preview.kept.length > 0 && (
                <>
                  <div className="section-label">Not open right now (kept in the job)</div>
                  <Pills items={preview.kept} picked={picked} frontKey={null} onToggle={toggle} kept />
                </>
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
                {maybeCount > 0 && ` · ${maybeCount} maybe`}
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

function Pills(props: {
  items: Item[];
  picked: Set<string>;
  frontKey: string | null;
  onToggle: (k: string) => void;
  maybe?: boolean;
  likely?: boolean;
  kept?: boolean;
}) {
  const { items, picked, frontKey, onToggle, maybe, likely, kept } = props;
  return (
    <div className="pills">
      {items.map((i) => {
        const on = picked.has(i.key);
        const cls = maybe
          ? `pill maybe ${likely ? 'likely' : ''} ${on ? 'on' : ''}`
          : `pill ${on ? '' : 'off'} ${kept ? 'kept' : ''} ${i.key === frontKey ? 'front' : ''}`;
        const why = i.key === frontKey ? '\nYou were on this last' : kept ? '\nNot open right now. Untick to drop it from the job.' : likely ? '\nOpened since you unpacked' : '';
        return (
          <button key={i.key} type="button" className={cls} onClick={() => onToggle(i.key)} title={`${i.label}\n${i.detail}${why}`}>
            {maybe && !on ? <Icon name="plus" /> : <Icon name={i.kind} />}
            <span>{i.label}</span>
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
