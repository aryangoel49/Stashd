import { useState } from 'react';
import type { Brief, BriefView, OpenResult } from '../shared/types';
import { api, errorText, timeAgo } from './api';
import { Icon } from './icons';

/** Shows the sentence with its key words in the accent colour. */
export function Sentence({ brief }: { brief: Brief }) {
  const marks = brief.highlights.filter(Boolean);
  if (!marks.length) return <p className="sentence selectable">{brief.sentence}</p>;
  const re = new RegExp(`(${marks.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  const parts = brief.sentence.split(re);
  return (
    <p className="sentence selectable">
      {parts.map((p, i) => (marks.includes(p) ? <em key={i}>{p}</em> : <span key={i}>{p}</span>))}
    </p>
  );
}

const SOURCE: Record<Brief['source'], string> = { claude: 'Brief by Claude', apple: 'Brief by Apple Intelligence', basic: 'Basic brief' };

export function BriefCard({ view, onOpened }: { view: BriefView; onOpened?: (r: OpenResult) => void }) {
  const { job, entry, brief } = view;
  const [busy, setBusy] = useState<'needed' | 'all' | null>(null);
  const [result, setResult] = useState<OpenResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showItems, setShowItems] = useState(false);
  const [feedback, setFeedback] = useState<'none' | 'asking' | 'sent'>(entry.feedback ? 'sent' : 'none');
  const [comment, setComment] = useState('');
  const needed = new Set(brief.needed);

  const open = async (mode: 'needed' | 'all') => {
    setBusy(mode);
    setError(null);
    try {
      const r = await api.openJob(job.id, entry.id, mode);
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
      <div className="display">{job.name}</div>
      <div className="muted small">
        {new Date(entry.savedAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · {timeAgo(entry.savedAt)}
      </div>
      <Sentence brief={brief} />

      <div className="actions">
        <button className="btn primary" disabled={busy !== null} onClick={() => void open('all')} title="Reopen everything in this job">
          {busy === 'all' ? <span className="spinner on-accent" /> : null} Unpack everything
        </button>
        <button className="btn" disabled={busy !== null} onClick={() => void open('needed')} title="Reopen just what the brief says you need first">
          {busy === 'needed' ? <span className="spinner" /> : null} Only what I need
        </button>
      </div>

      {result && (
        <div className="muted small fade-in" style={{ marginTop: 10 }}>
          Opened {result.opened}
          {result.alreadyOpen ? `, ${result.alreadyOpen} already open` : ''}.
          {result.missing.length > 0 && ` Not found: ${result.missing.join(', ')}.`}
          {result.failed.length > 0 && ` Couldn't open: ${result.failed.join(', ')}.`}
        </div>
      )}
      {error && <div className="banner" style={{ marginTop: 10 }}>{error}</div>}

      <button className="btn ghost small" style={{ marginTop: 8, paddingLeft: 0 }} onClick={() => setShowItems(!showItems)}>
        {showItems ? 'Hide' : 'Show'} what's inside ({entry.items.length})
      </button>
      {showItems && (
        <div className="items-list fade-in">
          {entry.items.map((it) => (
            <div key={it.key} className={`item-row ${needed.has(it.key) ? 'need' : ''}`} title={it.detail}>
              <Icon name={it.kind} />
              <span className="lbl">{it.label}</span>
              <span className="det">{it.kind === 'app' ? '' : it.detail}</span>
            </div>
          ))}
        </div>
      )}

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
          <button className="btn small" type="submit">Send</button>
        </form>
      )}
    </div>
  );
}
