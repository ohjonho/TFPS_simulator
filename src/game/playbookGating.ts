// Part 6 (season meta-loop) — playbook gating helpers. Pure functions over a
// unit's GAME SENSE (the tactical-understanding aggregate) that decide how much
// authored-play complexity a squad may be HANDED: how many plays it can keep
// (team average) and how elaborate a route each unit can be assigned (per unit).
// Thresholds live in config.PLAYBOOK_GATING. These gate the editor only — whether
// a unit then RUNS the play faithfully under fire is Discipline, via the in-match
// compliance roll (a separate axis these don't touch).

import { PLAYBOOK_GATING } from './config.ts';
import { aggregateVisible } from './attributes.ts';
import type { Unit } from './types.ts';

// A unit's Game Sense (vision + map IQ), the player-visible aggregate.
export function gameSenseOf(unit: Unit): number {
  return aggregateVisible(unit.attributes).gameSense;
}

export function teamAvgGameSense(roster: readonly Unit[]): number {
  if (!roster.length) return 50;
  return roster.reduce((sum, u) => sum + gameSenseOf(u), 0) / roster.length;
}

// How many saved plays the squad can keep, from team-average Game Sense.
export function playbookCapacity(roster: readonly Unit[]): number {
  const avg = teamAvgGameSense(roster);
  for (const tier of PLAYBOOK_GATING.capacity) if (avg >= tier.minAvg) return tier.plays;
  return 1;
}

// Max route waypoints a unit of this Game Sense may be assigned (0 = holds only).
export function routeMaxWaypoints(gameSense: number): number {
  const r = PLAYBOOK_GATING.route;
  if (gameSense >= r.full) return Infinity;
  if (gameSense >= r.multi) return r.multiMax;
  if (gameSense >= r.oneWaypoint) return 1;
  return 0;
}

// Per-waypoint wait + watch (lurks/baits) only at the top Game Sense tier.
export function routeAllowsWaitWatch(gameSense: number): boolean {
  return gameSense >= PLAYBOOK_GATING.route.full;
}

// A short, number-free description of a unit's route allowance — player-facing
// copy stays qualitative (numbers are reserved for the AI / under the hood).
export function routeAllowanceLabel(gameSense: number): string {
  const max = routeMaxWaypoints(gameSense);
  if (max === 0) return 'Holds position only — lacks the game sense to run a route.';
  if (max === Infinity) return 'Can run full routes, including lurks and baits (wait + watch at each stop).';
  if (max === 1) return 'Can run a simple one-stop route.';
  return `Can run a route of up to ${max} stops.`;
}
