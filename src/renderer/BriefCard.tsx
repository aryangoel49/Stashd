import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Brief, BriefView, OpenKind, OpenResult } from '../shared/types';
import { openKindOf } from '../shared/types';
import { api, errorText, timeAgo } from './api';
import { Icon } from './icons';
import { Button, motion, Reveal } from './ui';
import { describe, ItemBadge, titleOf } from './visuals';

/** Text with the brief's key words in the accent colour. */
function Marked({ text, marks }: { text: string; marks: string[] }) {
  if (!marks.length) return <>{text}</>;
  const re = new RegExp(`(${marks.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return <>{text.split(re).map((p, i) => (marks.includes(p) ? <em key={i}>{p}</em> : <span key={i}>{p}</span>))}</>;
}

/** The brief: a headline, then Last on, So far and Next (older briefs are just the sentence). */
export function Sentence({ brief }: { brief: Brief }) {
  const marks = brief.highlights.filter(Boolean);
  const s = brief.sections;
  const rows: [string, string | undefined][] = s ? [['Last on', s.lastOn], ['So far', s.soFar], ['Next', s.next]] : [];
  return (
    <>
      <p className="sentence selectable">
        <Marked text={brief.sentence} marks={marks} />
      </p>
      {s && (
        <dl className="brief-points selectable">
          {rows
            .filter(([, text]) => text)
            .map(([label, text]) => (
              <div key={label} className={label === 'Next' ? 'next' : undefined}>
                <dt>{label}</dt>
                <dd>
                  <Marked text={text!} marks={marks} />
                </dd>
              </div>
            ))}
        </dl>
      )}
    </>
  );
}

const KINDS: { kind: OpenKind; one: string; many: string; icon: 'doc' | 'tab' | 'app' | 'spark' }[] = [
  { kind: 'doc', one: 'file', many: 'files', icon: 'doc' },
  { kind: 'tab', one: 'tab', many: 'tabs', icon: 'tab' },
  { kind: 'app', one: 'app', many: 'apps', icon: 'app' },
  { kind: 'chat', one: 'chat', many: 'chats', icon: 'spark' },
];

const SOURCE: Record<Brief['source'], string> = { claude: 'Brief by Claude', apple: 'Brief by Apple Intelligence', basic: 'Basic brief' };

export function BriefCard({ view, onOpened, current = false, hideTitle = false }: { view: BriefView; onOpened?: (r: OpenResult) => void; current?: boolean; hideTitle?: boolean }) {
  const { job, entry, brief } = view;
  const [busy, setBusy] = useState<'some' | 'all' | null>(null);
  // What Unpack opens: everything starts ticked. Untick a whole type with its pill, or single items
  // under "Show what's inside".
  const counts = KINDS.map((k) => ({ ...k, keys: entry.items.filter((i) => openKindOf(i) === k.kind).map((i) => i.key) })).filter((k) => k.keys.length > 0);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(entry.items.map((i) => i.key)));
  const kindOn = (keys: string[]) => keys.some((k) => picked.has(k));
  const toggleKind = (keys: string[]) =>
    setPicked((prev) => {
      const next = new Set(prev);
      const on = keys.every((k) => prev.has(k));
      for (const k of keys) if (on) next.delete(k);
      else next.add(k);
      return next;
    });
  const toggleItem = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const pickedCount = entry.items.filter((i) => picked.has(i.key)).length;
  const [result, setResult] = useState<OpenResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showItems, setShowItems] = useState(false);
  const [feedback, setFeedback] = useState<'none' | 'asking' | 'sent'>(entry.feedback ? 'sent' : 'none');
  const [comment, setComment] = useState('');
  const needed = new Set(brief.needed);

  const open = async (which: 'some' | 'all') => {
    setBusy(which);
    setError(null);
    try {
      const r = await api.openJob(job.id, entry.id, 'all', which === 'some' ? entry.items.filter((i) => picked.has(i.key)).map((i) => i.key) : undefined);
      setResult(r);
      onOpened?.(r);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const sendFeedback = async (helpful: boolean, text?: string) => {
    await api.sendFeedback(job.id, entry.id, helpful, text);
    setFeedback('sent');
  };

  return (
    <div className="brief">
      {!hideTitle && <NameEdit jobId={job.id} name={job.name} renamed={!!job.renamed} className="display" />}
      <div className="muted small">
        {new Date(entry.savedAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · {timeAgo(entry.savedAt)}
      </div>
      <Sentence brief={brief} />

      {current ? (
        <div className="actions">
          <Button variant="primary" size="small" onClick={() => void api.openWindow('pack', view.job.id)} title="Save this folder and close its windows">
            <Icon name="stack" /> Pack up
          </Button>
          <Button size="small" onClick={() => void api.openWindow('save', view.job.id)} title="Save without closing anything">
            Save
          </Button>
        </div>
      ) : (
      <>
        {counts.length > 1 && (
          <div className="open-kinds" role="group" aria-label="What to open">
            {counts.map((k) => {
              const on = kindOn(k.keys);
              const n = k.keys.filter((key) => picked.has(key)).length;
              return (
                <button key={k.kind} type="button" className={`pill ${on ? 'in' : 'out'}`} aria-pressed={on} onClick={() => toggleKind(k.keys)}>
                  <span className="pill-mark">{on ? <Icon name="check" /> : <Icon name="plus" />}</span>
                  <Icon name={k.icon} /> {on && n < k.keys.length ? `${n} of ${k.keys.length}` : k.keys.length} {k.keys.length === 1 ? k.one : k.many}
                </button>
              );
            })}
          </div>
        )}
        <div className="actions">
          <Button variant="primary" size="small" disabled={busy !== null || pickedCount === 0} onClick={() => void open('some')} title="Open the ticked types">
            {busy === 'some' ? <span className="spinner on-accent" /> : null} {pickedCount === entry.items.length ? 'Unpack' : `Unpack ${pickedCount}`}
          </Button>
          <Button size="small" disabled={busy !== null} onClick={() => void open('all')} title="Reopen everything in this folder">
            {busy === 'all' ? <span className="spinner" /> : null} Open everything
          </Button>
        </div>
      </>
      )}

      {result && (
        <motion.div className="muted small" style={{ marginTop: 10 }} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
          Opened {result.opened}
          {result.alreadyOpen ? `, ${result.alreadyOpen} already open` : ''}.
          {result.missing.length > 0 && ` Not found: ${result.missing.join(', ')}.`}
          {result.failed.length > 0 && ` Couldn't open: ${result.failed.join(', ')}.`}
        </motion.div>
      )}
      {error && <div className="banner" style={{ marginTop: 10 }}>{error}</div>}

      {/* What's inside: a clear box you open to see, and tick, each thing in the folder. */}
      <div className={`inside ${showItems ? 'open' : ''}`}>
        <button type="button" className="inside-toggle" aria-expanded={showItems} onClick={() => setShowItems(!showItems)}>
          <span>What's inside</span>
          <span className="inside-count">
            {current || pickedCount === entry.items.length ? `${entry.items.length} ${entry.items.length === 1 ? 'thing' : 'things'}` : `${pickedCount} of ${entry.items.length} to open`}
          </span>
          <Icon name="chevron" className="i inside-chev" />
        </button>
        <Reveal show={showItems}>
        <div className="items-list">
          {entry.items.map((it) =>
            current ? (
              <div key={it.key} className={`item-row ${needed.has(it.key) ? 'need' : ''}`} title={it.detail}>
                <ItemBadge item={it} size={18} />
                <span className="lbl">{titleOf(it)}</span>
                <span className="det">{it.kind === 'app' ? (it.chat ? `${it.app} chat` : '') : describe(it)}</span>
              </div>
            ) : (
              <button
                key={it.key}
                type="button"
                className={`item-row pickable ${needed.has(it.key) ? 'need' : ''} ${picked.has(it.key) ? '' : 'off'}`}
                title={picked.has(it.key) ? `${it.detail} · click to leave it closed` : `${it.detail} · click to open it too`}
                aria-pressed={picked.has(it.key)}
                onClick={() => toggleItem(it.key)}
              >
                <span className="item-check">{picked.has(it.key) && <Icon name="check" />}</span>
                <ItemBadge item={it} size={18} />
                <span className="lbl">{titleOf(it)}</span>
                <span className="det">{it.kind === 'app' ? (it.chat ? `${it.app} chat` : '') : describe(it)}</span>
              </button>
            ),
          )}
        </div>
      </Reveal>
      </div>

      <div className="foot">
        <span title={brief.fallbackReason}>{SOURCE[brief.source]}</span>
        {feedback === 'none' && (
          <span>
            Helpful?{' '}
            <button className="link tiny" onClick={() => void sendFeedback(true)}>Yes</button> ·{' '}
            <button className="link tiny" onClick={() => setFeedback('asking')}>No</button>
          </span>
        )}
        {feedback === 'sent' && <span>Thanks</span>}
      </div>
      {feedback === 'asking' && (
        <form
          className="fade-in"
          style={{ display: 'flex', gap: 6, marginTop: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            void sendFeedback(false, comment);
          }}
        >
          <input className="field small" autoFocus placeholder="What was wrong?" value={comment} maxLength={400} onChange={(e) => setComment(e.target.value)} />
          <Button size="small" type="submit">Send</Button>
        </form>
      )}
    </div>
  );
}

/**
 * A folder's name: double-click to rename it (Enter saves, Esc cancels). A single click still does
 * `onClick`, a moment later, so a double-click doesn't also open the folder.
 */
export function NameEdit({ jobId, name, renamed, className, onClick, children }: { jobId: string; name: string; renamed: boolean; className?: string; onClick?: () => void; children?: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const click = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => setValue(name), [name]);
  useEffect(() => () => clearTimeout(click.current), []);
  const finish = (save: boolean) => {
    setEditing(false);
    const next = value.trim();
    if (save && next && next !== name) void api.renameJob(jobId, next);
    else setValue(name);
  };
  if (editing) {
    return (
      <input
        className={`${className ?? ''} name-edit`}
        autoFocus
        value={value}
        maxLength={60}
        aria-label="Folder name"
        onClick={(e) => e.stopPropagation()}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish(true);
          if (e.key === 'Escape') finish(false);
        }}
      />
    );
  }
  return (
    <span className={`${className ?? ''} name-wrap ${renamed ? '' : 'unnamed'}`}>
      <span
        className="name-text"
        title="Double-click to rename"
        onClick={(e) => {
          if (!onClick) return;
          e.stopPropagation();
          clearTimeout(click.current);
          if (e.detail === 1) click.current = setTimeout(onClick, 220);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          clearTimeout(click.current);
          setEditing(true);
        }}
      >
        {children ?? name}
      </span>
    </span>
  );
}
