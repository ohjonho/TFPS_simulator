// Per-tick movement: advance a single unit's cursor along its planned path,
// handling waypoint holds and end-of-path. Pure: takes a unit + path + cursor,
// returns the next position / facing / cursor.

import type { Axial, Facing, MoveCursor, Path, Unit } from './types.ts';
import { SPEED } from './config.ts';
import { facingBetween } from './path.ts';

export type AdvanceResult = {
  pos: Axial;
  facing: Facing;
  cursor: MoveCursor;
};

export function advanceUnit(unit: Unit, path: Path, cursor: MoveCursor): AdvanceResult {
  // No path drawn (only spawn hex) → stationary, facing unchanged.
  if (path.hexes.length <= 1) {
    return { pos: unit.pos, facing: unit.facing, cursor };
  }

  // Hold tick: tick down the counter, hold position and facing.
  if (cursor.holdRemaining > 0) {
    return {
      pos: unit.pos,
      facing: unit.facing,
      cursor: { ...cursor, holdRemaining: cursor.holdRemaining - 1 },
    };
  }

  const lastIndex = path.hexes.length - 1;
  const currentIndex = Math.floor(cursor.progress);

  // Already at end of path — sit and face whatever direction we last set.
  if (currentIndex >= lastIndex) {
    return { pos: unit.pos, facing: unit.facing, cursor };
  }

  // Advance progress by weapon speed, clamped to the path end.
  const speed = SPEED[unit.weapon];
  const newProgress = Math.min(cursor.progress + speed, lastIndex);
  const newIndex = Math.floor(newProgress);

  // If we haven't crossed into a new hex this tick, position stays put.
  if (newIndex === currentIndex) {
    return {
      pos: unit.pos,
      facing: unit.facing,
      cursor: { ...cursor, progress: newProgress },
    };
  }

  // Physically moved into a new hex.
  const newPos = path.hexes[newIndex];
  const stepFrom = path.hexes[newIndex - 1];
  const stepFacing = facingBetween(stepFrom, newPos);
  let nextFacing: Facing = stepFacing ?? unit.facing;
  let holdRemaining = 0;
  let consumedWaypointAtIndex = cursor.consumedWaypointAtIndex;

  // Waypoint check: if the hex we just landed on has a waypoint and we
  // haven't already consumed it this run, apply hold + facing.
  const wp = path.waypoints[newIndex];
  if (wp && consumedWaypointAtIndex !== newIndex) {
    holdRemaining = wp.holdTicks;
    nextFacing = wp.facing;
    consumedWaypointAtIndex = newIndex;
  }

  return {
    pos: newPos,
    facing: nextFacing,
    cursor: {
      progress: newProgress,
      holdRemaining,
      consumedWaypointAtIndex,
    },
  };
}

export function initialCursor(): MoveCursor {
  return { progress: 0, holdRemaining: 0, consumedWaypointAtIndex: null };
}
