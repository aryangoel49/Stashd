// Ask Stashd: ask about your own work in plain words. The panel has a small ask box under Work / Break (the
// answer replaces the folder list until you go back); the Stashd window has a page with the whole conversation.
// Answers point at real folders and things, one click to open. A change Stashd proposes runs only when you
// press its button, and can be undone.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AskAnswer, AskProblem, AskRef, JobSummary } from '../shared/types';
import { api, errorText } from './api';
import { Icon } from './icons';
import { Button, FolderMark, motion } from './ui';
import { folderTone, ItemBadge, titleOf } from './visuals';

export interface AskTurn {
  id: number;
  question: string;
  reply?: AskAnswer | AskProblem;
}

let nextTurn = 1;

/** A conversation: ask, and the reply lands on the same turn. */
export function useAsk() {
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const ask = async (question: string) => {
    const id = nextTurn++;
    setTurns((t) => [...t, { id, question }]);
    setBusy(true);
    let reply: AskAnswer | AskProblem;
    try {
      reply = await api.ask(question);
    } catch (e) {
      reply = { problem: 'error', message: errorText(e) };
    }
    setTurns((t) => t.map((x) => (x.id === id ? { ...x, reply } : x)));
    setBusy(false);
  };
  return { turns, busy, ask, clear: () => setTurns([]) };
}

/** Questions to start with, using your own folder names. */
export function ideasFor(jobs: JobSummary[]): { q: string; hint: string }[] {
  const [a, b] = jobs.filter((j) => !j.done);
  return [
    { q: a ? `What was I doing on ${a.name}?` : 'What was I working on last?', hint: 'Get back into any folder' },
    { q: 'What did I work on this week?', hint: 'From Stashd’s memory' },
    { q: b ? `What’s in ${b.name}?` : 'Where did I save that article?', hint: 'Find a tab or file you saved' },
    { q: a ? `Add this tab to ${a.name}` : 'Pin my most recent folder', hint: 'Change a folder in words' },
  ];
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
  const [state, setState] = useState<'ask' | 'busy' | 'done' | 'undone' | 'cancelled'>('ask');
  const [undoId, setUndoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setState('busy');
    try {
      setUndoId(await api.askDo(a.id));
      setState('done');
    } catch (e) {
      setError(errorText(e));
      setState('ask');
    }
  };
  if (state === 'cancelled') return <p className="ask-note">Nothing changed.</p>;
  if (state === 'done' || state === 'undone') {
    return (
      <div className="ask-done">
        <Icon name="check" />
        <span className="grow">{state === 'undone' ? 'Undone.' : 'Done.'}</span>
        {state === 'done' && undoId && (
          <Button
            size="small"
            onClick={() => {
              void api.askUndo(undoId).then(() => setState('undone'));
            }}
          >
            Undo
          </Button>
        )}
      </div>
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
        <Button size="small" variant="ghost" onClick={() => setState('cancelled')}>
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

/** The Stashd window's Ask Stashd page. */
export function AskPage({ jobs, onShow }: { jobs: JobSummary[]; onShow: (jobId: string) => void }) {
  const { turns, busy, ask } = useAsk();
  const end = useRef<HTMLDivElement>(null);
  const limited = turns.some((t) => t.reply && 'problem' in t.reply && t.reply.problem === 'limit');
  useEffect(() => {
    // (Newer Chromium returns a promise from scrollIntoView; an effect must return nothing.)
    void end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);
  return (
    <div className="page ask-page">
      <div>
        <h1 className="display" style={{ margin: 0 }}>Ask Stashd</h1>
        <p className="muted">Questions about your own work. Answers come only from your stash.</p>
      </div>
      {turns.length === 0 ? (
        <div className="ask-ideas">
          {ideasFor(jobs).map((i) => (
            <button key={i.q} type="button" className="ask-idea" onClick={() => void ask(i.q)}>
              <b>{i.q}</b>
              <span>{i.hint}</span>
            </button>
          ))}
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
        <AskBox big disabled={busy || limited} placeholder={limited ? 'Back tomorrow' : 'Ask about your work…'} onAsk={(q) => void ask(q)} />
        <p className="faint small">Sends your question and the names, titles and sites of the folders it needs to Stashd AI. Never file contents.</p>
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
      <AskBox disabled={busy} onAsk={(q) => void ask(q)} />
      {last ? (
        <div className="ask-panel">
          <button type="button" className="ask-back" onClick={clear}>
            <Icon name="back" /> Folders
          </button>
          <AskReply key={last.id} turn={last} onShow={onShow} />
        </div>
      ) : (
        <>
          {jobs.length > 0 && (
            <div className="ask-sugs">
              {ideasFor(jobs)
                .slice(0, 2)
                .map((i) => (
                  <button key={i.q} type="button" className="ask-sug" onClick={() => void ask(i.q)}>
                    {i.q}
                  </button>
                ))}
            </div>
          )}
          {children}
        </>
      )}
    </>
  );
}
