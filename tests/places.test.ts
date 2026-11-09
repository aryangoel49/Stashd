import { describe, expect, it } from 'vitest';
import { appPathOf, appPlaceUrl, nameOfAddress, searchPlaces, typedAddress } from '../src/shared/places';

const APPS = [
  { name: 'Spotify', path: '/Applications/Spotify.app' },
  { name: 'Music', path: '/System/Applications/Music.app' },
  { name: 'Visual Studio Code', path: '/Applications/Visual Studio Code.app' },
];

describe('adding a place', () => {
  it('"spo" finds the Spotify app first, then the site', () => {
    const got = searchPlaces('spo', APPS, []);
    expect(got.slice(0, 2).map((p) => [p.name, p.kind])).toEqual([
      ['Spotify', 'app'],
      ['Spotify', 'site'],
    ]);
  });

  it('matches the start of any word and other names people use', () => {
    expect(searchPlaces('code', APPS, []).map((p) => p.name)).toContain('Visual Studio Code');
    expect(searchPlaces('twitter', APPS, []).map((p) => p.name)).toContain('X');
  });

  it('leaves out places you already have', () => {
    const got = searchPlaces('spotify', APPS, [appPlaceUrl('/Applications/Spotify.app'), 'https://open.spotify.com/']);
    expect(got.find((p) => p.name === 'Spotify')).toBeUndefined();
  });

  it('a typed address is offered first, named after the site', () => {
    const got = searchPlaces('kick.com', APPS, []);
    expect(got[0]).toEqual({ name: 'Kick', url: 'https://kick.com/', kind: 'address' });
    expect(searchPlaces('mubi.com/films', [], [])[0]).toMatchObject({ name: 'Mubi', url: 'https://mubi.com/films', kind: 'address' });
  });

  it('only real-looking addresses count', () => {
    expect(typedAddress('spotify')).toBeNull();
    expect(typedAddress('two words.com')).toBeNull();
    expect(typedAddress('javascript:alert(1)')).toBeNull();
    expect(typedAddress('bbc.co.uk')).toBe('https://bbc.co.uk/');
    expect(nameOfAddress('https://www.bbc.co.uk/')).toBe('Bbc');
  });

  it('nothing typed, nothing offered', () => {
    expect(searchPlaces('  ', APPS, [])).toEqual([]);
  });

  it('an app place round-trips to its path, spaces and all', () => {
    const url = appPlaceUrl('/Applications/Visual Studio Code.app');
    expect(appPathOf(url)).toBe('/Applications/Visual Studio Code.app');
    expect(appPathOf('https://open.spotify.com/')).toBeNull();
    expect(appPathOf('file:///etc/passwd')).toBeNull();
  });
});
