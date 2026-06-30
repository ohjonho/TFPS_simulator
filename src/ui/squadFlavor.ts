// Small helper for personality-reactive story hooks: pick a "notable" player to
// reference in a beat, biased by a personality preference order so different beats
// tend to spotlight different players. Pure.

import type { Unit } from '../game/types.ts';

export function pickNotable(roster: readonly Unit[], order: readonly string[]): Unit | null {
  for (const p of order) {
    const u = roster.find((x) => x.personality === p);
    if (u) return u;
  }
  return roster[0] ?? null;
}
