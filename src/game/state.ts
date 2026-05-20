// Builds the initial GameState: load Map A, spawn both teams, seed empty
// paths and cursors, default to planning phase at 1× paused.

import type { GameState, MoveCursor, Path } from './types.ts';
import { parseMap } from './map.ts';
import { createTeam } from './units.ts';
import { clearPath } from './path.ts';
import { initialCursor } from './movement.ts';
import { MAP_A } from '../maps/mapA.ts';

export function buildInitialState(): GameState {
  const map = parseMap(MAP_A);
  const defenders = createTeam('defenders', map.defenderSpawns);
  const attackers = createTeam('attackers', map.attackerSpawns);
  const units = [...defenders, ...attackers];

  const paths: Record<string, Path> = {};
  const cursors: Record<string, MoveCursor> = {};
  for (const u of units) {
    paths[u.id] = clearPath(u.pos);
    cursors[u.id] = initialCursor();
  }

  return {
    phase: 'planning',
    map,
    units,
    paths,
    cursors,
    tick: 0,
    playback: { playing: false, speed: 1 },
  };
}
