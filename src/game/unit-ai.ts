// Pass 4 — per-unit tactical AI (spec §8.3). Pure primitives the tick loop
// composes each tick. No strategy/role/trait/card logic yet (Passes 6–8); each
// primitive is shaped to be overridable by those later.

import type { Facing, HexCoord, MapDefinition, Unit } from './types.ts';
import { hexDistance, offsetToPixel } from './hex.ts';
import { neighbors, passableAt, isCoverAdjacent } from './pathfind.ts';
import { isVisibleAlongLine } from './vision.ts';
import { AI, FACING, POST_PLANT_SEARCH_RADIUS, POST_PLANT_PREFERRED_RANGE } from './config.ts';

// (Removed: pickFiringTarget / shouldEngage / EngagementDecision — the v0
// binary "any enemy visible → fight" + closest-target picker. Superseded by the
// odds-based engagement gate in engage.ts (assessEngagement), which does its
// own target selection. Dead since that rewrite.)

export type RetreatDecision = { retreat: boolean };

// Default retreat rule: low HP. v0.29.0 tactical-trait overrides — Anchor holds
// its ground, Aggressor pushes, Clutch stands its last — none retreat.
const NO_RETREAT_TRAITS = new Set(['Anchor', 'Aggressor', 'Clutch']);

export function shouldRetreat(unit: Unit): RetreatDecision {
  // Per-round strategy can shift the threshold (Rush: −1 → never retreat at 1 HP).
  const threshold = AI.retreatHpThreshold + unit.modifiers.retreatThresholdMod;
  if (unit.hp > threshold) return { retreat: false };
  if (unit.tacticalTraits.some((t) => NO_RETREAT_TRAITS.has(t))) {
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

// Pass 7.6 — "hold strong defensive position": on transition to holding, a unit
// shuffles 1 hex if a neighbor is better cover (wall-adjacent preferred over
// cover-adjacent over neither). Returns the unit's current hex when nothing is
// better. Pass 7.7 accepts an occupancy set so cover-seek skips hexes taken by
// other units. Pass 7.8 accepts an optional `threat` hex; when supplied, scoring
// becomes sightline-aware — a wall/cover hex on the *threat side* of the
// candidate is what matters, not just any neighbor wall (a unit hugging a wall
// facing the wrong way isn't actually covered). Pure; called by tick.ts before
// deciding to mode='holding'.
// F2 — `searchRadius` lets the caller (tick.ts) widen the cover-seek BFS
// based on the unit's Positioning attribute. radius=0 → no shuffle, radius=1
// → current behavior (adjacent neighbors), radius=2 → 2-hex BFS (rewards
// high-positioning units with better cover spots they can sometimes find a
// few hexes away). Defaults to 1 to preserve pre-F2 behavior for callers
// that don't know about Positioning.
export function findCoverHoldHex(
  unit: Unit,
  map: MapDefinition,
  occupied: ReadonlySet<string> = new Set(),
  threat?: HexCoord,
  searchRadius = 1,
): HexCoord {
  const here = unit.pos;
  const selfKey = `${here.col},${here.row}`;
  const score = (h: HexCoord) =>
    threat ? sightlineCoverScore(h, map, threat) : coverScore(h, map);
  let best = here;
  let bestScore = score(here);
  if (searchRadius <= 0) return best;

  // BFS up to `searchRadius` hexes from `here`. Candidates are passable +
  // unoccupied (except own hex). Strict > so the unit doesn't shuffle when
  // its current hex is already as good as anything reachable.
  const seen = new Set<string>([selfKey]);
  let frontier: HexCoord[] = [here];
  for (let depth = 0; depth < searchRadius; depth++) {
    const next: HexCoord[] = [];
    for (const cur of frontier) {
      for (const nb of neighbors(cur)) {
        const key = `${nb.col},${nb.row}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!passableAt(map, nb)) continue;
        if (key !== selfKey && occupied.has(key)) continue;
        const s = score(nb);
        if (s > bestScore) {
          best = nb;
          bestScore = s;
        }
        next.push(nb);
      }
    }
    frontier = next;
  }
  return best;
}

// Threat-aware hold positioning (Pillar B). When a unit settles into holding,
// pick the best hex within `radius` of its current spot by scoring the threat
// field against keeping LoS to the angle it should watch and staying put.
// Decoupled from GameState: the caller supplies `threatOf` (a closure over
// threat.ts/threatAt with the per-tick exposure + suspected hoisted) and the
// resolved `angleHex` (directive facing, else enemy spawn). Pure +
// deterministic — BFS frontier order is fixed; ties resolve to the lower-row,
// lower-col hex; the unit's own hex is the baseline so a unit never moves to a
// strictly-worse spot. `occupied` blocks hexes taken by other live units, so a
// stacked strategy (5 on one site) naturally spreads to distinct safe hexes.
export function findThreatAwareHoldHex(
  unit: Unit,
  map: MapDefinition,
  occupied: ReadonlySet<string>,
  threatOf: (h: HexCoord) => number,
  angleHex: HexCoord | null,
  radius: number,
  weights: { safety: number; los: number; cover: number; dist: number },
): HexCoord {
  const here = unit.pos;
  const selfKey = `${here.col},${here.row}`;
  // Score: low threat is good; keeping LoS to the watch angle is good; cover on
  // the threat side is good; distance from the current spot is bad.
  const score = (h: HexCoord): number => {
    const threat = threatOf(h);
    const los = angleHex && isVisibleAlongLine(h, angleHex, map) ? 1 : 0;
    const cover = angleHex ? sightlineCoverScore(h, map, angleHex) / 4 : 0;
    const dist = hexDistance(h, here);
    return (
      -weights.safety * threat +
      weights.los * los +
      weights.cover * cover -
      weights.dist * dist
    );
  };
  let best = here;
  let bestScore = score(here);
  if (radius <= 0) return best;

  // BFS up to `radius` hexes. Candidates are passable + unoccupied (except own
  // hex). Strict > so the unit only relocates for a genuinely better hex; ties
  // keep it put (or, among equal candidates, the first reached in BFS order).
  const seen = new Set<string>([selfKey]);
  let frontier: HexCoord[] = [here];
  for (let depth = 0; depth < radius; depth++) {
    const next: HexCoord[] = [];
    for (const cur of frontier) {
      for (const nb of neighbors(cur)) {
        const key = `${nb.col},${nb.row}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!passableAt(map, nb)) continue;
        next.push(nb); // expand through passable hexes even if occupied
        if (key !== selfKey && occupied.has(key)) continue;
        const s = score(nb);
        if (s > bestScore) {
          best = nb;
          bestScore = s;
        }
      }
    }
    frontier = next;
  }
  return best;
}

// bestHoldCellInRegion — threat-matrix MACRO target selection (Pillar B, Phase 1).
// Unlike findThreatAwareHoldHex (which refines within a small radius of where the
// unit ALREADY stands), this scores EVERY passable cell of a target region and
// returns the best one to head TO: low threat, line of sight to the watch angle,
// sightline-blocking cover on the threat side, and near the region centre so the
// pick stays in position. Pure + deterministic (fixed iteration; strict > keeps
// the first-best on ties). Returns null if no cell qualifies (caller keeps its
// centroid fallback).
export function bestHoldCellInRegion(
  candidates: readonly HexCoord[],
  map: MapDefinition,
  occupied: ReadonlySet<string>,
  threatOf: (h: HexCoord) => number,
  angleHex: HexCoord | null,
  weights: { safety: number; los: number; cover: number; dist: number },
): HexCoord | null {
  if (candidates.length === 0) return null;
  // Region centre = the dist-term anchor (keeps the pick "in position").
  let cc = 0;
  let cr = 0;
  for (const h of candidates) { cc += h.col; cr += h.row; }
  const center: HexCoord = {
    col: Math.round(cc / candidates.length),
    row: Math.round(cr / candidates.length),
  };
  const score = (h: HexCoord): number => {
    const threat = threatOf(h);
    const los = angleHex && isVisibleAlongLine(h, angleHex, map) ? 1 : 0;
    const cover = angleHex ? sightlineCoverScore(h, map, angleHex) / 4 : 0;
    const dist = hexDistance(h, center);
    return (
      -weights.safety * threat +
      weights.los * los +
      weights.cover * cover -
      weights.dist * dist
    );
  };
  let best: HexCoord | null = null;
  let bestScore = -Infinity;
  for (const h of candidates) {
    if (!passableAt(map, h)) continue;
    if (occupied.has(`${h.col},${h.row}`)) continue;
    const s = score(h);
    if (s > bestScore) {
      bestScore = s;
      best = h;
    }
  }
  return best;
}

// Near-edge target selection — the passable region cell nearest `from` that
// isn't already occupied. Used for defensive collapse on maps WITHOUT the
// threat-matrix cell-scorer (threatTargeting off): converging defenders head to
// the breach edge of the contacted site nearest them — and naturally spread,
// since each arrives from a different bearing — instead of all funnelling to the
// one far-corner centre cell (the "everyone sprints cross-map to one hex" look).
// No safety bias, so it meets the breach at the front rather than ceding it the
// way the threat-matrix cell did on tight maps. Pure + deterministic (fixed
// iteration; ties → lower row, then col).
export function nearestCellInRegion(
  candidates: readonly HexCoord[],
  from: HexCoord,
  map: MapDefinition,
  occupied: ReadonlySet<string>,
): HexCoord | null {
  let best: HexCoord | null = null;
  let bestD = Infinity;
  for (const h of candidates) {
    if (!passableAt(map, h)) continue;
    if (occupied.has(`${h.col},${h.row}`)) continue;
    const d = hexDistance(h, from);
    if (best === null || d < bestD) { best = h; bestD = d; continue; }
    if (d === bestD && (h.row < best.row || (h.row === best.row && h.col < best.col))) best = h;
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

// A4 — wall-aware facing. Like nearestFacing, but among the `considerNearest`
// directions closest to the desired bearing it picks the one that sees the most
// OPEN hexes straight ahead before a wall (sight depth, capped) — so the cone
// points roughly at the watch angle WITHOUT jamming into an adjacent wall (the
// "staring at a wall" bug; ~20% of units). Ties → the direction closest to the
// intended bearing. Pure + deterministic (fixed iteration, stable tiebreaks).
export function bestFacingToward(from: HexCoord, to: HexCoord, map: MapDefinition): Facing {
  const a = offsetToPixel(from.col, from.row);
  const b = offsetToPixel(to.col, to.row);
  const want = Math.atan2(b.y - a.y, b.x - a.x);
  const nbrs = neighbors(from);
  // Rank the 6 directions by bearing distance to the desired watch angle.
  const ranked = nbrs
    .map((nb, f) => {
      const np = offsetToPixel(nb.col, nb.row);
      return { f: f as Facing, delta: Math.abs(wrapPi(Math.atan2(np.y - a.y, np.x - a.x) - want)) };
    })
    .sort((x, y) => x.delta - y.delta);
  // Among the nearest few, prefer the deepest open sightline; tiebreak on bearing.
  let best: Facing = ranked[0].f;
  let bestDepth = -1;
  let bestDelta = Infinity;
  for (let i = 0; i < Math.min(FACING.considerNearest, ranked.length); i++) {
    const { f, delta } = ranked[i];
    const depth = openSightDepth(from, f, map);
    if (depth > bestDepth || (depth === bestDepth && delta < bestDelta)) {
      best = f;
      bestDepth = depth;
      bestDelta = delta;
    }
  }
  return best;
}

// Count passable (non-wall, in-bounds) hexes straight ahead in facing `f` from
// `from`, up to FACING.sightDepthCap, stopping at the first wall/edge. The
// "how far can this cone see before a wall" proxy used by bestFacingToward.
// Cover counts as open here (it blocks movement, not the sightline a unit holds
// down a covered lane). Depth 0 = the cone is jammed straight into a wall/edge.
function openSightDepth(from: HexCoord, f: Facing, map: MapDefinition): number {
  let h = from;
  for (let step = 1; step <= FACING.sightDepthCap; step++) {
    h = neighbors(h)[f];
    if (h.row < 0 || h.row >= map.height || h.col < 0 || h.col >= map.width) return step - 1;
    if (map.grid[h.row][h.col] === 'wall') return step - 1;
  }
  return FACING.sightDepthCap;
}

// Pass E m2 — post-plant attacker cover-seek. BFS around the PLANT CENTROID
// (`targetHex`) within `POST_PLANT_SEARCH_RADIUS`; among reachable
// cover-adjacent hexes with line of sight to the plant, pick the one that
// minimizes the unit's required rotation while staying in the rifle/sniper
// sweet-spot range. Returns null when no candidate qualifies; the caller
// (tick.ts) then falls back to the existing directive.
//
// Implementation note: the search center is the plant, not the unit, so
// attackers far from the spike still get a cover position to path toward
// (they'll move there over multiple ticks via the standard pathing).
export function findCoverWithLosTo(
  unit: Unit,
  targetHex: HexCoord,
  map: MapDefinition,
  occupied: ReadonlySet<string> = new Set(),
): HexCoord | null {
  const start = unit.pos;
  const center = targetHex;
  const centerKey = `${center.col},${center.row}`;
  const seen = new Set<string>([centerKey]);
  // BFS from the plant centroid out to POST_PLANT_SEARCH_RADIUS.
  const queue: HexCoord[] = [center];
  const candidates: HexCoord[] = [];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    if (hexDistance(cur, center) <= POST_PLANT_SEARCH_RADIUS) candidates.push(cur);
    for (const nb of neighbors(cur)) {
      const k = `${nb.col},${nb.row}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (!passableAt(map, nb)) continue;
      // Don't pick a hex another unit currently stands on (except the
      // moving unit itself — in case it's already on a cover hex).
      if (k !== `${start.col},${start.row}` && occupied.has(k)) continue;
      if (hexDistance(nb, center) > POST_PLANT_SEARCH_RADIUS) continue;
      queue.push(nb);
    }
  }

  // Score each candidate; require cover-adjacent + LoS to the target. The
  // sweet-spot range bonus pushes the unit out to rifle/sniper distance so it
  // isn't crowding the spike (which would force short-range disadvantage
  // against defuser shotguns). Bias toward the candidate closest to the
  // unit's current pos so multiple attackers spread across distinct angles
  // instead of stacking on one cover.
  let bestHex: HexCoord | null = null;
  let bestScore = -Infinity;
  for (const cand of candidates) {
    if (!isCoverAdjacent(map, cand)) continue;
    if (!isVisibleAlongLine(cand, targetHex, map)) continue;
    const dist = hexDistance(cand, targetHex);
    let score = 10;
    if (dist >= POST_PLANT_PREFERRED_RANGE.min && dist <= POST_PLANT_PREFERRED_RANGE.max) {
      score += 5;
    }
    // Light bias toward the unit's current pos so the attacker doesn't fly
    // across the map when a closer cover hex would work.
    score -= hexDistance(cand, start) * 0.2;
    if (score > bestScore) {
      bestScore = score;
      bestHex = cand;
    }
  }
  return bestHex;
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
