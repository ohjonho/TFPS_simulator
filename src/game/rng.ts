// Seeded pseudo-random number generator. Deterministic: the same seed yields
// the same sequence, so rounds replay identically (CLAUDE.md determinism rule).
// Uses mulberry32 — a small, fast 32-bit generator with good distribution.

export type Rng = {
  // Next float in [0, 1).
  next(): number;
  // Integer in [0, maxExclusive).
  int(maxExclusive: number): number;
  // Integer in [min, max] inclusive.
  range(min: number, max: number): number;
  // True with probability p (0..1).
  chance(p: number): boolean;
  // Pick one element from a non-empty array.
  pick<T>(items: readonly T[]): T;
  // Current internal state — serialize for mid-round replay snapshots.
  state(): number;
};

export function createRng(seed: number): Rng {
  // Coerce to uint32 so the seed range is well-defined.
  let s = seed >>> 0;

  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    range: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    state: () => s >>> 0,
  };
}
