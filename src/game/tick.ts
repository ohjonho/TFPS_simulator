// Per-tick simulation step. Pass 2 only advances movement; later passes will
// extend this with vision, engagement, damage, and round-end detection (in
// that order per CLAUDE.md / spec §14).

import type { GameState, MoveCursor, Unit } from './types.ts';
import { advanceUnit } from './movement.ts';

export function stepTick(state: GameState): GameState {
  const nextUnits: Unit[] = [];
  const nextCursors: Record<string, MoveCursor> = {};

  for (const unit of state.units) {
    const path = state.paths[unit.id];
    const cursor = state.cursors[unit.id];
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

  return {
    ...state,
    units: nextUnits,
    cursors: nextCursors,
    tick: state.tick + 1,
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
