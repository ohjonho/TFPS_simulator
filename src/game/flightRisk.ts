// Morale consequences — detecting when a player is on the verge of walking. Pure:
// reads SeasonState morale + record + personality, returns who (if anyone) is a
// flight risk. The mid-season beat (ui/flightRiskBeat.ts) lets you fight to keep
// them; the season epilogue (ui/seasonEpilogue.ts) reads the season-end leavers.
// Never touches the match RNG — purely a read over morale.

import type { SeasonState } from './season.ts';
import type { Unit } from './types.ts';
import { FLIGHT_RISK } from './config.ts';
import { moraleOf, teamMorale } from './morale.ts';

const personaOffset = (u: Unit): number => FLIGHT_RISK.persona[u.personality ?? ''] ?? 0;

// A character whose personal arc is currently unfolding — the arc owns their
// emotional state this stretch, so the generic flight-risk beat stays out of its
// way (avoids two overlapping "this player's struggling" threads on one person).
const inActiveArc = (season: SeasonState, u: Unit): boolean =>
  (season.arcs ?? []).some((rt) => rt.characterId === u.characterId && rt.status === 'active');

// The morale threshold below which THIS player is at risk this week — base, shaded
// by personality, plus situational pressure (a Firebrand frays when the team's
// losing; a Catalyst when the whole room is low).
function triggerFor(season: SeasonState, u: Unit): number {
  let t = FLIGHT_RISK.trigger + personaOffset(u);
  const wins = season.results.reduce((n, r) => n + (r === 'W' ? 1 : 0), 0);
  const losing = season.results.length - wins > wins;
  if (u.personality === 'Firebrand' && losing) t += FLIGHT_RISK.losingBump;
  if (u.personality === 'Catalyst' && teamMorale(season.morale ?? {}, season.playerRoster) < FLIGHT_RISK.lowRoomBelow) t += FLIGHT_RISK.lowRoomBump;
  return t;
}

// The lowest-morale player who is at risk this week and hasn't already had the
// flight-risk beat (handledIds) — or null. One at a time, so a bad run surfaces as
// a sequence of addressable problems rather than a pile-on.
export function flightRiskCandidate(season: SeasonState, handledIds: readonly string[]): Unit | null {
  const handled = new Set(handledIds);
  const morale = season.morale ?? {};
  const atRisk = season.playerRoster
    .filter((u) => !handled.has(u.id) && !inActiveArc(season, u) && moraleOf(morale, u.id) < triggerFor(season, u))
    .sort((a, b) => moraleOf(morale, a.id) - moraleOf(morale, b.id));
  return atRisk[0] ?? null;
}

// At season end, the players who never recovered — still below their (personality-
// shaded) leave line. Capped so a disastrous season can't empty the whole roster.
export function seasonLeavers(season: SeasonState): Unit[] {
  const morale = season.morale ?? {};
  return season.playerRoster
    .filter((u) => moraleOf(morale, u.id) < FLIGHT_RISK.leave + personaOffset(u))
    .sort((a, b) => moraleOf(morale, a.id) - moraleOf(morale, b.id))
    .slice(0, FLIGHT_RISK.maxLeavers);
}
