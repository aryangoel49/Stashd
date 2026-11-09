// After Unpack: what didn't come back and why, each with a way to sort it out. A file that moved can be
// found again by name (the folder then points at its new place); anything can be tried again or taken
// out of the folder. Nothing is left to fail quietly.

import { useEffect, useState } from 'react';
import type { OpenResult } from '../shared/types';
import { api } from './api';
import { Icon } from './icons';
import { sound } from './sounds';
import { Button, motion } from './ui';

type Problem = OpenResult['problems'][number];

const WHY: Record<Problem['why'], string> = {
  moved: 'Moved, renamed or deleted',
  unsaved: 'It was never saved',
  failed: 'Couldn’t open it',
};

export function NotBack({ jobId, problems }: { jobId: string; problems: Problem[] }) {
  const [state, setState] = useState<Record<string, 'busy' | 'done' | 'gone' | 'lost'>>({});
  const set = (key: string, s: 'busy' | 'done' | 'gone' | 'lost' | undefined) =>
    setState((prev) => {
      const next = { ...prev };
      if (s) next[key] = s;
      else delete next[key];
      return next;
    });
  useEffect(() => void sound('oops'), [problems]);
  const left = problems.filter((p) => state[p.key] !== 'done' && state[p.key] !== 'gone');
  if (!left.length) return null;

  const find = async (p: Problem) => {
    set(p.key, 'busy');
    const found = await api.findMoved(jobId, p.key).catch(() => false);
    set(p.key, found ? 'done' : 'lost');
  };
  const retry = async (p: Problem) => {
    set(p.key, 'busy');
    const r = await api.openItem(jobId, p.key).catch(() => null);
    set(p.key, r && (r.opened || r.alreadyOpen) ? 'done' : 'lost');
  };
  const remove = async (p: Problem) => {
    set(p.key, 'busy');
    await api.removeItem(jobId, p.key).then(() => set(p.key, 'gone'), () => set(p.key, undefined));
  };

  return (
    <motion.div className="notback" role="status" initial={{ opacity: 0, transform: 'translateY(4px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }}>
      <div className="notback-title">{left.length === 1 ? '1 thing didn’t come back' : `${left.length} things didn’t come back`}</div>
      {left.map((p) => {
        const s = state[p.key];
        return (
          <div key={p.key} className="notback-row">
            <Icon name={p.kind === 'tab' ? 'tab' : p.kind === 'app' ? 'app' : p.kind === 'folder' ? 'folder' : 'doc'} />
            <span className="notback-text">
              <b>{p.label}</b>
              <span>{s === 'lost' ? (p.why === 'moved' ? 'Couldn’t find it anywhere' : 'Still couldn’t open it') : WHY[p.why]}</span>
            </span>
            {s !== 'lost' && p.why === 'moved' && p.kind === 'doc' && (
              <Button size="small" disabled={s === 'busy'} onClick={() => void find(p)} title="Look for it by name on this Mac">
                {s === 'busy' ? 'Looking…' : 'Find it'}
              </Button>
            )}
            {s !== 'lost' && p.why === 'failed' && (
              <Button size="small" disabled={s === 'busy'} onClick={() => void retry(p)}>
                Try again
              </Button>
            )}
            <Button variant="ghost" size="small" disabled={s === 'busy'} onClick={() => void remove(p)} title="Take it out of this folder">
              Remove
            </Button>
          </div>
        );
      })}
    </motion.div>
  );
}
