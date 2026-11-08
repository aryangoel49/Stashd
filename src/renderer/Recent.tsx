// What Tidy all closed in the last 10 minutes: in the menu bar panel and as a page in the Stashd window.
// After 10 minutes the list is gone for good.

import { useEffect, useState } from 'react';
import type { Item } from '../shared/types';
import { api, prettyShortcut, useSettings } from './api';
import { TidyChoice } from './TidyChoice';
import { Icon } from './icons';
import { Button, FolderMark } from './ui';
import { describe, ItemBadge, titleOf } from './visuals';

export interface RecentTidy {
  at: string;
  until: string;
  items: Item[];
}

/** The list, kept up to date; null once it has expired. Also the minutes left. */
export function useRecentlyTidied(): { recent: RecentTidy | null; minutesLeft: number } {
  const [recent, setRecent] = useState<RecentTidy | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const load = () => api.recentlyTidied().then(setRecent, () => undefined);
    load();
    const offs = [api.onJobsChanged(load), api.onWindowShown(load)];
    window.addEventListener('focus', load);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      offs.forEach((o) => o());
      window.removeEventListener('focus', load);
      clearInterval(tick);
    };
  }, []);
  const live = recent && recent.items.length && now < Date.parse(recent.until) ? recent : null;
  return { recent: live, minutesLeft: live ? Math.max(1, Math.ceil((Date.parse(live.until) - now) / 60_000)) : 0 };
}

/** The page in the Stashd window. */
export function RecentPage() {
  const { recent, minutesLeft } = useRecentlyTidied();
  const settings = useSettings();
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Tidy all</div>
          <h1 className="page-title">Recently closed</h1>
        </div>
      </header>
      {settings && <TidyChoice inline last={settings.tidyKeep} shortcut={prettyShortcut(settings.shortcutTidy)} />}
      {recent ? (
        <>
          <div className="recent-page-sub">
            <span className="muted">
              {recent.items.length} closed {timeAgoShort(recent.at)}. This list clears itself in {minutesLeft} min.
            </span>
            {recent.items.length > 1 && (
              <Button size="small" onClick={() => void api.reopenTidied()}>
                Reopen all
              </Button>
            )}
          </div>
          <div className="recent-page-list">
            {recent.items.map((it) => (
              <div key={it.key} className="recent-page-row">
                <ItemBadge item={it} size={30} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="recent-title" style={{ display: 'block' }}>{titleOf(it)}</span>
                  <span className="muted small" style={{ display: 'block' }}>{describe(it)}</span>
                </span>
                <Button size="small" onClick={() => void api.reopenTidied(it.key)}>
                  Reopen
                </Button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="empty" style={{ paddingTop: 60 }}>
          <FolderMark size={56} />
          <div className="display" style={{ marginTop: 14 }}>Nothing closed lately</div>
          <p>When you Tidy all, what it closes shows here for 10 minutes, in case you need something back.</p>
        </div>
      )}
    </div>
  );
}

function timeAgoShort(iso: string): string {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1 ? 'just now' : `${m} min ago`;
}
