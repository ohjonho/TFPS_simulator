// Creates the player and AI teams from spawn positions + loadout assignments.
// Pass 1: traits are null, HP is full, facing points toward enemy side.

import type { Facing, HexCoord, Team, Unit, Weapon } from './types.ts';
import { LOADOUTS, UNIT_DEFAULTS } from './config.ts';

// Pointy-top facing index (canonical neighbor order): 0=E, 1=NE, 2=NW, 3=W,
// 4=SW, 5=SE. There's no due-N/S neighbor, so spawn-frame cones point toward
// the enemy half via a downward/upward diagonal. Movement overrides facing on
// the first step regardless.
const DEFENDER_FACING: Facing = 5; // SE — defenders (north) look downward toward attackers
const ATTACKER_FACING: Facing = 1; // NE — attackers (south) look upward toward defenders

export function createTeam(team: Team, spawns: readonly HexCoord[]): Unit[] {
  const loadouts = LOADOUTS[team] as readonly Weapon[];
  const slotCount = loadouts.length;
  if (spawns.length < slotCount) {
    throw new Error(
      `Team ${team} needs ${slotCount} spawn cells; map provided ${spawns.length}`,
    );
  }
  const idPrefix = team === 'defenders' ? 'D' : 'A';
  const facing = team === 'defenders' ? DEFENDER_FACING : ATTACKER_FACING;
  // Take the first N spawn cells in source order (left-to-right within a row).
  return loadouts.map((weapon, i): Unit => ({
    id: `${idPrefix}${i + 1}`,
    team,
    weapon,
    pos: spawns[i],
    hp: UNIT_DEFAULTS.maxHp,
    maxHp: UNIT_DEFAULTS.maxHp,
    facing,
    state: 'alive',
    // Attributes are assigned by assignAttributes() at match start; these are
    // placeholder defaults.
    skillTrait: null,
    behavioralTrait: null,
    role: 'Specialist',
    preferredRole: 'Specialist',
    hero: 'Angelic',
    modifiers: { aggression: 50, weaponHandling: 50, offPosition: false, retreatThresholdMod: 0 },
    cardFlags: {},
    directives: [],
  }));
}
