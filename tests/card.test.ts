// The project card: what a folder is about across all its saves, and how Ctrl+S uses it.

import { describe, expect, it } from 'vitest';
import { buildCard } from '../src/main/jobs/card';
import { jobProfile, scoreItem, SURE } from '../src/main/jobs/relevance';
import type { Item } from '../src/shared/types';

const t = (url: string, label: string): Item => ({ key: `tab:${url}`, kind: 'tab', label, detail: '', app: 'Google Chrome', url, browser: 'chrome' });
const site = t('https://getstashd.vercel.app/', 'Stashd · Put your work to bed');
const repo = t('https://github.com/aryangoel49/Stashd', 'aryangoel49/Stashd: a Mac menu bar app');
const dash = t('https://vercel.com/me/stashd', 'stashd · Overview · Vercel');

describe('project card', () => {
  it('collects the names, websites and places that keep coming back, across saves', () => {
    const doc: Item = { key: 'doc:/Users/a/Code/stashd/README.md', kind: 'doc', label: 'README.md', detail: '', app: 'TextEdit', path: '/Users/a/Code/stashd/README.md' };
    const card = buildCard('Stashd project', [[site, repo], [dash, doc]]);
    expect(card.names).toContain('stashd');
    expect(card.sites).toEqual(expect.arrayContaining(['getstashd.vercel.app', 'vercel.com']));
    expect(card.places).toEqual(['/Users/a/Code/stashd']);
  });

  it('leaves out what you took out, and keeps names you added', () => {
    const card = buildCard('Stashd project', [[site, repo, dash]], { add: ['menu bar app'], hide: ['vercel.com'] });
    expect(card.sites).not.toContain('vercel.com');
    expect(card.added).toEqual(['menu bar app']);
  });

  it('a page from an older save still counts when the latest save is small', () => {
    const card = buildCard('Side project', [[site, repo, dash], [t('https://example.com/notes', 'Notes')]]);
    const p = jobProfile('Side project', '', [t('https://example.com/notes', 'Notes')], undefined, card);
    const features = t('https://getstashd.vercel.app/features.html', 'Features');
    expect(scoreItem(features, p, new Map()).score).toBeGreaterThanOrEqual(SURE);
  });
});
