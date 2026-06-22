// Part 6 (season meta-loop) — playbook gating helpers. Pure functions over the
// roster's Tenacity (the Discipline aggregate) that decide how much authored-play
// complexity a squad may FIELD (capacity) and how elaborate a route each unit may
// be assigned. Thresholds live in config.PLAYBOOK_GATING. These gate the editor
// only; in-match adherence is still the compliance roll.

import { PLAYBOOK_GATING } from './config.ts';
import type { Unit } from './types.ts';

export function teamAvgTenacity(roster: readonly Unit[]): number {
  if (!roster.length) return 50;
  return roster.reduce((sum, u) => sum + u.attributes.tenacity, 0) / roster.length;
}

// How many saved plays the squad can keep, from team-average Tenacity.
export function playbookCapacity(roster: readonly Unit[]): number {
  const avg = teamAvgTenacity(roster);
  for (const tier of PLAYBOOK_GATING.capacity) if (avg >= tier.minAvg) return tier.plays;
  return 1;
}

// Max route waypoints a unit of this Tenacity may be assigned (0 = holds only).
export function routeMaxWaypoints(tenacity: number): number {
  const r = PLAYBOOK_GATING.route;
  if (tenacity >= r.full) return Infinity;
  if (tenacity >= r.multi) return r.multiMax;
  if (tenacity >= r.oneWaypoint) return 1;
  return 0;
}

// Per-waypoint wait + watch (lurks/baits) only at the top discipline tier.
export function routeAllowsWaitWatch(tenacity: number): boolean {
  return tenacity >= PLAYBOOK_GATING.route.full;
}

// A short, number-free description of a unit's route allowance — player-facing
// copy stays qualitative (numbers are reserved for the AI / under the hood).
export function routeAllowanceLabel(tenacity: number): string {
  const max = routeMaxWaypoints(tenacity);
  if (max === 0) return 'Holds position only — not disciplined enough to run a route.';
  if (max === Infinity) return 'Can run full routes, including lurks and baits (wait + watch at each stop).';
  if (max === 1) return 'Can run a simple one-stop route.';
  return `Can run a route of up to ${max} stops.`;
}
