import { describe, expect, it } from 'vitest';
import { group, jobProfile } from '../src/main/jobs/relevance';
import { looseKey, matchKeys, siteOf } from '../src/main/urls';
import type { Item } from '../src/shared/types';

const tab = (label: string, url: string, seenAs?: string[]): Item => ({ key: `tab:${url}`, kind: 'tab', label, detail: '', app: 'Google Chrome', url, browser: 'chrome', window: 1, ...(seenAs ? { seenAs } : {}) });

describe('tabs that redirect after Unpack', () => {
  const login = tab('Log In | Strava', 'https://www.strava.com/login');
  const dashboard = tab('Strava | Running', 'https://www.strava.com/dashboard', [looseKey(login)]);

  it('treats a site and its sign-in pages as one site', () => {
    expect(siteOf('https://app.strava.com/x')).toBe('strava.com');
    expect(siteOf('https://www.strava.com/login')).toBe('strava.com');
  });

  it('counts the sign-in page as the saved tab', () => {
    expect(matchKeys(dashboard)).toContain(looseKey(login));
    expect(matchKeys(tab('x', 'https://www.strava.com/dashboard'))).toEqual(['tab:strava.com/dashboard']);
  });

  it('on the next Ctrl+S, the sign-in tab is "was in this folder"', () => {
    const g = group({ candidates: [login], profile: jobProfile('Marathon training', '', [dashboard]), frontKey: null });
    expect(g.sure).toEqual([login]);
  });
});
