// Break vs work: what counts as a break, keeping it out of Ctrl+S, the shelf's shows, and the unused-things nudge.

import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ powerMonitor: { getSystemIdleTime: () => 0 }, shell: {} }));
import { isBreakItem, showName } from '../src/main/breaks';
import { classify } from '../src/main/jobs/match';
import { dormantApps } from '../src/main/noticer';
import { DEFAULT_SETTINGS } from '../src/shared/validate';
import type { Item, Job } from '../src/shared/types';

const t = (url: string, label: string): Item => ({ key: `tab:${url}`, kind: 'tab', label, detail: '', app: 'Google Chrome', url, browser: 'chrome' });
const job = (name: string): Job => ({ id: 'j', name, createdAt: '', updatedAt: '', done: false, prefs: { hide: {}, add: {} } });

describe('break things', () => {
  it('knows watching and sport sites, but not work sites', () => {
    expect(isBreakItem(t('https://www.youtube.com/watch?v=1', 'Shark Tank S10E4'))).toBe(true);
    expect(isBreakItem(t('https://www.netflix.com/watch/1', 'Suits'))).toBe(true);
    expect(isBreakItem(t('https://www.espn.com/nba/game', 'Warriors vs Lakers'))).toBe(true);
    expect(isBreakItem(t('https://github.com/me/repo', 'repo'))).toBe(false);
  });

  it('keeps a Shark Tank episode out of work, but offers a tutorial about the project', () => {
    const repo = t('https://github.com/aryangoel49/Stashd', 'Stashd · menu bar app in Electron');
    const shark = t('https://www.youtube.com/watch?v=1', 'Shark Tank S10E4 - YouTube');
    const tutorial = t('https://www.youtube.com/watch?v=2', 'Electron menu bar app tutorial - YouTube');
    const r = classify({ items: [repo, shark, tutorial], job: job('Stashd'), previous: [repo], name: 'Stashd', settings: DEFAULT_SETTINGS });
    expect(r.breaks).toEqual([shark]);
    expect([...r.sure, ...r.likely, ...r.maybe]).toContain(tutorial);
  });

  it('groups episodes of one show', () => {
    expect(showName('Shark Tank S10E4 - YouTube')).toBe('Shark Tank');
    expect(showName('The Office Season 3 Episode 2')).toBe('The Office');
    expect(showName('Rainbow Six Siege ranked stream')).toBeNull();
  });
});

describe('the unused-things nudge', () => {
  it('names apps you haven\'t switched to in 45 minutes, not everyday ones or Claude', () => {
    const now = 10_000_000;
    const last = new Map([['Preview', now - 50 * 60_000], ['Google Chrome', now - 60 * 60_000], ['Spotify', now - 90 * 60_000], ['Claude', now - 90 * 60_000], ['Notes', now - 5 * 60_000]]);
    expect(dormantApps(['Preview', 'Google Chrome', 'Spotify', 'Claude', 'Notes'], last, ['Spotify'], now)).toEqual(['Preview', 'Google Chrome']);
  });
});
