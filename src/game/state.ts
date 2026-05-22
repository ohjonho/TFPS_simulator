// Builds the initial GameState: load Map A, spawn both teams, seed empty
// paths and cursors, default to planning phase at 1× paused. Pass 3 also
// pre-computes initial visibility so the map can render fog as soon as
// resolution begins.

import type {
  Axial,
  GameState,
  GhostEntry,
  MoveCursor,
  Path,
  Team,
  TrackEntry,
} from './types.ts';
import { parseMap } from './map.ts';
import { createTeam } from './units.ts';
import { clearPath } from './path.ts';
import { initialCursor } from './movement.ts';
import { computeVisibility } from './vision.ts';
import { MAP_A } from '../maps/mapA.ts';

export function buildInitialState(): GameState {
  const map = parseMap(MAP_A);
  const defenders = createTeam('defenders', map.defenderSpawns);
  const attackers = createTeam('attackers', map.attackerSpawns);
  const units = [...defenders, ...attackers];

  const paths: Record<string, Path> = {};
  const cursors: Record<string, MoveCursor> = {};
  const tracking: Record<string, TrackEntry | null> = {};
  const prevPos: Record<string, Axial> = {};
  const prevHoldRemaining: Record<string, number> = {};
  for (const u of units) {
    paths[u.id] = clearPath(u.pos);
    cursors[u.id] = initialCursor();
    tracking[u.id] = null;
    prevPos[u.id] = u.pos;
    prevHoldRemaining[u.id] = 0;
  }

  const ghosts: Record<Team, Record<string, GhostEntry>> = {
    defenders: {},
    attackers: {},
  };

  const seed: GameState = {
    phase: 'planning',
    map,
    units,
    paths,
    cursors,
    tick: 0,
    playback: { playing: false, speed: 1 },
    visibility: { defenders: new Set(), attackers: new Set() },
    ghosts,
    tracking,
    prevPos,
    prevHoldRemaining,
    playerTeam: 'defenders',
  };

  // Initial visibility — useful so the planning preview and the first frame
  // of resolution both have a populated fog overlay.
  const { visibility } = computeVisibility(seed);
  return { ...seed, visibility };
}
