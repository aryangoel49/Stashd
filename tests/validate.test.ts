import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeStoredSettings, restoreRequest, settingsPatch } from '../src/shared/validate';

describe('settingsPatch', () => {
  it('accepts valid changes', () => {
    const next = settingsPatch({ lookbackHours: 24, browsers: { arc: false } }, DEFAULT_SETTINGS);
    expect(next.lookbackHours).toBe(24);
    expect(next.browsers).toEqual({ chrome: true, arc: false, safari: true });
  });

  it.each([
    [{ lookbackHours: 0 }],
    [{ lookbackHours: '12' }],
    [{ unknownThing: true }],
    [{ projects: [{ id: '../x', name: 'x', path: '/x' }] }],
    [{ projects: [{ id: 'ok-1', name: 'x', path: 'relative/path' }] }],
    [{ shortcutSave: 'rm -rf /' }],
    [{ aiModel: 'model with spaces' }],
    ['not an object'],
  ])('rejects %j', (patch) => {
    expect(() => settingsPatch(patch, DEFAULT_SETTINGS)).toThrow();
  });

  it('cleans the excluded domain list', () => {
    expect(settingsPatch({ excludedDomains: [' Bank ', '', 'x.com', 'bad entry!'] }, DEFAULT_SETTINGS).excludedDomains).toEqual(['bank', 'x.com']);
  });
});

describe('normalizeStoredSettings', () => {
  it('fills defaults and drops broken fields', () => {
    const s = normalizeStoredSettings({ lookbackHours: -5, shellHistory: true, junk: 1 });
    expect(s.lookbackHours).toBe(12);
    expect(s.shellHistory).toBe(true);
    expect(normalizeStoredSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('restoreRequest', () => {
  it('limits to 20 items', () => {
    const keys = Array.from({ length: 21 }, (_, i) => `file:${i}`);
    expect(() => restoreRequest({ projectId: 'a-1', snapshotId: '2026-10-17T12-00-00-000Z', keys })).toThrow(/20/);
    expect(restoreRequest({ projectId: 'a-1', snapshotId: '2026-10-17T12-00-00-000Z', keys: keys.slice(0, 20) }).keys).toHaveLength(20);
  });
});
