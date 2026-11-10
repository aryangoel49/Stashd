// Tidy all's one question, asked where you press it: keep what you're on, or close everything.
// Two rows, like a menu: the first shows the real tab (or app) that stays, with its icon. Your last
// choice is marked (Return picks it), and the shortcut uses it without asking.

import { useEffect, useRef, useState } from 'react';
import type { TidyFront, TidyKeep } from '../shared/types';
import { api } from './api';
import { Icon } from './icons';

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
  const what = front?.kind === 'tab' ? 'this tab' : front?.kind === 'app' ? front.app : front?.kind === 'doc' ? 'this document' : 'this window';
  const row = (kind: TidyKeep, icon: React.ReactNode, title: string, sub: React.ReactNode, disabled = false) => (
    <button
      ref={kind === preferred ? first : undefined}
      type="button"
      className={`tc-row ${kind === preferred ? 'last' : ''} ${chosen === kind ? 'chosen' : ''}`}
      disabled={disabled}
      onClick={() => go(kind)}
    >
      <span className="tc-icon">{icon}</span>
      <span className="tc-text">
        <span className="tc-title">{title}</span>
        <span className="tc-sub">{sub}</span>
      </span>
      {kind === preferred && !disabled ? (
        <span className="tc-enter" title="Your last choice: press Return">
          ↵
        </span>
      ) : null}
    </button>
  );

  return (
    <div className={`tidy-choice ${inline ? 'inline' : ''}`} role="dialog" aria-label="Tidy all">
      {row(
        'front',
        front?.icon ? <img src={front.icon} alt="" /> : <Icon name="app" />,
        front === undefined ? 'Keep what you’re on' : front ? `Keep ${what} open` : 'Keep what you’re on',
        front === undefined ? 'Looking…' : front ? (front.kind === 'app' ? 'Close everything else' : `${front.label}`) : 'Nothing open in front',
        noFront,
      )}
      {row('all', <Icon name="spark" />, 'Close everything', 'Every tab and app')}
      {!inline && <div className="tc-foot">{shortcut} does your last choice</div>}
    </div>
  );
}
