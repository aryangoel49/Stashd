import { describe, expect, it } from 'vitest';
import { cleanTabUrl, displayUrl } from '../src/main/urls';
import { DEFAULT_SETTINGS } from '../src/shared/validate';

const opts = { keepQueryStrings: false, excludedDomains: DEFAULT_SETTINGS.excludedDomains };

describe('cleanTabUrl', () => {
  it('strips query strings and fragments by default', () => {
    expect(cleanTabUrl('https://github.com/me/repo/pull/3?diff=split#r123', opts)).toBe('https://github.com/me/repo/pull/3');
  });

  it('keeps query strings when asked, but redacts secrets', () => {
    expect(cleanTabUrl('https://x.io/s?q=react&token=abc', { ...opts, keepQueryStrings: true })).toBe('https://x.io/s?q=react&token=[REDACTED]');
  });

  it.each([
    'https://accounts.google.com/signin',
    'https://mail.google.com/mail/u/0',
    'https://www.mybank.com/home',
    'https://example.com/login',
    'https://example.com/signin',
    'https://auth.example.com/',
  ])('drops excluded %s', (url) => {
    expect(cleanTabUrl(url, opts)).toBeNull();
  });

  it('matches subdomains of excluded domains but not lookalikes', () => {
    const o = { ...opts, excludedDomains: ['example.com'] };
    expect(cleanTabUrl('https://docs.example.com/a', o)).toBeNull();
    expect(cleanTabUrl('https://notexample.com/a', o)).toBe('https://notexample.com/a');
  });

  it('drops non-web pages', () => {
    for (const u of ['chrome://newtab/', 'about:blank', 'file:///Users/me/a.html', 'not a url']) expect(cleanTabUrl(u, opts)).toBeNull();
  });
});

describe('displayUrl', () => {
  it('shortens', () => {
    expect(displayUrl('https://www.github.com/me/repo')).toBe('github.com/me/repo');
    expect(displayUrl('https://react.dev/')).toBe('react.dev');
  });
});
