// Stashd's sounds: short recorded interface sounds (Kenney's "Interface Sounds", CC0; see
// sounds/LICENSE-kenney.txt), one per moment that deserves one. Everything else is silent.
// They follow the Sounds switch in Settings.

import { api } from './api';
import ding from './sounds/ding.wav';
import oops from './sounds/oops.wav';
import pack from './sounds/pack.wav';
import stash from './sounds/stash.wav';
import tidy from './sounds/tidy.wav';
import unpack from './sounds/unpack.wav';

const FILES = {
  /** ⌃S saved a folder (without packing up). */
  stash,
  /** Pack up: things land in the menu bar. */
  pack,
  /** Unpack: things come back out. */
  unpack,
  /** Tidy all: the whole desk is clear. */
  tidy,
  /** Stashd named the new folder. */
  ding,
  /** Something didn't come back after Unpack. */
  oops,
  /** The very first save, in the welcome. */
  first: tidy,
} as const;

export type SoundName = keyof typeof FILES;

const VOLUME = 0.55;
const cache = new Map<SoundName, HTMLAudioElement>();

/** Plays a sound now. `on`: the Sounds setting when the caller already knows it; otherwise it's looked up. */
export async function sound(name: SoundName, on?: boolean): Promise<void> {
  try {
    if (on === undefined) on = (await api.getSettings()).sounds;
    if (!on) return;
    let a = cache.get(name);
    if (!a) {
      a = new Audio(FILES[name]);
      a.volume = VOLUME;
      cache.set(name, a);
    }
    a.currentTime = 0;
    await a.play();
  } catch {
    // no sound, no problem
  }
}
