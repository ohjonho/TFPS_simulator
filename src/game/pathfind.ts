// A* pathfinding on the pointy-top, odd-row offset hex grid.
// Pure: takes a MapDefinition + start/goal offset coords, returns the route.
//
// Movement passability (spec §4.2): walls AND cover block movement; every other
// cell type is traversable.

import type { Facing, HexCoord, MapDefinition } from './types.ts';
import { hexDistance } from './hex.ts';

// Offset neighbor deltas [dcol, drow] for odd-r layout, in canonical order
// E, NE, NW, W, SW, SE (index = Facing). Pointy-top has no due-N/S neighbor;
// the precise facing↔angle mapping is refined in Pass 3 (vision cones).
const NEIGHBORS_EVEN_ROW: ReadonlyArray<readonly [number, number]> = [
  [+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1],
];
const NEIGHBORS_ODD_ROW: ReadonlyArray<readonly [number, number]> = [
  [+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1],
];

function neighborDeltas(row: number) {
  return row % 2 === 1 ? NEIGHBORS_ODD_ROW : NEIGHBORS_EVEN_ROW;
}

export function inBounds(map: MapDefinition, hex: HexCoord): boolean {
  return hex.col >= 0 && hex.col < map.width && hex.row >= 0 && hex.row < map.height;
}

export function passableAt(map: MapDefinition, hex: HexCoord): boolean {
  if (!inBounds(map, hex)) return false;
  const t = map.grid[hex.row][hex.col];
  return t !== 'wall' && t !== 'cover';
}

export function neighbors(hex: HexCoord): HexCoord[] {
  return neighborDeltas(hex.row).map(([dc, dr]) => ({ col: hex.col + dc, row: hex.row + dr }));
}

// Facing index (0..5) from `from` to an adjacent `to`, or null if not adjacent.
export function directionBetween(from: HexCoord, to: HexCoord): Facing | null {
  const deltas = neighborDeltas(from.row);
  const dc = to.col - from.col;
  const dr = to.row - from.row;
  for (let i = 0; i < deltas.length; i++) {
    if (deltas[i][0] === dc && deltas[i][1] === dr) return i as Facing;
  }
  return null;
}

const key = (h: HexCoord): string => `${h.col},${h.row}`;

// A* over passable hexes. Returns an inclusive route [start, …, goal], or null
// if the goal is impassable or unreachable. A single-hex route (start===goal)
// returns [start].
//
// `avoid` (Pass 7.8): a set of "col,row" keys treated as impassable for this
// search — used by the tick loop to detour around other live units when a
// unit's next step is blocked. The goal hex itself is never avoided (a unit
// can still stand on its target even if it's the blocker's claimed hex).
export function findPath(
  map: MapDefinition,
  start: HexCoord,
  goal: HexCoord,
  avoid?: ReadonlySet<string>,
): HexCoord[] | null {
  if (!passableAt(map, start) || !passableAt(map, goal)) return null;
  if (start.col === goal.col && start.row === goal.row) return [start];

  const startKey = key(start);
  const goalKey = key(goal);
  const cameFrom = new Map<string, HexCoord>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  // Open set: keys with known fScore. Linear min-scan is fine at this grid size.
  const open = new Map<string, number>([[startKey, hexDistance(start, goal)]]);
  const openHex = new Map<string, HexCoord>([[startKey, start]]);

  while (open.size > 0) {
    // Pop the lowest-fScore node.
    let curKey = '';
    let curF = Infinity;
    for (const [k, f] of open) {
      if (f < curF) { curF = f; curKey = k; }
    }
    const current = openHex.get(curKey)!;
    if (current.col === goal.col && current.row === goal.row) {
      return reconstruct(cameFrom, current, startKey);
    }
    open.delete(curKey);
    openHex.delete(curKey);
    const curG = gScore.get(curKey)!;

    for (const nb of neighbors(current)) {
      if (!passableAt(map, nb)) continue;
      const nbKey = key(nb);
      if (avoid && nbKey !== goalKey && avoid.has(nbKey)) continue;
      const tentativeG = curG + 1;
      if (tentativeG < (gScore.get(nbKey) ?? Infinity)) {
        cameFrom.set(nbKey, current);
        gScore.set(nbKey, tentativeG);
        open.set(nbKey, tentativeG + hexDistance(nb, goal));
        openHex.set(nbKey, nb);
      }
    }
  }
  return null;
}

// Pass 8 — perimeter A*: penalizes interior hexes so the route hugs the map
// edge before turning in. Used by Slow Flank (Lurker card). Same shape as
// findPath but with a step-cost factor based on distance-to-nearest-edge.
export function findPerimeterPath(
  map: MapDefinition,
  start: HexCoord,
  goal: HexCoord,
  perimeterPenalty: number,
  avoid?: ReadonlySet<string>,
): HexCoord[] | null {
  if (!passableAt(map, start) || !passableAt(map, goal)) return null;
  if (start.col === goal.col && start.row === goal.row) return [start];

  const startKey = key(start);
  const goalKey = key(goal);
  const cameFrom = new Map<string, HexCoord>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  const maxEdge = Math.max(1, Math.floor(Math.min(map.width, map.height) / 2));
  const stepCost = (hex: HexCoord): number => {
    const distToEdge = Math.min(hex.col, map.width - 1 - hex.col, hex.row, map.height - 1 - hex.row);
    return 1 + perimeterPenalty * (distToEdge / maxEdge);
  };
  const open = new Map<string, number>([[startKey, hexDistance(start, goal)]]);
  const openHex = new Map<string, HexCoord>([[startKey, start]]);

  while (open.size > 0) {
    let curKey = '';
    let curF = Infinity;
    for (const [k, f] of open) {
      if (f < curF) { curF = f; curKey = k; }
    }
    const current = openHex.get(curKey)!;
    if (current.col === goal.col && current.row === goal.row) {
      return reconstruct(cameFrom, current, startKey);
    }
    open.delete(curKey);
    openHex.delete(curKey);
    const curG = gScore.get(curKey)!;

    for (const nb of neighbors(current)) {
      if (!passableAt(map, nb)) continue;
      const nbKey = key(nb);
      if (avoid && nbKey !== goalKey && avoid.has(nbKey)) continue;
      const tentativeG = curG + stepCost(nb);
      if (tentativeG < (gScore.get(nbKey) ?? Infinity)) {
        cameFrom.set(nbKey, current);
        gScore.set(nbKey, tentativeG);
        open.set(nbKey, tentativeG + hexDistance(nb, goal));
        openHex.set(nbKey, nb);
      }
    }
  }
  return null;
}

function reconstruct(
  cameFrom: Map<string, HexCoord>,
  goal: HexCoord,
  startKey: string,
): HexCoord[] {
  const path: HexCoord[] = [goal];
  let cur = goal;
  while (key(cur) !== startKey) {
    const prev = cameFrom.get(key(cur));
    if (!prev) break;
    path.push(prev);
    cur = prev;
  }
  path.reverse();
  return path;
}
