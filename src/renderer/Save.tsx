// The save box (⌃S). A new folder: name it and pick what goes in. An existing folder: one keypress.
// Pack up saves and closes the windows; Save keeps them open.

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { CollectorError, Item, SavePreview } from '../shared/types';
import { timeAgo } from '../shared/time';
import { api, errorText, useFitWindow, useSettings } from './api';
import { Icon } from './icons';
import { AnimatePresence, Button, countText, ease, FolderMark, motion, Motion, Pill, Reveal } from './ui';

const EXAMPLES = ['halfway through paragraph 3', "waiting on Sam's reply", 'need 2 more sources', 'hotel still to pick', 'stuck on question 4'];

type Mode = 'save' | 'pack' | 'last';

export function Save() {
  return (
    <Motion>
      <SaveBox />
    </Motion>
  );
}

function SaveBox() {
  useSettings();
  const ref = useFitWindow<HTMLFormElement>();
  const nameRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<SavePreview | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [packFirst, setPackFirst] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'saving' | 'saved'>('loading');
  const [packing, setPacking] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const modeRef = useRef<Mode>('last');
  // Once you type in the name, an AI suggestion never replaces it.
  const nameTouched = useRef(false);
  // Each preview gets a number, so an AI name that arrives late (after you switch "Save to") is ignored.
  const loadId = useRef(0);
  const [aiNaming, setAiNaming] = useState(false);

  const commit = async (p: SavePreview, opts: { name: string; note: string; keys: string[]; tidy: boolean }) => {
    setPacking(opts.tidy);
    setState('saving');
    try {
      await api.commitSave({ jobId: p.jobId, name: opts.name, note: opts.note, keys: opts.keys, tidy: opts.tidy });
      setState('saved');
      // With Pack up, get out of the way quickly so the windows can be seen flying into the menu bar.
      closeTimer.current = setTimeout(() => void api.closeWindow(), opts.tidy ? 450 : p.jobId ? 600 : 1200);
    } catch (e) {
      setError(errorText(e));
      setState('ready');
    }
  };

  const load = async (opts: { asNew?: boolean; jobId?: string } = {}) => {
    setError(null);
    const id = ++loadId.current;
    try {
      const p = await api.previewSave(opts);
      if (id !== loadId.current) return;
      const keys = [...p.sure, ...p.kept].map((i) => i.key);
      setPreview(p);
      setName(p.suggestedName);
      setPicked(new Set(keys));
      setAiNaming(false);
      const pack = modeRef.current === 'pack' ? true : modeRef.current === 'save' ? false : p.tidyUp;
      setPackFirst(pack);
      nameTouched.current = false;

      // Pack up on a folder you already have, with nothing to decide: just do it.
      if (modeRef.current === 'pack' && p.jobId && keys.length && !p.likely.length && !opts.asNew && !opts.jobId) {
        await commit(p, { name: p.suggestedName, note: '', keys, tidy: true });
        return;
      }

      // A new folder always shows what will go in it. An existing one only when there's something to decide.
      setExpanded(!p.jobId || p.likely.length > 0 || p.kept.length > 0);
      setState('ready');
      if (!p.jobId && p.sure.length) {
        // Ask Claude or Apple Intelligence (if set up) for a short folder name, in the background.
        setAiNaming(true);
        void api
          .aiName(p.sure.map((i) => i.key))
          .then((n) => {
            if (n && !nameTouched.current && id === loadId.current) setName(n);
          })
          .catch(() => undefined)
          .finally(() => id === loadId.current && setAiNaming(false));
      }
      setTimeout(() => (p.jobId ? noteRef.current : nameRef.current)?.focus(), 0);
    } catch (e) {
      setError(errorText(e));
      setState('ready');
    }
  };

  useEffect(() => {
    const begin = (mode: Mode = 'last') => {
      // A new save started before the last one's box closed: don't let that close this one.
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = null;
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
      // Enter saves from anywhere in the box (after clicking a pill, say), not just from a text field.
      // The footer buttons and the folder picker keep their own Enter.
      const t = e.target as HTMLElement;
      if (e.key === 'Enter' && !e.isComposing && !e.shiftKey && !t.closest('.save-foot, select')) {
        e.preventDefault();
        ref.current?.requestSubmit();
      }
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
  const likelyLeft = preview?.likely.filter((i) => !picked.has(i.key)) ?? [];
  const nothingOpen = !!preview && !preview.sure.length && !preview.kept.length && !preview.likely.length && !preview.maybe.length;

  // The folder looks at what it's talking about: the related things when there are some, and the
  // Save button once you've paused after typing a note.
  const likelyRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef<HTMLButtonElement>(null);
  const [glance, setGlance] = useState<RefObject<HTMLElement | null> | null>(null);
  const hasLikely = state === 'ready' && expanded && !!preview?.likely.length;
  useEffect(() => {
    if (!hasLikely) return;
    const look = setTimeout(() => setGlance(likelyRef), 500);
    const back = setTimeout(() => setGlance(null), 2100);
    return () => {
      clearTimeout(look);
      clearTimeout(back);
    };
  }, [hasLikely]);
  useEffect(() => {
    if (!note.trim()) return;
    let back: ReturnType<typeof setTimeout>;
    const look = setTimeout(() => {
      setGlance(readyRef);
      back = setTimeout(() => setGlance(null), 1300);
    }, 1200);
    return () => {
      clearTimeout(look);
      clearTimeout(back);
    };
  }, [note]);
  const isNew = !preview?.jobId;

  const save = (tidy: boolean) => {
    if (!preview || state !== 'ready') return;
    if (!name.trim()) {
      nameRef.current?.focus();
      return;
    }
    void commit(preview, { name: name.trim(), note, keys: chosen.map((i) => i.key), tidy });
  };

  // "Add all" ticks the pills one after another, so you can see each one join.
  const addOneByOne = (keys: string[]) => keys.forEach((key, i) => setTimeout(() => setPicked((prev) => new Set(prev).add(key)), i * 40));

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <form
      ref={ref}
      className="save drag"
      onSubmit={(e) => {
        e.preventDefault();
        save(packFirst);
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {state === 'loading' && (
          <motion.div key="loading" className="save-status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={ease}>
            <motion.span animate={{ y: [0, -3, 0] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}>
              <FolderMark size={30} />
            </motion.span>
            <span>
              <span className="save-status-title">Looking at what's open…</span>
              {slow && (
                <motion.span className="muted small" style={{ display: 'block' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  If macOS asks to let Stashd see your apps, click <b>OK</b>. It only asks once.
                </motion.span>
              )}
            </span>
          </motion.div>
        )}

        {(state === 'saving' || state === 'saved') && (
          <motion.div key="done" className="save-status" role="status" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
            <motion.span
              className="save-mark"
              initial={{ scale: 0.6, rotate: -8 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 18 }}
            >
              <SavedMark saved={state === 'saved'} packing={packing} />
            </motion.span>
            <span>
              <span className="save-status-title">
                {state === 'saving' ? (packing ? 'Packing up' : 'Saving') : packing ? 'Packed' : 'Saved'} <b>{name}</b>
              </span>
              <span className="muted small" style={{ display: 'block' }}>
                {packing ? 'Your windows are flying into the menu bar.' : `${countText(chosen)} saved. Everything stays open.`}
              </span>
            </span>
          </motion.div>
        )}

        {state === 'ready' && (
          <motion.div key="ready" className="save-body" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={ease}>
            <div className={`save-head${isNew ? '' : ' existing'}`}>
              <FolderMark size={34} alive mood={aiNaming ? 'curious' : isNew ? 'awake' : 'happy'} lookAt={glance} />
              <div className="grow">
                <div className="eyebrow">
                  {isNew ? 'New folder' : preview?.isSuggestion ? 'Looks like your folder' : 'Your folder'}
                  {!isNew && preview?.lastSavedAt && <span className="faint"> · saved {timeAgo(preview.lastSavedAt)}</span>}
                  {aiNaming && <span className="faint"> · thinking of a name…</span>}
                </div>
                <input
                  ref={nameRef}
                  className="title-input no-drag"
                  value={name}
                  maxLength={60}
                  onChange={(e) => {
                    nameTouched.current = true;
                    setName(e.target.value);
                  }}
                  aria-label="Folder name"
                  spellCheck={false}
                />
              </div>
              {preview && preview.jobOptions.length > 0 && (
                <select
                  className="field small save-to-select no-drag"
                  value={preview.jobId ?? 'new'}
                  aria-label="Save to"
                  title="Choose a different folder"
                  onChange={(e) => {
                    const v = e.target.value;
                    setState('loading');
                    void load(v === 'new' ? { asNew: true } : { jobId: v });
                  }}
                >
                  <option value="new">New folder</option>
                  {preview.jobOptions.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.name}
                      {j.current ? ' · open now' : j.match === 'strong' ? ' · match' : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {nothingOpen ? (
              <p className="save-intro">Nothing open to stash right now. Open the tabs or files you're working on, then try again.</p>
            ) : likelyLeft.length > 0 ? (
              <p className="save-intro">
                {likelyLeft.length === 1 ? '1 more thing looks related.' : `${likelyLeft.length} more things look related.`} Want {likelyLeft.length === 1 ? 'it' : 'them'} in?
              </p>
            ) : isNew ? (
              <p className="save-intro">I'll make a new folder for this. Tap anything to leave it out.</p>
            ) : (
              preview && (
                <p className="save-intro">
                  {preview.isSuggestion ? 'Same work as before, so this goes into it. Pick New folder if it isn’t. ' : 'Picking up where you left off. '}
                  {preview.newCount === 0 ? 'Nothing new since last time.' : preview.newCount === 1 ? '1 new thing since last time.' : `${preview.newCount} new things since last time.`}
                </p>
              )
            )}

            <input
              ref={noteRef}
              className="field no-drag"
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              placeholder={`Note for later, like “${EXAMPLES[example]}”`}
              aria-label="Note for later"
            />

            <Reveal show={expanded && !!preview && !nothingOpen}>
              {preview && (
                <div className="groups no-drag">
                  <Group label={isNew ? 'Going in' : 'In this folder'}>
                    <Pills items={[...preview.sure, ...preview.kept]} picked={picked} preview={preview} onToggle={toggle} />
                  </Group>
                  {preview.likely.length > 0 && (
                    <div className="likely-box" ref={likelyRef}>
                      <div className="section-label likely-label">
                        <span>Might belong here</span>
                        {likelyLeft.length > 0 && (
                          <button type="button" className="link small" onClick={() => addOneByOne(likelyLeft.map((i) => i.key))}>
                            Add all
                          </button>
                        )}
                      </div>
                      <Pills items={preview.likely} picked={picked} preview={preview} onToggle={toggle} />
                    </div>
                  )}
                  {preview.maybe.length > 0 && (
                    <Group label="Probably something else" muted>
                      <Pills items={preview.maybe} picked={picked} preview={preview} onToggle={toggle} />
                    </Group>
                  )}
                  {preview.hiddenCount > 0 && (
                    <div className="faint tiny" style={{ padding: '0 4px' }}>
                      Left out {preview.hiddenCount} everyday {preview.hiddenCount === 1 ? 'thing' : 'things'}, like music and email.
                    </div>
                  )}
                </div>
              )}
            </Reveal>

            {preview && <PermissionNote errors={preview.errors} />}
            {preview && <LimitNote errors={preview.errors} />}
            {error && <div className="banner no-drag">{error}</div>}

            <div className="save-foot no-drag">
              <button type="button" className="summary" onClick={() => setExpanded(!expanded)} title={expanded ? 'Hide the list' : "See what's going in"}>
                {countText(chosen)}
                <motion.span animate={{ rotate: expanded ? 90 : -90 }} style={{ display: 'inline-flex' }}>
                  <Icon name="back" />
                </motion.span>
              </button>
              <span className="grow" />
              <Button variant="ghost" type="button" onClick={() => void cancel()} title="Close without saving (Esc)">
                Cancel
              </Button>
              <Button ref={packFirst ? undefined : readyRef} variant={packFirst ? 'secondary' : 'primary'} type={packFirst ? 'button' : 'submit'} disabled={!chosen.length} onClick={packFirst ? () => save(false) : undefined} title="Save and keep everything open">
                Save {!packFirst && <span className="enter">↵</span>}
              </Button>
              <Button ref={packFirst ? readyRef : undefined} variant={packFirst ? 'primary' : 'secondary'} type={packFirst ? 'submit' : 'button'} disabled={!chosen.length} onClick={packFirst ? undefined : () => save(true)} title="Save and close these windows">
                <Icon name="stack" /> Pack up {packFirst && <span className="enter">↵</span>}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </form>
  );
}

function Group({ label, muted, children }: { label: string; muted?: boolean; children: React.ReactNode }) {
  return (
    <div className={`group ${muted ? 'muted-group' : ''}`}>
      <div className="section-label">{label}</div>
      {children}
    </div>
  );
}

/** The folder stays awake while saving. Once saved, and once you can see it, it squints happily (or falls asleep when packing) and a tick draws itself. */
function SavedMark({ saved, packing }: { saved: boolean; packing: boolean }) {
  const [stashed, setStashed] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setStashed(true), 80);
    return () => clearTimeout(t);
  }, [saved]);
  return (
    <>
      {/* Saved and kept open: a happy squint. Packed away: it falls asleep. */}
      <FolderMark size={30} mood={stashed ? (packing ? 'sleep' : 'happy') : 'awake'} />
      {stashed && (
        <motion.span className="save-check" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.22, delay: 0.15, ease: [0.23, 1, 0.32, 1] }}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <motion.path d="M5 12l5 5L19 7" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.26, delay: 0.27, ease: [0.23, 1, 0.32, 1] }} />
          </svg>
        </motion.span>
      )}
    </>
  );
}

function Pills({ items, picked, preview, onToggle }: { items: Item[]; picked: Set<string>; preview: SavePreview; onToggle: (k: string) => void }) {
  return (
    <motion.div layout className="pills">
      {items.map((i) => {
        const reason = i.notOpen ? 'Not open right now, kept in the folder. Tap to drop it.' : (preview.why[i.key] ?? '');
        const tip = [i.label, i.detail, i.key === preview.frontKey ? 'You were on this last' : '', reason].filter(Boolean).join('\n');
        return <Pill key={i.key} item={i} on={picked.has(i.key)} front={i.key === preview.frontKey} tip={tip} onToggle={() => onToggle(i.key)} />;
      })}
    </motion.div>
  );
}

const BROWSER_NAMES: Record<string, string> = { chrome: 'Chrome', arc: 'Arc', safari: 'Safari' };

function appName(collector: string): string {
  const [kind, name] = collector.split(':');
  return kind === 'browser' ? (BROWSER_NAMES[name] ?? name) : (name ?? collector).replace('Microsoft ', '');
}

/** Too many tabs open to save them all: say so instead of leaving some out silently. */
function LimitNote({ errors }: { errors: CollectorError[] }) {
  const limit = errors.find((e) => e.collector === 'browser:limit');
  if (!limit) return null;
  return (
    <div className="banner no-drag" role="status">
      <span>{limit.message}</span>
    </div>
  );
}

function PermissionNote({ errors }: { errors: CollectorError[] }) {
  const names = [...new Set(errors.filter((e) => e.permissionDenied).map((e) => appName(e.collector)))];
  if (!names.length) return null;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return (
    <div className="banner no-drag">
      <span>Stashd can't see inside {list} yet. Allow it in System Settings, then try again.</span>
      <Button size="small" onClick={() => void api.openAutomationSettings()}>
        Open Settings
      </Button>
    </div>
  );
}
