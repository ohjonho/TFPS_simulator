// Builds the initial GameState: load Map A, spawn both teams.

import type { GameState } from './types.ts';
import { parseMap } from './map.ts';
import { createTeam } from './units.ts';
import { MAP_A } from '../maps/mapA.ts';

export function buildInitialState(): GameState {
  const map = parseMap(MAP_A);
  const defenders = createTeam('defenders', map.defenderSpawns);
  const attackers = createTeam('attackers', map.attackerSpawns);
  return {
    map,
    units: [...defenders, ...attackers],
  };
}
