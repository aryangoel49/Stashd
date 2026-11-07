// The rule book: every number behind automatic saving, in one place, so behaviour changes by editing
// numbers, not code. Each version is stored in Stashd's memory, so we can tell which rules led to
// good or bad decisions. (Later, a newer rule book can come from Stashd's server; this stays the fallback.)

export interface Rules {
  version: number;
  /** You count as working on a folder after this many minutes on it… */
  driftWorkedMin: number;
  /** …and as having moved on after this many minutes on something else. */
  driftAfterMin: number;
  /** No mouse or keyboard for this long counts as away. */
  awayAfterMin: number;
  /** Shorter breaks than this get no card when you come back. */
  returnCardAfterMin: number;
  /** After a moving-on save, at most one card saying so in this many minutes (the saving goes on). */
  driftCardGapMin: number;
  /** How long a card after you come back stays. */
  returnSeconds: number;
  /** A kind of card adapts to you only after it was shown this many times. */
  learnFrom: number;
  /** Ignored at least this share of the time: the card stops showing (the save still happens). */
  quietWhenIgnored: number;
  /** A look at what's open older than this isn't trusted for a save. */
  freshLookMin: number;
}

export const RULES: Rules = {
  version: 2,
  driftWorkedMin: 10,
  driftAfterMin: 3,
  awayAfterMin: 20,
  returnCardAfterMin: 15,
  driftCardGapMin: 30,
  returnSeconds: 8,
  learnFrom: 5,
  quietWhenIgnored: 0.75,
  freshLookMin: 5,
};
