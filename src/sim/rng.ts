/**
 * World randomness keyed by what a draw is for, where and when (the pattern from HF's The Night Watch and The Pass).
 * Every world draw is a pure function of the seed and its key, so no input moves a draw it does not change the key
 * of: a replay with one ask removed sees the same weather.
 */

/** A 32-bit mix of integers (murmur3's finaliser over each). */
export function mixSeed(...xs: number[]): number {
  let h = 0x9e3779b9;
  for (const x of xs) {
    h = Math.imul(h ^ (x | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h | 0;
}

/** A uniform draw in [0, 1) from integers alone. */
export function hashUnit(...xs: number[]): number {
  return (mixSeed(...xs) >>> 0) / 4294967296;
}

/** A stable integer for a string (FNV-1a). */
export function strHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

/** What a world draw is for. Each kind is its own stream. */
export const DRAW = {
  weather: 1,
  storm: 2,
  household: 3,
  person: 4,
  name: 5,
  match: 6,
  conceive: 7,
  yield: 8,
  ill: 9,
  letter: 10,
  line: 11,
  reap: 12,
} as const;

/** A small seeded stream for generation (households at the start). Not used during play. */
export function stream(seed: number): () => number {
  let i = 0;
  return () => hashUnit(seed, DRAW.household, i++);
}
