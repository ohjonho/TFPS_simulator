// Pure helpers for building and mutating planned movement paths.
// All exports are pure functions; callers handle GameState wiring.

import type { Axial, Facing, GameMap, Path, Terrain, Waypoint } from './types.ts';
import { axialToOffset } from './hex.ts';

// Flat-top axial neighbors, clockwise from N. Index aligns with Facing values:
// 0=N, 1=NE, 2=SE, 3=S, 4=SW, 5=NW.
export const AXIAL_NEIGHBORS: readonly Axial[] = [
  { q: 0, r: -1 },
  { q: 1, r: -1 },
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
];

export function axialEq(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r;
}

export function neighborInDirection(hex: Axial, dir: Facing): Axial {
  const d = AXIAL_NEIGHBORS[dir];
  return { q: hex.q + d.q, r: hex.r + d.r };
}

// Returns the Facing index from `from` to `to` if they are adjacent, else null.
export function facingBetween(from: Axial, to: Axial): Facing | null {
  for (let i = 0; i < AXIAL_NEIGHBORS.length; i++) {
    const n = AXIAL_NEIGHBORS[i];
    if (from.q + n.q === to.q && from.r + n.r === to.r) {
      return i as Facing;
    }
  }
  return null;
}

export function isOnMap(map: GameMap, hex: Axial): boolean {
  const { col, row } = axialToOffset(hex);
  return col >= 0 && col < map.cols && row >= 0 && row < map.rows;
}

export function terrainAt(map: GameMap, hex: Axial): Terrain | null {
  if (!isOnMap(map, hex)) return null;
  const { col, row } = axialToOffset(hex);
  return map.cells[row][col];
}

// Half walls AND full walls block movement (spec §4.2: half walls let vision
// pass but block movement). Spawn hexes and open hexes are passable.
export function isPassable(terrain: Terrain | null): boolean {
  return terrain !== null && terrain !== 'fullWall' && terrain !== 'halfWall';
}

export function indexOfHexInPath(path: Path, hex: Axial): number {
  for (let i = 0; i < path.hexes.length; i++) {
    if (axialEq(path.hexes[i], hex)) return i;
  }
  return -1;
}

// May this `candidate` hex be appended to `path`?
// - Must be on map and passable.
// - Must be adjacent to the current path tail.
// - Must not already appear on this path (no self-intersection).
export function canExtendPath(
  map: GameMap,
  path: Path,
  candidate: Axial,
): boolean {
  if (path.hexes.length === 0) return false;
  if (!isPassable(terrainAt(map, candidate))) return false;
  if (indexOfHexInPath(path, candidate) !== -1) return false;
  const tail = path.hexes[path.hexes.length - 1];
  return facingBetween(tail, candidate) !== null;
}

// Returns a new path with `candidate` appended. Caller should canExtendPath first.
export function extendPath(path: Path, candidate: Axial): Path {
  return {
    hexes: [...path.hexes, candidate],
    waypoints: path.waypoints,
  };
}

// Truncates the path at the given index (inclusive). Used when the user
// drags backward over an already-drawn segment to retract it.
export function truncatePath(path: Path, keepThroughIndex: number): Path {
  if (keepThroughIndex < 0 || keepThroughIndex >= path.hexes.length) return path;
  const newHexes = path.hexes.slice(0, keepThroughIndex + 1);
  // Drop waypoints that fall beyond the new tail.
  const newWaypoints: Record<number, Waypoint> = {};
  for (const k of Object.keys(path.waypoints)) {
    const idx = Number(k);
    if (idx <= keepThroughIndex) newWaypoints[idx] = path.waypoints[idx];
  }
  return { hexes: newHexes, waypoints: newWaypoints };
}

export function setWaypoint(
  path: Path,
  hexIndex: number,
  waypoint: Waypoint,
): Path {
  if (hexIndex <= 0 || hexIndex >= path.hexes.length) {
    // Index 0 is the spawn hex — no waypoints there in v0.
    return path;
  }
  return {
    hexes: path.hexes,
    waypoints: { ...path.waypoints, [hexIndex]: waypoint },
  };
}

export function removeWaypoint(path: Path, hexIndex: number): Path {
  if (!(hexIndex in path.waypoints)) return path;
  const next: Record<number, Waypoint> = { ...path.waypoints };
  delete next[hexIndex];
  return { hexes: path.hexes, waypoints: next };
}

export function clearPath(spawn: Axial): Path {
  return { hexes: [spawn], waypoints: {} };
}

export function pathIsBlank(path: Path): boolean {
  // A path with only the spawn hex hasn't been drawn yet.
  return path.hexes.length <= 1;
}
