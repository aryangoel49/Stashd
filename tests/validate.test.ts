import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeStoredSettings, saveRequest, settingsPatch } from '../src/shared/validate';

describe('settingsPatch', () => {
  it('accepts valid changes', () => {
    const next = settingsPatch({ accent: 'teal', browsers: { arc: false }, tidyUp: true }, DEFAULT_SETTINGS);
    expect(next.accent).toBe('teal');
    expect(next.tidyUp).toBe(true);
    expect(next.browsers).toEqual({ chrome: true, arc: false, safari: true });
  });

  it.each([
    [{ accent: 'pink' }],
    [{ tidyUp: 'yes' }],
    [{ unknownThing: true }],
    [{ shortcutSave: 'rm -rf /' }],
    [{ aiModel: 'model with spaces' }],
    [{ lifestyleApps: 'Spotify' }],
    ['not an object'],
  ])('rejects %j', (patch) => {
    expect(() => settingsPatch(patch, DEFAULT_SETTINGS)).toThrow();
  });

  it('cleans site and app lists', () => {
    const s = settingsPatch({ lifestyleSites: [' Mail.Google.com ', '', 'bad entry!'], lifestyleApps: [' Spotify ', 'Spotify', ''] }, DEFAULT_SETTINGS);
    expect(s.lifestyleSites).toEqual(['mail.google.com']);
    expect(s.lifestyleApps).toEqual(['Spotify']);
  });

  it('starts with Tidy up off', () => {
    expect(DEFAULT_SETTINGS.tidyUp).toBe(false);
  });
});

describe('normalizeStoredSettings', () => {
  it('fills defaults and drops broken fields', () => {
    const s = normalizeStoredSettings({ accent: 'neon', tidyUp: true, junk: 1 });
    expect(s.accent).toBe('indigo');
    expect(s.tidyUp).toBe(true);
    expect(normalizeStoredSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
});

describe('saveRequest', () => {
  it('cleans and checks a save', () => {
    expect(saveRequest({ jobId: null, name: '  Climate   essay ', note: ' hi ', keys: ['doc:/a'], tidy: false })).toEqual({
      jobId: null, name: 'Climate essay', note: 'hi', keys: ['doc:/a'], tidy: false,
    });
    expect(() => saveRequest({ jobId: '../x', name: 'a', note: '', keys: [], tidy: false })).toThrow();
    expect(() => saveRequest({ jobId: null, name: '   ', note: '', keys: [], tidy: false })).toThrow();
  });
});

describe('Claude models in Settings', () => {
  it('every model in the dropdown is accepted as a setting', async () => {
    const { CLAUDE_MODELS } = await import('../src/shared/models');
    const { settingsPatch, DEFAULT_SETTINGS } = await import('../src/shared/validate');
    for (const m of CLAUDE_MODELS) expect(settingsPatch({ aiModel: m.id }, DEFAULT_SETTINGS).aiModel).toBe(m.id);
    expect(CLAUDE_MODELS.map((m) => m.id)).toContain(DEFAULT_SETTINGS.aiModel);
  });
});
