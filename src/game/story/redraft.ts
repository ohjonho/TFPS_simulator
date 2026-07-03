// Phase 4b — mid-season roster departures + redraft. PURE. When an arc's `depart`
// op comes due (game/events/runtime records it on SeasonState.pendingDepartures),
// the week loop pulls the leaving player, offers a 1-of-N sign from the reserve
// (the unpicked Origin characters), and slots the replacement in. All deterministic
// off the season seed; the match determinism gate is untouched (season-layer only).

import type { SeasonState } from '../season.ts';
import type { Unit } from '../types.ts';
import type { PendingDeparture } from '../events/types.ts';
import type { ArcRuntime } from './arcTypes.ts';
import { AUTHORED_ORIGINS, buildCharacterUnit, characterById, type CharacterDef } from './characters.ts';
import { ARCS } from './arcs.ts';
import { createRng } from '../rng.ts';
import { adjustMorale } from '../morale.ts';
import { DEPARTURE } from '../config.ts';

// The unpicked Origin characters available to sign (not on the roster, not departed).
export function reserveOrigins(season: SeasonState): CharacterDef[] {
  const onRoster = new Set(season.playerRoster.map((u) => u.characterId).filter((c): c is string => !!c));
  const gone = new Set(season.departed ?? []);
  return AUTHORED_ORIGINS.filter((c) => !onRoster.has(c.id) && !gone.has(c.id));
}

// Mid-season departures whose time has come (finite resolveAtIdx ≤ current idx;
// end-season departures use 9999 and are left to the epilogue).
export function dueDepartures(season: SeasonState): PendingDeparture[] {
  return (season.pendingDepartures ?? []).filter((d) => d.resolveAtIdx < 9999 && season.idx >= d.resolveAtIdx);
}

// Remove a player: drop from roster + arcs, mark departed, team-morale hit, and
// clear their pending record. Returns the new season + the vacated unit + its slot
// id (for the goodbye + the replacement).
export function departPlayer(season: SeasonState, characterId: string): { season: SeasonState; unit: Unit | null; slotId: string | null } {
  const unit = season.playerRoster.find((u) => u.characterId === characterId) ?? null;
  const roster = season.playerRoster.filter((u) => u.characterId !== characterId);
  const arcs = (season.arcs ?? []).filter((a) => a.characterId !== characterId);
  const departed = [...(season.departed ?? []), characterId];
  const pendingDepartures = (season.pendingDepartures ?? []).filter((d) => d.characterId !== characterId);
  const morale = adjustMorale(season.morale ?? {}, roster, 'team', null, DEPARTURE.teamMoraleHit);
  return { season: { ...season, playerRoster: roster, arcs, departed, pendingDepartures, morale }, unit, slotId: unit?.id ?? null };
}

function fnv(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Sign a reserve character into the vacated slot: build them (exact authored spread
// + thorn tags), add to the roster, and start their arc if registered. Pure.
export function signReplacement(season: SeasonState, characterId: string, slotId: string): SeasonState {
  const def = characterById(characterId);
  if (!def) return season;
  const rng = createRng((season.seed ^ 0x5164a7 ^ fnv(characterId)) >>> 0);
  const unit = buildCharacterUnit(def, slotId, rng);
  const roster = [...season.playerRoster, unit];
  const arcs: ArcRuntime[] = ARCS[def.arcId]
    ? [...(season.arcs ?? []), { arcId: def.arcId, characterId: def.id, stage: 0, heldCount: 0, status: 'unstarted' }]
    : (season.arcs ?? []);
  return { ...season, playerRoster: roster, arcs };
}

// Drop a pending departure that can't be filled (no reserve left) so it doesn't
// re-fire — the player stays. Edge case (12 Origins vs a 5-player roster).
export function cancelDeparture(season: SeasonState, characterId: string): SeasonState {
  return { ...season, pendingDepartures: (season.pendingDepartures ?? []).filter((d) => d.characterId !== characterId) };
}
