// Ask Stashd: ask about your own work in plain words. The panel has a small ask box under Work / Break (the
// answer replaces the folder list until you go back); the Stashd window has a page with the whole conversation.
// Answers point at real folders and things, one click to open. A change Stashd proposes runs only when you
// press its button, and can be undone.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AskAnswer, AskChat, AskProblem, AskRef, JobSummary } from '../shared/types';
import { api, errorText, timeAgo } from './api';
import { Icon } from './icons';
import { Button, FolderMark, motion, type Mood } from './ui';
import { markSeen, pickIdeas } from './askIdeas';
import { folderTone, ItemBadge, titleOf } from './visuals';

export interface AskTurn {
  id: number;
  question: string;
  reply?: AskAnswer | AskProblem;
}

let nextTurn = 1;

/** A conversation: ask, and the reply lands on the same turn. Kept in Stashd's memory as a chat. */
export function useAsk() {
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [chatId, setChatId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped by New chat (or opening another one): an answer still on its way then belongs to nothing on screen.
  const generation = useRef(0);
  const ask = async (question: string) => {
    const id = nextTurn++;
    const gen = generation.current;
    setTurns((t) => [...t, { id, question }]);
    setBusy(true);
    let reply: AskAnswer | AskProblem;
    let newChat: number | null = null;
    try {
      const r = await api.ask(question, chatId);
      reply = r.reply;
      newChat = r.chatId;
    } catch (e) {
      reply = { problem: 'error', message: errorText(e) };
    }
    if (gen !== generation.current) return;
    if (newChat != null) setChatId(newChat);
    setTurns((t) => t.map((x) => (x.id === id ? { ...x, reply } : x)));
    setBusy(false);
  };
  /** Opens a past chat, to read it or carry on. */
  const open = async (id: number) => {
    const gen = ++generation.current;
    const past = await api.askChat(id);
    if (gen !== generation.current) return;
    setBusy(false);
    setChatId(id);
    setTurns(past.map((p) => ({ id: nextTurn++, question: p.question, reply: p.reply })));
  };
  const clear = () => {
    generation.current++;
    setBusy(false);
    setTurns([]);
    setChatId(null);
  };
  return { turns, busy, ask, open, clear, chatId };
}

/**
 * The panel's way into Ask Stashd: the Stashd folder, and one question to try that changes every few
 * seconds. Return asks it, Tab takes it to edit, or just type your own. The folder looks at what you type,
 * wonders while Stashd thinks, and smiles when the answer comes.
 */
export function AskBar({ jobs, busy, onAsk }: { jobs: JobSummary[]; busy: boolean; onAsk: (q: string) => void }) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [smile, setSmile] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const names = jobs.filter((j) => !j.done).slice(0, 8).map((j) => j.name).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ideas = useMemo(() => pickIdeas(jobs, 10), [names]);
  const [n, setN] = useState(0);
  const idea = ideas.length ? ideas[n % ideas.length] : null;

  // A new question every few seconds while the box is empty (not while you read one with the box focused).
  useEffect(() => {
    if (value || focused || busy || ideas.length < 2) return;
    const t = setInterval(() => setN((x) => x + 1), 4500);
    return () => clearInterval(t);
  }, [value, focused, busy, ideas.length]);
  useEffect(() => {
    if (idea) markSeen(idea.template);
  }, [idea]);
  // A smile when an answer lands.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      setSmile(true);
      const t = setTimeout(() => setSmile(false), 1400);
      wasBusy.current = busy;
      return () => clearTimeout(t);
    }
    wasBusy.current = busy;
  }, [busy]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== '/' || t?.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      ref.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const mood: Mood = busy ? 'curious' : smile ? 'happy' : focused ? 'wide' : 'awake';
  const send = () => {
    const q = value.trim() || idea?.q || '';
    if (!q || busy) return;
    onAsk(q);
    setValue('');
    setN((x) => x + 1);
  };
  // A long question wraps onto a second (or third) line instead of scrolling out of sight.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 66)}px`;
  }, [value]);
  return (
    <form
      className={`ask-bar ${busy ? 'busy' : ''} ${focused ? 'on' : ''} ${value ? 'typed' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      onClick={() => ref.current?.focus()}
    >
      <span className="ask-bar-mark">
        <FolderMark size={22} alive mood={mood} lookAt={focused ? ref : null} />
      </span>
      <span className="ask-bar-field">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={busy}
          maxLength={500}
          aria-label={idea ? `Ask Stashd, for example: ${idea.q}` : 'Ask Stashd'}
          onChange={(e) => setValue(e.target.value.replace(/\n/g, ' '))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Tab' && !value && idea) {
              e.preventDefault();
              setValue(idea.q);
            } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        {!value && (
          <span key={busy ? 'busy' : idea?.q ?? ''} className="ask-bar-ghost" aria-hidden>
            {busy ? 'Thinking…' : idea ? `“${idea.q}”` : 'Ask about your work…'}
          </span>
        )}
      </span>
      {busy ? null : value ? (
        <button type="submit" className="ask-send" aria-label="Ask" title="Ask (Return)">
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
          </svg>
        </button>
      ) : !focused ? (
        <span className="ask-key" aria-hidden="true">
          /
        </span>
      ) : null}
    </form>
  );
}

/** The ask box. "/" anywhere in the window jumps into it. */
export function AskBox({ onAsk, disabled, big, placeholder = 'Ask about your work…' }: { onAsk: (q: string) => void; disabled?: boolean; big?: boolean; placeholder?: string }) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== '/' || t?.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      ref.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <form
      className={`ask-box ${big ? 'big' : ''} ${disabled ? 'off' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        if (!q || disabled) return;
        onAsk(q);
        setValue('');
      }}
    >
      <Icon name="spark" />
      <input ref={ref} value={value} disabled={disabled} maxLength={500} placeholder={placeholder} aria-label="Ask Stashd" onChange={(e) => setValue(e.target.value)} />
      <span className="ask-key" aria-hidden="true">
        /
      </span>
    </form>
  );
}

/** Your words, with the important bits marked. */
function Marked({ text, marks }: { text: string; marks: string[] }) {
  if (!marks.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let rest = text;
  let k = 0;
  while (rest) {
    const hits = marks.map((m) => ({ m, at: rest.indexOf(m) })).filter((h) => h.at >= 0).sort((x, y) => x.at - y.at);
    if (!hits.length) {
      parts.push(rest);
      break;
    }
    const { m, at } = hits[0];
    parts.push(rest.slice(0, at), <b key={k++}>{m}</b>);
    rest = rest.slice(at + m.length);
  }
  return <>{parts}</>;
}

const VERB: Record<string, string> = { add: 'Add', remove: 'Remove', move: 'Move', rename: 'Rename', pin: 'Pin', unpin: 'Unpin', unpack: 'Unpack', done: 'Mark finished' };

function Proposal({ reply }: { reply: AskAnswer }) {
  const a = reply.action!;
  // From a past chat: the change was offered then; it can't run from here any more.
  if (reply.past) return <p className="ask-note">Offered: {VERB[a.type] ?? 'a change'} {a.item ? `“${titleOf(a.item)}”` : ''} {a.type === 'move' ? `to ${a.to}` : `in ${a.folder}`}.</p>;
  const [state, setState] = useState<'ask' | 'busy' | 'done' | 'undoing' | 'undone' | 'cancelled'>('ask');
  const [undoId, setUndoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setState('busy');
    setError(null);
    try {
      setUndoId(await api.askDo(a.id));
      setState('done');
    } catch (e) {
      setError(errorText(e));
      setState('ask');
    }
  };
  if (state === 'cancelled') return <p className="ask-note">Nothing changed.</p>;
  if (state === 'done' || state === 'undoing' || state === 'undone') {
    return (
      <>
        <div className="ask-done">
          <Icon name="check" />
          <span className="grow">{state === 'undone' ? 'Undone.' : 'Done.'}</span>
          {state !== 'undone' && undoId && (
            <Button
              size="small"
              disabled={state === 'undoing'}
              onClick={() => {
                setState('undoing');
                setError(null);
                void api.askUndo(undoId).then(
                  () => setState('undone'),
                  (e) => {
                    setError(errorText(e));
                    setState('done');
                  },
                );
              }}
            >
              Undo
            </Button>
          )}
        </div>
        {error && <div className="banner">{error}</div>}
      </>
    );
  }
  return (
    <div className="ask-confirm">
      {a.item && (
        <div className="ask-ref plain">
          <ItemBadge item={a.item} size={26} />
          <span className="grow">
            <span className="t">{titleOf(a.item)}</span>
            <span className="m">{a.type === 'move' ? `${a.folder} → ${a.to}` : a.folder}</span>
          </span>
        </div>
      )}
      {error && <div className="banner">{error}</div>}
      <div className="ask-actions">
        <Button size="small" variant="ghost" disabled={state === 'busy'} onClick={() => setState('cancelled')}>
          Cancel
        </Button>
        <Button size="small" variant="primary" disabled={state === 'busy'} onClick={() => void run()}>
          {VERB[a.type] ?? 'Do it'}
        </Button>
      </div>
    </div>
  );
}

function Ref({ r, onShow }: { r: AskRef; onShow?: (jobId: string) => void }) {
  if (r.kind === 'folder') {
    return (
      <div className="ask-ref" role="button" tabIndex={0} onClick={() => onShow?.(r.jobId)} onKeyDown={(e) => e.key === 'Enter' && onShow?.(r.jobId)}>
        <FolderMark size={26} tone={folderTone(r.jobId)} />
        <span className="grow">
          <span className="t">{r.name}</span>
          <span className="m">{r.meta}</span>
        </span>
        <Button
          size="small"
          variant="primary"
          onClick={(e) => {
            e.stopPropagation();
            void api.openJob(r.jobId, null, 'all');
          }}
        >
          Unpack
        </Button>
      </div>
    );
  }
  return (
    <div className="ask-ref">
      <ItemBadge item={r.item} size={26} />
      <span className="grow">
        <span className="t">{titleOf(r.item)}</span>
        <span className="m">{r.folder ? `in ${r.folder}` : 'open now'}</span>
      </span>
      {r.jobId && (
        <Button size="small" onClick={() => void api.openItem(r.jobId!, r.item.key)}>
          Open
        </Button>
      )}
    </div>
  );
}

function Week({ week }: { week: NonNullable<AskAnswer['week']> }) {
  const max = Math.max(1, ...week.map((w) => w.minutes || w.saves * 10));
  const label = (w: { minutes: number; saves: number }) => (w.minutes >= 60 ? `${Math.round(w.minutes / 6) / 10} h` : w.minutes ? `${w.minutes} min` : `${w.saves} ${w.saves === 1 ? 'save' : 'saves'}`);
  return (
    <div className="ask-week" role="list">
      {week.slice(0, 5).map((w) => (
        <div className="ask-week-row" role="listitem" key={w.name}>
          <span className="n">{w.name}</span>
          <span className="bar">
            <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: (w.minutes || w.saves * 10) / max }} transition={{ type: 'spring', duration: 0.5, bounce: 0 }} />
          </span>
          <span className="h">{label(w)}</span>
        </div>
      ))}
    </div>
  );
}

/** One question and its reply. */
export function AskReply({ turn, onShow }: { turn: AskTurn; onShow?: (jobId: string) => void }) {
  const r = turn.reply;
  return (
    <motion.div className="ask-turn" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}>
      <div className="ask-q">{turn.question}</div>
      {!r ? (
        <div className="ask-thinking" aria-live="polite">
          <span className="spinner" /> Looking through your stash…
        </div>
      ) : 'problem' in r ? (
        <Problem p={r} />
      ) : (
        <>
          <p className="ask-a">
            <Marked text={r.answer} marks={r.highlights} />
          </p>
          {r.aside && <p className="ask-aside">{r.aside}</p>}
          {r.action ? <Proposal reply={r} /> : r.refs.map((ref, i) => <Ref key={i} r={ref} onShow={onShow} />)}
          {r.week && r.week.length > 0 && <Week week={r.week} />}
          {r.left != null && r.left <= 5 && <p className="ask-left">{r.left === 0 ? 'That was today’s last free question.' : `${r.left} ${r.left === 1 ? 'question' : 'questions'} left today`}</p>}
        </>
      )}
    </motion.div>
  );
}

function Problem({ p }: { p: AskProblem }) {
  const [on, setOn] = useState(false);
  if (p.problem === 'off') {
    return (
      <div className="ask-card">
        <b>Ask Stashd uses Stashd AI</b>
        <p>It sends your question and the names, titles and sites of the folders it needs to Stashd’s server, which asks Claude and keeps nothing. Never file contents.</p>
        <div className="ask-actions">
          <Button size="small" variant="primary" disabled={on} onClick={() => void api.updateSettings({ stashdAi: true }).then(() => setOn(true))}>
            {on ? 'On. Ask again' : 'Turn on Stashd AI'}
          </Button>
        </div>
      </div>
    );
  }
  if (p.problem === 'limit') {
    return (
      <div className="ask-card center">
        <b>That’s today’s free questions</b>
        <p>They’re back tomorrow. Your folders and briefs work as usual.</p>
      </div>
    );
  }
  return <div className="banner">{p.message}</div>;
}

/** Your past chats: newest first, one click to open, the trash to delete. */
function PastChats({ chats, onOpen, onDelete }: { chats: AskChat[]; onOpen: (id: number) => void; onDelete: (id: number) => void }) {
  if (!chats.length) return null;
  return (
    <div className="ask-past">
      <div className="ask-past-title">Past chats</div>
      {chats.map((c) => (
        <div key={c.id} className="ask-past-row" role="button" tabIndex={0} onClick={() => onOpen(c.id)} onKeyDown={(e) => e.key === 'Enter' && onOpen(c.id)}>
          <Icon name="spark" />
          <span className="grow">
            <span className="t">{c.title}</span>
            <span className="m">
              {timeAgo(c.updated)}
              {c.turns > 1 ? ` · ${c.turns} questions` : ''}
            </span>
          </span>
          <button
            type="button"
            className="ask-past-del"
            aria-label={`Delete “${c.title}”`}
            title="Delete this chat"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(c.id);
            }}
          >
            <Icon name="trash" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** The Stashd window's Ask Stashd page. */
export function AskPage({ jobs, onShow }: { jobs: JobSummary[]; onShow: (jobId: string) => void }) {
  const { turns, busy, ask, open, clear } = useAsk();
  const [chats, setChats] = useState<AskChat[]>([]);
  const end = useRef<HTMLDivElement>(null);
  // Four to start with, fresh each time the page opens.
  const [pageIdeas] = useState(() => pickIdeas(jobs, 4));
  const limited = turns.some((t) => t.reply && 'problem' in t.reply && t.reply.problem === 'limit');
  const loadChats = () => void api.askChats().then(setChats, () => undefined);
  useEffect(loadChats, [busy]);
  useEffect(() => {
    // (Newer Chromium returns a promise from scrollIntoView; an effect must return nothing.)
    void end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);
  return (
    <div className="page ask-page">
      <div className="ask-head">
        <div>
          <h1 className="display" style={{ margin: 0 }}>Ask Stashd</h1>
          <p className="muted">Questions about your own work. Answers come only from your stash.</p>
        </div>
        {turns.length > 0 && (
          <Button size="small" onClick={clear}>
            <Icon name="plus" /> New chat
          </Button>
        )}
      </div>
      {turns.length === 0 ? (
        <div className="ask-start">
          <div className="ask-ideas">
            {pageIdeas.map((i) => (
              <button key={i.q} type="button" className="ask-idea" onClick={() => void ask(i.q)}>
                <b>{i.q}</b>
              </button>
            ))}
          </div>
          <PastChats chats={chats} onOpen={(id) => void open(id)} onDelete={(id) => void api.deleteAskChat(id).then(setChats)} />
        </div>
      ) : (
        <div className="ask-thread">
          {turns.map((t) => (
            <AskReply key={t.id} turn={t} onShow={onShow} />
          ))}
          <div ref={end} />
        </div>
      )}
      <div className="ask-foot">
        <AskBox big disabled={busy || limited} placeholder={limited ? 'Back tomorrow' : turns.length ? 'Ask a follow-up…' : 'Ask about your work…'} onAsk={(q) => void ask(q)} />
        <p className="faint small">Sends your question and the names, titles and sites of the folders it needs to Stashd AI. Never file contents. Chats are kept on this Mac.</p>
      </div>
    </div>
  );
}

/** The panel's ask box and, once you've asked, the answer in place of the folder list. */
export function PanelAsk({ jobs, onShow, children }: { jobs: JobSummary[]; onShow: (jobId: string) => void; children: ReactNode }) {
  const { turns, busy, ask, clear } = useAsk();
  const last = turns[turns.length - 1];
  return (
    <>
      <AskBar jobs={jobs} busy={busy} onAsk={(q) => void ask(q)} />
      {last ? (
        <div className="ask-panel">
          <button type="button" className="ask-back" onClick={clear}>
            <Icon name="back" /> Folders
          </button>
          <AskReply key={last.id} turn={last} onShow={onShow} />
        </div>
      ) : (
        children
      )}
    </>
  );
}
