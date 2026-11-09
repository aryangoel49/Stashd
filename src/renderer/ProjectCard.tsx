// "What Stashd knows about this project": the folder's project card, on the folder's page. Ctrl+S matches
// new things against it. You can add a name Stashd should look for, or take one out.

import { useEffect, useState } from 'react';
import type { ProjectCard as Card } from '../shared/types';
import { api, errorText } from './api';

export function ProjectCard({ jobId }: { jobId: string }) {
  const [card, setCard] = useState<Card | null>(null);
  const [adding, setAdding] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => api.projectCard(jobId).then((c) => live && setCard(c), () => undefined);
    load();
    const off = api.onJobsChanged(load);
    return () => {
      live = false;
      off();
    };
  }, [jobId]);
  if (!card) return null;
  // Resolves true when the change went through (so the name box clears only then).
  const change = (c: { add?: string; hide?: string; unadd?: string }) =>
    api.editCard(jobId, c).then(
      (next) => {
        setCard(next);
        setError(null);
        return true;
      },
      (e) => {
        setError(errorText(e));
        return false;
      },
    );
  const place = (p: string) => p.split('/').filter(Boolean).slice(-2).join('/');
  return (
    <section className="pcard">
      <div className="section-head">
        <h3>What Stashd knows about this project</h3>
        <span className="faint tiny">⌃S looks for these</span>
      </div>
      <div className="pcard-rows">
        <div className="pcard-row">
          <span className="pcard-label">Names</span>
          <span className="pcard-chips">
            {card.added.map((n) => (
              <span key={`a-${n}`} className="pchip mine">
                {n}
                <button type="button" aria-label={`Remove ${n}`} title="Remove" onClick={() => void change({ unadd: n })}>✕</button>
              </span>
            ))}
            {card.names.map((n) => (
              <span key={n} className="pchip">
                {n}
                <button type="button" aria-label={`Remove ${n}`} title="Not about this project" onClick={() => void change({ hide: n })}>✕</button>
              </span>
            ))}
            <form
              className="pchip-add"
              onSubmit={(e) => {
                e.preventDefault();
                if (adding.trim()) void change({ add: adding }).then((ok) => ok && setAdding(''));
              }}
            >
              <input className="field small" value={adding} maxLength={40} placeholder="Add a name" aria-label="Add a name to look for" onChange={(e) => setAdding(e.target.value)} />
            </form>
          </span>
        </div>
        {card.sites.length > 0 && (
          <div className="pcard-row">
            <span className="pcard-label">Websites</span>
            <span className="pcard-chips">
              {card.sites.map((s) => (
                <span key={s} className="pchip">
                  {s}
                  <button type="button" aria-label={`Remove ${s}`} title="Not about this project" onClick={() => void change({ hide: s })}>✕</button>
                </span>
              ))}
            </span>
          </div>
        )}
        {card.places.length > 0 && (
          <div className="pcard-row">
            <span className="pcard-label">On your Mac</span>
            <span className="pcard-chips">
              {card.places.map((p) => (
                <span key={p} className="pchip" title={p}>
                  {place(p)}
                  <button type="button" aria-label={`Remove ${place(p)}`} title="Not about this project" onClick={() => void change({ hide: p })}>✕</button>
                </span>
              ))}
            </span>
          </div>
        )}
      </div>
      {error && <div className="banner">{error}</div>}
    </section>
  );
}
