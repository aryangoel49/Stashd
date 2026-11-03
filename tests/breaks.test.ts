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

describe('which videos are work', () => {
  const grant: Item = { key: 'doc:/x/Grant budget.docx', kind: 'doc', label: 'Grant budget.docx', detail: '', app: 'Microsoft Word', path: '/x/Grant budget.docx' };
  const clip = t('https://www.youtube.com/watch?v=Qt', '(182) Stop Sending Clips... - YouTube');
  // A meaning model that (wrongly) says the clip sounds like the grant.
  const vec = (x: number) => [x, Math.sqrt(1 - x * x)];
  const lookup = (text: string) => (/clips/i.test(text) ? vec(1) : /grant/i.test(text) ? vec(0.9) : vec(0));

  it('"sounds similar" alone does not make a video work', () => {
    const r = classify({ items: [grant, clip], job: job('Grant application'), previous: [grant], name: 'Grant application', settings: DEFAULT_SETTINGS, meaning: lookup });
    expect(r.breaks).toEqual([clip]);
  });

  it('a video in the folder\'s tab group is work', () => {
    const inGroup = { ...clip, group: 'Grant application' };
    const r = classify({ items: [grant, inGroup], job: job('Grant application'), previous: [grant], name: 'Grant application', settings: DEFAULT_SETTINGS });
    expect(r.sure).toContain(inGroup);
    expect(r.breaks).toEqual([]);
  });

  it('a video that shares the project\'s words is work', () => {
    const talk = t('https://www.youtube.com/watch?v=g1', 'How to write a winning grant budget - YouTube');
    const r = classify({ items: [grant, talk], job: job('Grant application'), previous: [grant], name: 'Grant application', settings: DEFAULT_SETTINGS });
    expect([...r.sure, ...r.likely]).toContain(talk);
    expect(r.breaks).toEqual([]);
  });
});

describe('Continue watching', () => {
  const DAY = 24 * 60 * 60_000;
  it('a one-off clip fades after a week; a show or something you came back to stays a month', async () => {
    const { keepFor } = await import('../src/main/breaks');
    const clip = t('https://www.youtube.com/watch?v=1', 'Stop Sending Clips');
    const ep4 = t('https://www.youtube.com/watch?v=4', 'Shark Tank S10E4');
    const ep5 = t('https://www.youtube.com/watch?v=5', 'Shark Tank S10E5');
    expect(keepFor(clip, [clip])).toBe(7 * DAY);
    expect(keepFor({ ...clip, opens: 2 }, [clip])).toBe(30 * DAY);
    expect(keepFor(ep4, [ep4, ep5])).toBe(30 * DAY);
  });

  it('notices a video you closed, and only videos', async () => {
    const { Noticer } = await import('../src/main/noticer');
    const vid = t('https://www.youtube.com/watch?v=9', 'Some clip');
    const home = t('https://www.youtube.com/', 'YouTube');
    const doc = t('https://github.com/me/repo', 'repo');
    let items = [vid, home, doc];
    const closed = vi.fn();
    const n = new Noticer(async () => ({ open: new Set<string>(), state: {}, jobs: [], latest: [], items }), vi.fn(), () => false, closed);
    await n.tick();
    items = [doc];
    await n.tick();
    expect(closed).toHaveBeenCalledWith([vid]);
  });
});
