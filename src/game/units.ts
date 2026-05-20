// Creates the player and AI teams from spawn positions + loadout assignments.
// Pass 1: traits are null, HP is full, facing points toward enemy side.

import type { Axial, Facing, Team, Unit, Weapon } from './types.ts';
import { LOADOUTS, UNIT_DEFAULTS } from './config.ts';

// 0=N, 1=NE, 2=SE, 3=S, 4=SW, 5=NW.
const DEFENDER_FACING: Facing = 3; // defenders face south (toward attackers)
const ATTACKER_FACING: Facing = 0; // attackers face north (toward defenders)

export function createTeam(team: Team, spawns: readonly Axial[]): Unit[] {
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
    facing,
    state: 'alive',
    skillTrait: null,
    behavioralTrait: null,
  }));
}
