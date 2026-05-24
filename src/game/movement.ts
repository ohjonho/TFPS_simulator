// Per-tick movement: advance one unit's cursor along its A* route at its
// effective speed. Pure. Salvaged from the legacy fractional-progress stepper,
// minus the waypoint/hold model (movement is now A*-toward-target).

import type { Facing, GameState, HexCoord, MoveState, Unit } from './types.ts';
import { MOVE, SPEED } from './config.ts';
import { directionBetween, findPath } from './pathfind.ts';

export type AdvanceResult = {
  pos: HexCoord;
  facing: Facing;
  move: MoveState;
};

// Hexes per tick for this unit. The Run-n-Gun bonus is a Pass 6 hook — inert
// while behavioral traits are null.
export function effectiveSpeed(unit: Unit): number {
  const base = SPEED[unit.weapon];
  const runGun = unit.behavioralTrait === 'Run-n-Gun' ? MOVE.runAndGunBonus : 0;
  return base + runGun;
}

export function advanceUnit(unit: Unit, move: MoveState): AdvanceResult {
  const lastIndex = move.path.length - 1;
  // No route, or already at the destination — stay put.
  if (lastIndex <= 0 || move.progress >= lastIndex) {
    return { pos: unit.pos, facing: unit.facing, move };
  }

  const currentIndex = Math.floor(move.progress);
  const newProgress = Math.min(move.progress + effectiveSpeed(unit), lastIndex);
  const newIndex = Math.floor(newProgress);

  // Didn't cross into a new hex this tick (e.g. sniper mid-step).
  if (newIndex === currentIndex) {
    return { pos: unit.pos, facing: unit.facing, move: { ...move, progress: newProgress } };
  }

  const newPos = move.path[newIndex];
  const stepFrom = move.path[newIndex - 1];
  const facing = directionBetween(stepFrom, newPos) ?? unit.facing;
  return { pos: newPos, facing, move: { ...move, progress: newProgress } };
}

// Assign a destination to a unit: compute an A* route from its current hex and
// reset its movement cursor. No-op if the goal is unreachable.
export function assignTarget(state: GameState, unitId: string, goal: HexCoord): GameState {
  const unit = state.units.find((u) => u.id === unitId);
  if (!unit || unit.state !== 'alive') return state;

  const path = findPath(state.map, unit.pos, goal);
  if (!path) return state;

  return {
    ...state,
    targets: { ...state.targets, [unitId]: goal },
    moves: { ...state.moves, [unitId]: { path, progress: 0 } },
  };
}

export function blankMove(pos: HexCoord): MoveState {
  return { path: [pos], progress: 0 };
}
