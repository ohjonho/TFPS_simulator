// Per-tick simulation step. Pass 2 advanced movement; Pass 3 adds the vision
// pipeline immediately after movement, per spec §14:
//   positions → vision → engagements → damage → round-end
// Engagements/damage/round-end land in Passes 4–6.

import type { Axial, GameState, MoveCursor, Unit } from './types.ts';
import { advanceUnit } from './movement.ts';
import {
  computeVisibility,
  updateGhosts,
  updateTracking,
  visibleEnemiesByTeam,
} from './vision.ts';

export function stepTick(state: GameState): GameState {
  const nextUnits: Unit[] = [];
  const nextCursors: Record<string, MoveCursor> = {};
  // Snapshot pre-movement state so vision (sniper-stationary check) and ghosts
  // (last-seen position) can compare end-of-T-1 against end-of-T.
  const newPrevPos: Record<string, Axial> = {};
  const newPrevHold: Record<string, number> = {};

  for (const unit of state.units) {
    const path = state.paths[unit.id];
    const cursor = state.cursors[unit.id];
    newPrevPos[unit.id] = unit.pos;
    newPrevHold[unit.id] = cursor?.holdRemaining ?? 0;
    if (!path || !cursor || unit.state !== 'alive') {
      nextUnits.push(unit);
      if (cursor) nextCursors[unit.id] = cursor;
      continue;
    }
    const result = advanceUnit(unit, path, cursor);
    nextCursors[unit.id] = result.cursor;
    if (result.pos === unit.pos && result.facing === unit.facing) {
      nextUnits.push(unit);
    } else {
      nextUnits.push({ ...unit, pos: result.pos, facing: result.facing });
    }
  }

  // Intermediate state after movement; vision functions read from this.
  const postMoveState: GameState = {
    ...state,
    units: nextUnits,
    cursors: nextCursors,
    prevPos: newPrevPos,
    prevHoldRemaining: newPrevHold,
    tick: state.tick + 1,
  };

  const { visibility, perUnit } = computeVisibility(postMoveState);
  const tracking = updateTracking(postMoveState, perUnit);

  // Ghost computation uses end-of-T-1 visibility (state.visibility from input)
  // and end-of-T visibility (just computed). Pre-movement unit positions
  // (state.units, NOT nextUnits) supply the "last-seen" hex for newly lost
  // enemies.
  const prevVisibleByTeam = visibleEnemiesByTeam(state, state.visibility);
  const currVisibleByTeam = visibleEnemiesByTeam(postMoveState, visibility);
  const ghosts = updateGhosts(
    state.units,
    state.ghosts,
    prevVisibleByTeam,
    currVisibleByTeam,
  );

  return {
    ...postMoveState,
    visibility,
    tracking,
    ghosts,
  };
}

// True once every alive unit has reached the end of its path with no holds
// pending. The playback loop uses this to auto-pause at the end of resolution
// in Pass 2; later passes swap this for round-end detection (one team wiped).
export function allUnitsFinished(state: GameState): boolean {
  for (const unit of state.units) {
    if (unit.state !== 'alive') continue;
    const path = state.paths[unit.id];
    const cursor = state.cursors[unit.id];
    if (!path || !cursor) continue;
    const lastIndex = path.hexes.length - 1;
    if (lastIndex <= 0) continue;
    if (cursor.progress < lastIndex || cursor.holdRemaining > 0) return false;
  }
  return true;
}
