// Pass 4 — per-unit tactical AI (spec §8.3). Pure primitives the tick loop
// composes each tick. No strategy/role/trait/card logic yet (Passes 6–8); each
// primitive is shaped to be overridable by those later.

import type { Facing, HexCoord, MapDefinition, Unit } from './types.ts';
import { hexDistance, offsetToPixel } from './hex.ts';
import { neighbors, passableAt, findPath } from './pathfind.ts';
import { AI } from './config.ts';

// Pass 7.8 — target prioritization. Ranked tiebreakers:
//   1. lowest HP first (secure the kill before it walks behind cover);
//   2. sniper before others (peel off the highest-threat weapon class);
//   3. closest (shorter range usually = higher hit %);
//   4. lowest id (determinism).
// Pre-Pass-7.8 this was just (3) + (4); the wounded-target-first rule makes
// teams visibly finish kills instead of splitting fire across full-HP enemies.
export function pickFiringTarget(unit: Unit, visibleEnemies: readonly Unit[]): string | null {
  if (visibleEnemies.length === 0) return null;
  const sorted = [...visibleEnemies].sort((a, b) => {
    if (a.hp !== b.hp) return a.hp - b.hp;
    const aSniper = a.weapon === 'sniper' ? 0 : 1;
    const bSniper = b.weapon === 'sniper' ? 0 : 1;
    if (aSniper !== bSniper) return aSniper - bSniper;
    const da = hexDistance(unit.pos, a.pos);
    const db = hexDistance(unit.pos, b.pos);
    if (da !== db) return da - db;
    return a.id < b.id ? -1 : 1;
  });
  return sorted[0].id;
}

export type EngagementDecision = { engage: boolean; targetId: string | null };

export function shouldEngage(unit: Unit, visibleEnemies: readonly Unit[]): EngagementDecision {
  if (visibleEnemies.length === 0) return { engage: false, targetId: null };
  return { engage: true, targetId: pickFiringTarget(unit, visibleEnemies) };
}

export type RetreatDecision = { retreat: boolean };

// Default retreat rule: low HP. Behavioral overrides (spec §12.2): Sentinel
// holds, Entry pushes forward, Clutch ignores retreat — none retreat. Lurker
// keeps the default (its retreat routes to a wall via nearestWallRetreatHex).
const NO_RETREAT_TRAITS = new Set(['Sentinel', 'Entry', 'Clutch']);

export function shouldRetreat(unit: Unit): RetreatDecision {
  // Per-round strategy can shift the threshold (Rush: −1 → never retreat at 1 HP).
  const threshold = AI.retreatHpThreshold + unit.modifiers.retreatThresholdMod;
  if (unit.hp > threshold) return { retreat: false };
  if (unit.behavioralTrait && NO_RETREAT_TRAITS.has(unit.behavioralTrait)) {
    return { retreat: false };
  }
  // Pass 8 — Reckless Push card ignores retreat for the round.
  if (unit.cardFlags.recklessPush) return { retreat: false };
  return { retreat: true };
}

// Nearest passable hex adjacent to a full wall — a unit retreats to cover its
// back against architecture. BFS outward from the unit; returns its own hex if
// already wall-adjacent (or if none is reachable).
export function nearestWallRetreatHex(unit: Unit, map: MapDefinition): HexCoord {
  const start = unit.pos;
  const seen = new Set<string>([`${start.col},${start.row}`]);
  const queue: HexCoord[] = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (isWallAdjacent(cur, map)) return cur;
    for (const nb of neighbors(cur)) {
      const k = `${nb.col},${nb.row}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (passableAt(map, nb)) queue.push(nb);
    }
  }
  return start;
}

function isWallAdjacent(hex: HexCoord, map: MapDefinition): boolean {
  for (const nb of neighbors(hex)) {
    if (nb.row < 0 || nb.row >= map.height || nb.col < 0 || nb.col >= map.width) continue;
    if (map.grid[nb.row][nb.col] === 'wall') return true;
  }
  return false;
}

// Next hex one step toward target along an A* route, or null if no path / already
// there. Callers cache the full route in MoveState; this is the "primitive" form.
export function moveToward(unit: Unit, targetHex: HexCoord, map: MapDefinition): HexCoord | null {
  const path = findPath(map, unit.pos, targetHex);
  if (!path || path.length < 2) return null;
  return path[1];
}

export type HoldAction = { facing: Unit['facing'] };

export function holdPosition(unit: Unit): HoldAction {
  return { facing: unit.facing };
}

// Pass 7.6 — "hold strong defensive position": on transition to holding, a unit
// shuffles 1 hex if a neighbor is better cover (wall-adjacent preferred over
// cover-adjacent over neither). Returns the unit's current hex when nothing is
// better. Pass 7.7 accepts an occupancy set so cover-seek skips hexes taken by
// other units. Pass 7.8 accepts an optional `threat` hex; when supplied, scoring
// becomes sightline-aware — a wall/cover hex on the *threat side* of the
// candidate is what matters, not just any neighbor wall (a unit hugging a wall
// facing the wrong way isn't actually covered). Pure; called by tick.ts before
// deciding to mode='holding'.
export function findCoverHoldHex(
  unit: Unit,
  map: MapDefinition,
  occupied: ReadonlySet<string> = new Set(),
  threat?: HexCoord,
): HexCoord {
  const here = unit.pos;
  const selfKey = `${here.col},${here.row}`;
  const score = (h: HexCoord) =>
    threat ? sightlineCoverScore(h, map, threat) : coverScore(h, map);
  let best = here;
  let bestScore = score(here);
  for (const nb of neighbors(here)) {
    if (!passableAt(map, nb)) continue;
    const key = `${nb.col},${nb.row}`;
    if (key !== selfKey && occupied.has(key)) continue;
    const s = score(nb);
    // Strict > so the unit doesn't shuffle when its own hex is already best.
    if (s > bestScore) {
      best = nb;
      bestScore = s;
    }
  }
  return best;
}

// Sightline-aware cover scoring (Pass 7.8). Rank the candidate's 6 neighbors by
// how close their bearing is to the threat bearing — the "front" neighbor is
// the one in the threat's direction. A wall there fully blocks LoS (4); cover
// there is half-cover (3); a wall/cover one slot off (the "side" neighbors)
// still provides partial cover (2/1); otherwise 0. Falls back to plain
// coverScore-shaped numbers when no threat-side blocker exists.
function sightlineCoverScore(hex: HexCoord, map: MapDefinition, threat: HexCoord): number {
  const a = offsetToPixel(hex.col, hex.row);
  const b = offsetToPixel(threat.col, threat.row);
  const threatBearing = Math.atan2(b.y - a.y, b.x - a.x);
  const nbrs = neighbors(hex);
  const ranked = nbrs
    .map((nb) => {
      const np = offsetToPixel(nb.col, nb.row);
      const nbBearing = Math.atan2(np.y - a.y, np.x - a.x);
      return { nb, delta: Math.abs(wrapPi(nbBearing - threatBearing)) };
    })
    .sort((x, y) => x.delta - y.delta);

  const tileAt = (h: HexCoord): string | null => {
    if (h.row < 0 || h.row >= map.height || h.col < 0 || h.col >= map.width) return null;
    return map.grid[h.row][h.col];
  };

  const front = tileAt(ranked[0].nb);
  if (front === 'wall') return 4;
  if (front === 'cover') return 3;
  for (let i = 1; i <= 2 && i < ranked.length; i++) {
    const side = tileAt(ranked[i].nb);
    if (side === 'wall') return 2;
    if (side === 'cover') return 1;
  }
  return 0;
}

// Pass 7.7 — pixel-angle → nearest of the 6 neighbor directions (facing 0..5).
// Used to snap facing when a unit is shot from outside its cone, and to face
// the expected threat direction when settling into hold.
export function nearestFacing(from: HexCoord, to: HexCoord): Facing {
  const a = offsetToPixel(from.col, from.row);
  const b = offsetToPixel(to.col, to.row);
  const bearing = Math.atan2(b.y - a.y, b.x - a.x);
  // Compare against each neighbor's bearing (computed geometrically — parity-
  // correct, matches vision.facingBearingRad).
  const nbrs = neighbors(from);
  let best: Facing = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < nbrs.length; i++) {
    const np = offsetToPixel(nbrs[i].col, nbrs[i].row);
    const nbBearing = Math.atan2(np.y - a.y, np.x - a.x);
    const delta = Math.abs(wrapPi(nbBearing - bearing));
    if (delta < bestDelta) {
      best = i as Facing;
      bestDelta = delta;
    }
  }
  return best;
}

function wrapPi(x: number): number {
  let v = x;
  while (v > Math.PI) v -= 2 * Math.PI;
  while (v <= -Math.PI) v += 2 * Math.PI;
  return v;
}

// 2 if adjacent to a wall, 1 if adjacent to cover, 0 otherwise. Walls beat
// cover (full walls anchor better defensive geometry).
function coverScore(hex: HexCoord, map: MapDefinition): number {
  let s = 0;
  for (const nb of neighbors(hex)) {
    if (nb.row < 0 || nb.row >= map.height || nb.col < 0 || nb.col >= map.width) continue;
    const t = map.grid[nb.row][nb.col];
    if (t === 'wall') return 2;
    if (t === 'cover') s = Math.max(s, 1);
  }
  return s;
}
