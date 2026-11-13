// "Saved for you": folders Stashd made by itself from work you never saved (when you stepped away, closed
// the lid or shut down). A quiet list under your own folders, in the panel and on Home: open one to see
// what it is, Keep makes it one of your folders, ✕ removes it. Nothing shows when there are none.

import type { JobSummary } from '../shared/types';
import { api } from './api';
import { Icon } from './icons';
import { folderTone, toneStyle } from './visuals';

function what(j: JobSummary): string {
  const parts = [
    j.counts.tabs && `${j.counts.tabs} ${j.counts.tabs === 1 ? 'tab' : 'tabs'}`,
    j.counts.files && `${j.counts.files} ${j.counts.files === 1 ? 'file' : 'files'}`,
  ].filter(Boolean);
  const day = new Date(j.updatedAt).toLocaleDateString(undefined, { weekday: 'short' });
  return [...parts, day].join(' · ');
}

export function ForYouList({ jobs, onOpen, max, wide }: { jobs: JobSummary[]; onOpen: (id: string) => void; max?: number; wide?: boolean }) {
  const mine = jobs.filter((j) => j.forYou && !j.done).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!mine.length) return null;
  const shown = max ? mine.slice(0, max) : mine;
  return (
    <section className={`for-you ${wide ? 'wide' : ''}`} aria-label="Saved for you">
      <div className="for-you-head" title="Work you had open but never saved. Stashd kept it when you stepped away. Unused ones go after 14 days.">
        Saved for you <span className="faint">while you were away</span>
      </div>
      {shown.map((j) => (
        <div key={j.id} className="for-you-row" style={toneStyle(folderTone(j.id))}>
          <button type="button" className="for-you-main" onClick={() => onOpen(j.id)} title="See what's in it">
            <span className="for-you-dot" aria-hidden="true" />
            <span className="for-you-text">
              <span className="for-you-name">{j.name}</span>
              <span className="for-you-what">{what(j)}</span>
            </span>
          </button>
          <button type="button" className="for-you-keep" onClick={() => void api.keepJob(j.id)} title="Make it one of your folders">
            Keep
          </button>
          <button type="button" className="tool-btn delete" onClick={() => void api.deleteJob(j.id)} title="Remove it" aria-label={`Remove ${j.name}`}>
            <Icon name="trash" />
          </button>
        </div>
      ))}
      {mine.length > shown.length && (
        <button type="button" className="for-you-more" onClick={() => void api.openWindow('main')}>
          {mine.length - shown.length} more in Stashd
        </button>
      )}
    </section>
  );
}
