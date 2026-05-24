// Pass 3 — Vision Cones & Fog of War. All functions pure: take a state
// snapshot, return derived data. Ported from the legacy flat-top/axial version
// onto the pointy-top odd-row offset grid.
//
// Pipeline per tick (called from stepTick AFTER movement):
//   1. computeVisibility(state) → { visibility, perUnit }
//   2. updateTracking(state, perUnit) → tracking
//   3. updateGhosts(preMoveUnits, …) → ghosts
//
// Cone math is done in pixel space (offsetToPixel) so hex geometry maps cleanly
// to angles. Occlusion uses a supercover hex-line trace in axial coords with
// double-sampling so the line catches hexes it merely grazes at boundaries.

import type {
  GameState,
  GhostEntry,
  HexCoord,
  HexKey,
  MapDefinition,
  Team,
  TrackEntry,
  Unit,
  Visibility,
} from './types.ts';
import { hexDistance, hexLine, offsetToPixel } from './hex.ts';
import { neighbors } from './pathfind.ts';
import { VISION } from './config.ts';

// --- Keys / angle helpers ---------------------------------------------------

export function hexKey(h: HexCoord): HexKey {
  return `${h.col},${h.row}`;
}

export function parseHexKey(k: HexKey): HexCoord {
  const i = k.indexOf(',');
  return { col: Number(k.slice(0, i)), row: Number(k.slice(i + 1)) };
}

function wrapToPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

function bearingPixelRad(from: HexCoord, to: HexCoord): number {
  const a = offsetToPixel(from.col, from.row);
  const b = offsetToPixel(to.col, to.row);
  return Math.atan2(b.y - a.y, b.x - a.x);
}

// Bearing the unit "faces": geometric direction toward the neighbor in its
// facing index (parity-correct, since neighbor deltas differ by row parity).
export function facingBearingRad(pos: HexCoord, facing: number): number {
  const nb = neighbors(pos)[facing];
  return bearingPixelRad(pos, nb);
}

// --- Sniper stationary rule -------------------------------------------------

// In v0 there are no waypoint holds, so "stationary" reduces to: the unit did
// not change hex this tick (prevPos === current pos).
export function isStationary(unit: Unit, prevPos: HexCoord | undefined): boolean {
  if (!prevPos) return true;
  return unit.pos.col === prevPos.col && unit.pos.row === prevPos.row;
}

function coneHalfRad(unit: Unit, state: GameState): number {
  let halfDeg: number = VISION.defaultConeHalfDeg;
  if (unit.weapon === 'sniper' && isStationary(unit, state.prevPos[unit.id])) {
    halfDeg = VISION.sniperStationaryHalfDeg;
  }
  if (unit.skillTrait === 'Eagle Eye') {
    halfDeg += VISION.eagleEyeBonusHalfDeg;
  }
  return (halfDeg * Math.PI) / 180;
}

// --- Cone center ------------------------------------------------------------

// Point at the tracked enemy's last-known hex if tracking a live enemy; else
// face the natural facing direction.
export function coneCenterRad(
  unit: Unit,
  tracking: TrackEntry | null,
  unitsById: Record<string, Unit>,
): number {
  if (tracking) {
    const enemy = unitsById[tracking.enemyId];
    if (enemy && enemy.state === 'alive') {
      return bearingPixelRad(unit.pos, tracking.lastKnownHex);
    }
  }
  return facingBearingRad(unit.pos, unit.facing);
}

// --- Cone hex enumeration ---------------------------------------------------

export function hexesInCone(
  viewer: Unit,
  map: MapDefinition,
  centerRad: number,
  halfRad: number,
): Set<HexKey> {
  const out = new Set<HexKey>();
  out.add(hexKey(viewer.pos));
  const vpx = offsetToPixel(viewer.pos.col, viewer.pos.row);
  for (let row = 0; row < map.height; row++) {
    for (let col = 0; col < map.width; col++) {
      if (col === viewer.pos.col && row === viewer.pos.row) continue;
      const px = offsetToPixel(col, row);
      const bearing = Math.atan2(px.y - vpx.y, px.x - vpx.x);
      if (Math.abs(wrapToPi(bearing - centerRad)) <= halfRad) {
        out.add(`${col},${row}`);
      }
    }
  }
  return out;
}

// --- Supercover line trace --------------------------------------------------

// Visible iff no full-wall hex lies strictly between `from` and `to`. Endpoints
// are skipped (a viewer sees out of its own hex; the target is the candidate).
// Cover does NOT block vision — only 'wall' does.
export function isVisibleAlongLine(from: HexCoord, to: HexCoord, map: MapDefinition): boolean {
  if (from.col === to.col && from.row === to.row) return true;
  const line = hexLine(from, to);
  // Skip the endpoints (viewer sees out of its own hex; target is the candidate).
  for (let i = 1; i < line.length - 1; i++) {
    const h = line[i];
    if (h.row < 0 || h.row >= map.height || h.col < 0 || h.col >= map.width) continue;
    if (map.grid[h.row][h.col] === 'wall') return false;
  }
  return true;
}

// --- Top-level visibility computation ---------------------------------------

export type VisibilityComputation = {
  visibility: Visibility;
  perUnit: Record<string, Set<HexKey>>;
};

export function computeVisibility(state: GameState): VisibilityComputation {
  const visibility: Visibility = {
    defenders: new Set<HexKey>(),
    attackers: new Set<HexKey>(),
  };
  const perUnit: Record<string, Set<HexKey>> = {};
  const unitsById: Record<string, Unit> = {};
  for (const u of state.units) unitsById[u.id] = u;

  for (const u of state.units) {
    if (u.state !== 'alive') {
      perUnit[u.id] = new Set();
      continue;
    }
    const center = coneCenterRad(u, state.tracking[u.id] ?? null, unitsById);
    const half = coneHalfRad(u, state);
    const cone = hexesInCone(u, state.map, center, half);
    const visible = new Set<HexKey>();
    const selfKey = hexKey(u.pos);
    visible.add(selfKey);
    for (const key of cone) {
      if (key === selfKey) continue;
      const target = parseHexKey(key);
      if (isVisibleAlongLine(u.pos, target, state.map)) visible.add(key);
    }
    perUnit[u.id] = visible;
    const teamSet = visibility[u.team];
    for (const k of visible) teamSet.add(k);
  }

  // Pass 8 — Tactical Scan (Techy card): while active for a team, union all
  // live enemy positions into that team's visibility set (overrides fog).
  for (const fx of state.cardEffects) {
    if (fx.kind !== 'tactical_scan') continue;
    if (state.tick > fx.expiresAtTick) continue;
    for (const u of state.units) {
      if (u.state !== 'alive') continue;
      if (u.team === fx.team) continue;
      visibility[fx.team].add(hexKey(u.pos));
    }
  }
  // Pass 9 m3 — Mark Target reveal: while revealUntilTick > state.tick, add
  // the marked enemy's hex to the marking team's visibility set (per-enemy
  // analogue of Tactical Scan).
  for (const fx of state.cardEffects) {
    if (fx.kind !== 'mark_target') continue;
    if ((fx.revealUntilTick ?? -1) <= state.tick) continue;
    const target = unitsById[fx.targetId];
    if (!target || target.state !== 'alive') continue;
    visibility[fx.team].add(hexKey(target.pos));
  }
  return { visibility, perUnit };
}

// Debug-only: per-unit cone + visible sets plus the center/half that produced
// them, so the V overlay draws arc edges matching the live cone math.
export type PerUnitDebugInfo = {
  coneCenterRad: number;
  halfRad: number;
  cone: Set<HexKey>;
  visible: Set<HexKey>;
};

export function computePerUnitDebug(state: GameState): Record<string, PerUnitDebugInfo> {
  const out: Record<string, PerUnitDebugInfo> = {};
  const unitsById: Record<string, Unit> = {};
  for (const u of state.units) unitsById[u.id] = u;
  for (const u of state.units) {
    if (u.state !== 'alive') continue;
    const center = coneCenterRad(u, state.tracking[u.id] ?? null, unitsById);
    const half = coneHalfRad(u, state);
    const cone = hexesInCone(u, state.map, center, half);
    const visible = new Set<HexKey>();
    const selfKey = hexKey(u.pos);
    visible.add(selfKey);
    for (const key of cone) {
      if (key === selfKey) continue;
      const target = parseHexKey(key);
      if (isVisibleAlongLine(u.pos, target, state.map)) visible.add(key);
    }
    out[u.id] = { coneCenterRad: center, halfRad: half, cone, visible };
  }
  return out;
}

// --- Tracking update --------------------------------------------------------

export function updateTracking(
  state: GameState,
  perUnitVisible: Record<string, Set<HexKey>>,
): Record<string, TrackEntry | null> {
  const result: Record<string, TrackEntry | null> = {};
  const unitsById: Record<string, Unit> = {};
  for (const u of state.units) unitsById[u.id] = u;

  for (const u of state.units) {
    if (u.state !== 'alive') {
      result[u.id] = null;
      continue;
    }
    let track: TrackEntry | null = state.tracking[u.id] ?? null;
    const myVis = perUnitVisible[u.id] ?? new Set<HexKey>();

    // Step A: update existing track.
    if (track) {
      const enemy = unitsById[track.enemyId];
      if (!enemy || enemy.state !== 'alive') {
        track = null;
      } else if (myVis.has(hexKey(enemy.pos))) {
        track = { enemyId: enemy.id, lastKnownHex: enemy.pos, ticksLost: 0 };
      } else {
        const nextLost = track.ticksLost + 1;
        track = nextLost >= VISION.trackLossThreshold ? null : { ...track, ticksLost: nextLost };
      }
    }

    // Step B: acquire if no track — closest visible enemy, lowest-id tiebreak.
    if (!track) {
      const candidates: Array<{ id: string; dist: number }> = [];
      for (const e of state.units) {
        if (e.team === u.team || e.state !== 'alive') continue;
        if (myVis.has(hexKey(e.pos))) candidates.push({ id: e.id, dist: hexDistance(u.pos, e.pos) });
      }
      if (candidates.length > 0) {
        candidates.sort((a, b) => (a.dist !== b.dist ? a.dist - b.dist : a.id < b.id ? -1 : 1));
        const winner = unitsById[candidates[0].id];
        track = { enemyId: winner.id, lastKnownHex: winner.pos, ticksLost: 0 };
      }
    }

    result[u.id] = track;
  }
  return result;
}

// --- Ghost markers ----------------------------------------------------------

// Which enemies are visible to each team given a visibility snapshot.
export function visibleEnemiesByTeam(
  state: GameState,
  visibility: Visibility,
): Record<Team, Set<string>> {
  const out: Record<Team, Set<string>> = { defenders: new Set(), attackers: new Set() };
  for (const u of state.units) {
    if (u.state !== 'alive') continue;
    const enemyTeam: Team = u.team === 'defenders' ? 'attackers' : 'defenders';
    if (visibility[enemyTeam].has(hexKey(u.pos))) out[enemyTeam].add(u.id);
  }
  return out;
}

// preMoveUnits supply each newly-lost enemy's last-seen (pre-movement) hex.
// prevVisibleByTeam is end-of-T-1; currVisibleByTeam is end-of-T.
// Pass 9 m4: Last Stand's ghost-skip branch is gone with Last Stand itself.
export function updateGhosts(
  preMoveUnits: readonly Unit[],
  prevGhosts: Record<Team, Record<string, GhostEntry>>,
  prevVisibleByTeam: Record<Team, Set<string>>,
  currVisibleByTeam: Record<Team, Set<string>>,
  _currentTick = 0,
): Record<Team, Record<string, GhostEntry>> {
  const teams: Team[] = ['defenders', 'attackers'];
  const result: Record<Team, Record<string, GhostEntry>> = { defenders: {}, attackers: {} };
  const preById: Record<string, Unit> = {};
  for (const u of preMoveUnits) preById[u.id] = u;

  for (const team of teams) {
    const prev = prevGhosts[team];
    const next: Record<string, GhostEntry> = {};

    // Carry existing ghosts forward, decrementing.
    for (const enemyId of Object.keys(prev)) {
      const remaining = prev[enemyId].ticksRemaining - 1;
      if (remaining > 0) next[enemyId] = { hex: prev[enemyId].hex, ticksRemaining: remaining };
    }
    // Newly lost: drop a fresh ghost at the enemy's last-seen position.
    for (const enemyId of prevVisibleByTeam[team]) {
      if (currVisibleByTeam[team].has(enemyId)) continue;
      const enemy = preById[enemyId];
      if (!enemy) continue;
      next[enemyId] = { hex: enemy.pos, ticksRemaining: VISION.ghostTicks };
    }
    // Currently visible: clear any ghost (re-sighted).
    for (const enemyId of currVisibleByTeam[team]) delete next[enemyId];

    result[team] = next;
  }
  return result;
}
