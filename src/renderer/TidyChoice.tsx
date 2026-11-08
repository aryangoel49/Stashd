// Tidy all's one question, asked where you press it: keep the tab you're on, or close everything.
// Two cards side by side, each with a little picture of what's left, and the real name of the tab
// that stays. Your last choice is marked (Enter picks it), and the shortcut uses it without asking.

import { useEffect, useRef, useState } from 'react';
import type { TidyFront, TidyKeep } from '../shared/types';
import { api } from './api';

/** The tab or window in front (what "Keep this tab" leaves open), looked up when the choice opens. */
function useFront(open: boolean): TidyFront | null | undefined {
  const [front, setFront] = useState<TidyFront | null | undefined>(undefined);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setFront(undefined);
    void api.tidyFront().then(
      (f) => live && setFront(f),
      () => live && setFront(null),
    );
    return () => {
      live = false;
    };
  }, [open]);
  return front;
}

/** Three little windows: one stays lit ("keep"), or all of them lift away ("all"). */
function Picture({ kind, icon }: { kind: TidyKeep; icon?: string | null }) {
  return (
    <span className={`tc-pic ${kind}`} aria-hidden>
      <span className="tc-win w1" />
      <span className="tc-win w2" />
      <span className="tc-win w3">{kind === 'front' && icon ? <img src={icon} alt="" /> : null}</span>
    </span>
  );
}

export function TidyChoice(props: { last: TidyKeep; shortcut: string; onClose?: () => void; inline?: boolean }) {
  const { last, shortcut, onClose, inline } = props;
  const front = useFront(true);
  const [chosen, setChosen] = useState<TidyKeep | null>(null);
  const first = useRef<HTMLButtonElement>(null);
  const noFront = front === null;

  const go = (keep: TidyKeep) => {
    if (chosen || (keep === 'front' && noFront)) return;
    setChosen(keep);
    // A beat to see the card take the press, then the panel steps aside and things fly.
    setTimeout(() => {
      void api.tidyAll(keep);
      onClose?.();
      setChosen(null);
    }, 140);
  };

  useEffect(() => {
    if (!inline) first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inline, onClose]);

  const preferred: TidyKeep = noFront ? 'all' : last;
  const card = (kind: TidyKeep, title: string, sub: React.ReactNode, disabled = false) => (
    <button
      ref={kind === preferred ? first : undefined}
      type="button"
      className={`tc-card ${kind === preferred ? 'last' : ''} ${chosen === kind ? 'chosen' : ''}`}
      disabled={disabled}
      onClick={() => go(kind)}
    >
      <Picture kind={kind} icon={front?.icon} />
      <span className="tc-title">{title}</span>
      <span className="tc-sub">{sub}</span>
      {kind === preferred && !disabled ? <span className="tc-last">Last used · ↵</span> : null}
    </button>
  );

  return (
    <div className={`tidy-choice ${inline ? 'inline' : ''}`} role="dialog" aria-label="Tidy all">
      {!inline && (
        <div className="tc-head">
          <span className="tc-heading">Tidy all</span>
          <span className="tc-hint">Saves your folders first, then closes</span>
        </div>
      )}
      <div className="tc-cards">
        {card(
          'front',
          'Keep this tab',
          front === undefined ? (
            <span className="tc-loading">Looking…</span>
          ) : front ? (
            <span className="tc-front" title={front.label}>
              {front.label}
            </span>
          ) : (
            'Nothing in front'
          ),
          noFront,
        )}
        {card('all', 'Close everything', 'Every tab and app')}
      </div>
      {!inline && <div className="tc-foot">{shortcut} does your last choice</div>}
    </div>
  );
}
