// Suggestions for tidying folders: merge two folders that are one piece of work, or move something
// saved in the wrong folder. Each shows its reason; nothing happens until it's accepted, and Undo
// is there for a few seconds after.

import { useCallback, useEffect, useState } from 'react';
import type { Suggestion } from '../shared/types';
import { api, errorText } from './api';
import { Icon } from './icons';
import { AnimatePresence, Button, FolderMark, motion } from './ui';
import { folderTone, ItemBadge, titleOf, toneStyle } from './visuals';

const UNDO_MS = 5000;

/** The current suggestions, refreshed whenever folders change. */
export function useSuggestions(): [Suggestion[], () => void] {
  const [list, setList] = useState<Suggestion[]>([]);
  const load = useCallback(() => {
    api.suggestions().then(setList, () => undefined);
  }, []);
  useEffect(() => {
    load();
    return api.onJobsChanged(load);
  }, [load]);
  return [list, load];
}

function headline(s: Suggestion): string {
  return s.kind === 'merge' ? `Merge “${s.fromName}” into “${s.intoName}”?` : `Move “${titleOf(s.item)}” to “${s.toName}”?`;
}

function doneText(s: Suggestion): string {
  return s.kind === 'merge' ? `Merged into ${s.intoName}` : `Moved to ${s.toName}`;
}

/** The strip on Home: at most three cards, each with Merge or Move, Not now and Never. */
export function SuggestionStrip() {
  const [list] = useSuggestions();
  const [undo, setUndo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [undo]);

  const accept = (s: Suggestion) => {
    setError(null);
    api.acceptSuggestion(s.id).then(
      () => setUndo(doneText(s)),
      (e) => setError(errorText(e)),
    );
  };

  if (!list.length && !undo && !error) return null;
  return (
    <section className="suggestions">
      <div className="section-head">
        <h3 className="suggest-title">
          <Icon name="spark" /> Suggestions
        </h3>
        <span className="faint tiny">Nothing changes until you choose</span>
      </div>
      <div className="suggest-list">
        <AnimatePresence initial={false}>
          {undo && (
            <motion.div key="undo" className="suggest-undo" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}>
              <Icon name="check" /> {undo}
              <Button
                size="small"
                onClick={() => {
                  setUndo(null);
                  void api.undoSuggestion();
                }}
              >
                Undo
              </Button>
            </motion.div>
          )}
          {list.map((s) => (
            <motion.div
              key={s.id}
              layout
              className="suggest-card"
              style={toneStyle(folderTone(s.kind === 'merge' ? s.into : s.to))}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 24, transition: { duration: 0.2 } }}
            >
              <span className="suggest-art" aria-hidden="true">
                {s.kind === 'merge' ? (
                  <>
                    <FolderMark size={28} tone={folderTone(s.from)} />
                    <span className="suggest-arrow">→</span>
                    <FolderMark size={28} tone={folderTone(s.into)} awake />
                  </>
                ) : (
                  <>
                    <ItemBadge item={s.item} size={26} />
                    <span className="suggest-arrow">→</span>
                    <FolderMark size={28} tone={folderTone(s.to)} awake />
                  </>
                )}
              </span>
              <span className="grow">
                <span className="suggest-head">{headline(s)}</span>
                <span className="suggest-why">{s.why.length ? s.why.join(' · ') : 'Looks like the same work'}</span>
              </span>
              <span className="suggest-actions">
                <Button variant="primary" size="small" onClick={() => accept(s)}>
                  {s.kind === 'merge' ? 'Merge' : 'Move'}
                </Button>
                <Button size="small" onClick={() => void api.dismissSuggestion(s.id, false)} title="Hide this for a week">
                  Not now
                </Button>
                <button className="suggest-never" onClick={() => void api.dismissSuggestion(s.id, true)} title="Never suggest this again">
                  Never
                </button>
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {error && <div className="banner">{error}</div>}
    </section>
  );
}

/** Inside a folder: a merge suggestion that involves it, shown under its title. */
export function FolderMergeHint({ jobId, list }: { jobId: string; list: Suggestion[] }) {
  const s = list.find((x) => x.kind === 'merge' && (x.from === jobId || x.into === jobId));
  if (!s || s.kind !== 'merge') return null;
  const other = s.from === jobId ? s.intoName : s.fromName;
  return (
    <motion.div className="merge-hint" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
      <Icon name="spark" />
      <span className="grow">
        Looks like the same work as <b>{other}</b>
        {s.why.length > 0 && <span className="faint"> · {s.why.slice(0, 2).join(' · ')}</span>}
      </span>
      <Button variant="primary" size="small" onClick={() => void api.acceptSuggestion(s.id)}>
        Merge
      </Button>
      <Button size="small" onClick={() => void api.dismissSuggestion(s.id, false)}>
        Not now
      </Button>
    </motion.div>
  );
}
