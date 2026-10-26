// A folder you opened yourself (not with Unpack) should still show as open.

import { describe, expect, it } from 'vitest';
import { looseKey } from '../src/main/urls';
import { mostlyOpen, type Item } from '../src/shared/types';

const tab = (url: string): Item => ({ key: `tab:${url}`, kind: 'tab', label: url, detail: '', app: 'Google Chrome', url, browser: 'chrome' });

describe('the same tab after reopening', () => {
  it('matches despite http/https, www., a trailing slash or a #section', () => {
    const saved = looseKey(tab('https://www.jstor.org/stable/123/'));
    for (const now of ['http://jstor.org/stable/123', 'https://www.jstor.org/stable/123#refs', 'https://m.jstor.org/stable/123/']) {
      expect(looseKey(tab(now))).toBe(saved);
    }
  });

  it('keeps different pages apart, including different videos', () => {
    expect(looseKey(tab('https://youtube.com/watch?v=a'))).not.toBe(looseKey(tab('https://youtube.com/watch?v=b')));
    expect(looseKey(tab('https://example.com/a'))).not.toBe(looseKey(tab('https://example.com/b')));
  });

  it('files match by their path', () => {
    const doc: Item = { key: 'doc:/Users/a/essay.docx', kind: 'doc', label: 'essay.docx', detail: '', app: 'Microsoft Word', path: '/Users/a/essay.docx' };
    expect(looseKey(doc)).toBe('doc:/Users/a/essay.docx');
  });
});

describe('when a folder counts as open', () => {
  it('most of it open counts; a little does not', () => {
    expect(mostlyOpen({ open: 4, total: 5 })).toBe(true);
    expect(mostlyOpen({ open: 3, total: 5 })).toBe(true);
    expect(mostlyOpen({ open: 1, total: 5 })).toBe(false);
    expect(mostlyOpen({ open: 0, total: 0 })).toBe(false);
    expect(mostlyOpen(undefined)).toBe(false);
  });
});
