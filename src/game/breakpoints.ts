// Attribute breakpoints (3e) — pure detection of when a team-average aggregate
// crosses a tier (55/65/75) between two roster snapshots (before/after a training
// session or match XP). The UI turns each crossing into a one-time milestone beat
// that names the capability it unlocks. No sim effect — purely a readout of growth
// that already happened.

import { aggregateVisible } from './attributes.ts';
import { BREAKPOINTS } from './config.ts';
import type { Unit, VisibleAttributes } from './types.ts';

const AGGREGATES: readonly (keyof VisibleAttributes)[] = ['mechanics', 'gameSense', 'discipline', 'improvisation', 'leadership'];

export type Crossing = { aggregate: keyof VisibleAttributes; tier: number };

// Team-average of a visible aggregate, rounded to match what the player sees.
export function teamAggregate(roster: readonly Unit[], key: keyof VisibleAttributes): number {
  if (!roster.length) return 0;
  return Math.round(roster.reduce((s, u) => s + aggregateVisible(u.attributes)[key], 0) / roster.length);
}

// Tiers newly crossed (rounded team-avg went from below to at/above) per aggregate.
export function crossedBreakpoints(before: readonly Unit[], after: readonly Unit[]): Crossing[] {
  const out: Crossing[] = [];
  for (const key of AGGREGATES) {
    const a = teamAggregate(before, key);
    const b = teamAggregate(after, key);
    for (const tier of BREAKPOINTS.tiers) {
      if (a < tier && b >= tier) out.push({ aggregate: key, tier });
    }
  }
  return out;
}
