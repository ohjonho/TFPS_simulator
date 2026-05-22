// Pass 3 — Vision Cones & Fog of War.
// All functions are pure: take a state snapshot and return derived data.
//
// Pipeline per tick (called from stepTick AFTER movement):
//   1. computeVisibility(state) → { visibility, perUnit }
//   2. updateTracking(state, perUnit) → tracking
//   3. updateGhosts(state, currVisibleEnemiesByTeam) → ghosts
//
// Cone math is done in pixel space (so flat-top hex geometry maps cleanly to
// angles). Occlusion uses a supercover hex-line trace in cube coords with
// double-sampling, so the line catches hexes it merely grazes at boundaries.
//
// Coordinate / angle convention:
//   Facing 0 = N, clockwise 1=NE, 2=SE, 3=S, 4=SW, 5=NW.
//   Pixel-angle(facing) = facing*60 - 90  (degrees). 0=N maps to -90° (straight
//   up in pixel coords, since +y is down).

import type {
  Axial,
  GameMap,
  GameState,
  GhostEntry,
  HexKey,
  Team,
  TrackEntry,
  Unit,
  Visibility,
} from './types.ts';
import { axialToPixel, hexDistance, offsetToAxial } from './hex.ts';
import { terrainAt } from './path.ts';
import { VISION } from './config.ts';

// --- Keys / angle helpers ---------------------------------------------------

export function axialKey(a: Axial): HexKey {
  return `${a.q},${a.r}`;
}

export function parseAxialKey(k: HexKey): Axial {
  const i = k.indexOf(',');
  return { q: Number(k.slice(0, i)), r: Number(k.slice(i + 1)) };
}

export function facingToAngleRad(facing: number): number {
  return ((facing * 60 - 90) * Math.PI) / 180;
}

function wrapToPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

export function bearingPixelRad(from: Axial, to: Axial): number {
  const a = axialToPixel(from);
  const b = axialToPixel(to);
  return Math.atan2(b.y - a.y, b.x - a.x);
}

// --- Cone center ------------------------------------------------------------

// If the viewer is currently tracking a live enemy, the cone points at the
// tracked enemy's last-known hex; otherwise it points along the unit's
// natural facing. Tracking that became stale (dead enemy) is treated as null
// here defensively — updateTracking will clear it for the next tick.
export function coneCenterAngle(
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
  return facingToAngleRad(unit.facing);
}

// --- Sniper stationary rule -------------------------------------------------

// stationary at tick T = position unchanged this tick AND not the first tick
// leaving a hold. We compare prev-tick pos vs current pos, and detect "first
// tick leaving hold" as the transition prevHoldRemaining > 0 → currHoldRemaining == 0.
export function isUnitStationary(
  unit: Unit,
  prevPos: Axial,
  prevHoldRemaining: number,
  currHoldRemaining: number,
): boolean {
  if (unit.pos.q !== prevPos.q || unit.pos.r !== prevPos.r) return false;
  if (prevHoldRemaining > 0 && currHoldRemaining === 0) return false;
  return true;
}

function halfConeRad(unit: Unit, state: GameState): number {
  let halfDeg: number = VISION.defaultConeHalfDeg;
  if (unit.weapon === 'sniper') {
    const prevPos = state.prevPos[unit.id] ?? unit.pos;
    const prevHold = state.prevHoldRemaining[unit.id] ?? 0;
    const currHold = state.cursors[unit.id]?.holdRemaining ?? 0;
    if (isUnitStationary(unit, prevPos, prevHold, currHold)) {
      halfDeg = VISION.sniperStationaryHalfDeg;
    }
  }
  return (halfDeg * Math.PI) / 180;
}

// --- Cone hex enumeration ---------------------------------------------------

// Returns every map hex inside this unit's cone, ignoring occlusion. Includes
// the viewer's own hex unconditionally. Iterates the full map — fine at 600
// hexes; if we ever scale up, switch to a BFS expansion outward.
export function hexesInCone(
  viewer: Unit,
  map: GameMap,
  coneCenterRad: number,
  halfRad: number,
): Set<HexKey> {
  const out = new Set<HexKey>();
  out.add(axialKey(viewer.pos));
  const viewerPx = axialToPixel(viewer.pos);
  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      const hex = offsetToAxial(col, row);
      if (hex.q === viewer.pos.q && hex.r === viewer.pos.r) continue;
      const px = axialToPixel(hex);
      const bearing = Math.atan2(px.y - viewerPx.y, px.x - viewerPx.x);
      if (Math.abs(wrapToPi(bearing - coneCenterRad)) <= halfRad) {
        out.add(axialKey(hex));
      }
    }
  }
  return out;
}

// --- Supercover line trace --------------------------------------------------

function cubeRoundAxial(qf: number, rf: number): Axial {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

// Visible iff no full-wall hex lies strictly between `from` and `to`. The two
// endpoints themselves are skipped (a viewer can see out of its own hex, and
// the target hex is by definition the candidate we're testing).
export function isVisibleAlongLine(from: Axial, to: Axial, map: GameMap): boolean {
  if (from.q === to.q && from.r === to.r) return true;
  const N = hexDistance(from, to);
  if (N <= 1) return true;
  const steps = 2 * N;
  let lastQ = Number.NaN;
  let lastR = Number.NaN;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const qf = from.q + (to.q - from.q) * t;
    const rf = from.r + (to.r - from.r) * t;
    const rounded = cubeRoundAxial(qf, rf);
    if (rounded.q === from.q && rounded.r === from.r) continue;
    if (rounded.q === to.q && rounded.r === to.r) continue;
    if (rounded.q === lastQ && rounded.r === lastR) continue;
    lastQ = rounded.q;
    lastR = rounded.r;
    if (terrainAt(map, rounded) === 'fullWall') return false;
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
    const center = coneCenterAngle(u, state.tracking[u.id] ?? null, unitsById);
    const half = halfConeRad(u, state);
    const cone = hexesInCone(u, state.map, center, half);
    const visible = new Set<HexKey>();
    const selfKey = axialKey(u.pos);
    visible.add(selfKey);
    for (const key of cone) {
      if (key === selfKey) continue;
      const target = parseAxialKey(key);
      if (isVisibleAlongLine(u.pos, target, state.map)) {
        visible.add(key);
      }
    }
    perUnit[u.id] = visible;
    const teamSet = visibility[u.team];
    for (const k of visible) teamSet.add(k);
  }
  return { visibility, perUnit };
}

// Debug-only helper: per-unit cone hex set and visible hex set, plus the cone
// center and half-angle that produced them. Used by the V overlay so the
// renderer can draw arc edges that exactly match the live cone math.
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
    const center = coneCenterAngle(u, state.tracking[u.id] ?? null, unitsById);
    const half = halfConeRad(u, state);
    const cone = hexesInCone(u, state.map, center, half);
    const visible = new Set<HexKey>();
    const selfKey = axialKey(u.pos);
    visible.add(selfKey);
    for (const key of cone) {
      if (key === selfKey) continue;
      const target = parseAxialKey(key);
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
      } else if (myVis.has(axialKey(enemy.pos))) {
        track = { enemyId: enemy.id, lastKnownHex: enemy.pos, ticksLost: 0 };
      } else {
        const nextLost = track.ticksLost + 1;
        if (nextLost >= VISION.trackLossThreshold) {
          track = null;
        } else {
          track = { ...track, ticksLost: nextLost };
        }
      }
    }

    // Step B: try to acquire if no track.
    if (!track) {
      const candidates: Array<{ id: string; dist: number }> = [];
      for (const e of state.units) {
        if (e.team === u.team) continue;
        if (e.state !== 'alive') continue;
        if (myVis.has(axialKey(e.pos))) {
          candidates.push({ id: e.id, dist: hexDistance(u.pos, e.pos) });
        }
      }
      if (candidates.length > 0) {
        candidates.sort((a, b) => {
          if (a.dist !== b.dist) return a.dist - b.dist;
          if (a.id < b.id) return -1;
          if (a.id > b.id) return 1;
          return 0;
        });
        const winnerId = candidates[0].id;
        const winner = unitsById[winnerId];
        track = { enemyId: winner.id, lastKnownHex: winner.pos, ticksLost: 0 };
      }
    }

    result[u.id] = track;
  }
  return result;
}

// --- Ghost markers ----------------------------------------------------------

// Snapshot of which enemies are visible to each team THIS tick. Used by
// updateGhosts to detect newly-lost enemies and to suppress ghosts for
// currently-visible enemies.
export function visibleEnemiesByTeam(
  state: GameState,
  visibility: Visibility,
): Record<Team, Set<string>> {
  const out: Record<Team, Set<string>> = {
    defenders: new Set<string>(),
    attackers: new Set<string>(),
  };
  for (const u of state.units) {
    if (u.state !== 'alive') continue;
    const enemyTeam: Team = u.team === 'defenders' ? 'attackers' : 'defenders';
    if (visibility[enemyTeam].has(axialKey(u.pos))) {
      out[enemyTeam].add(u.id);
    }
  }
  return out;
}

// state passed in is the PRE-MOVEMENT snapshot (so state.units[id].pos is the
// enemy's last-seen position from the perspective of end-of-T-1), and
// state.visibility is end-of-T-1. currVisibleByTeam is end-of-T.
export function updateGhosts(
  preMovementUnits: readonly Unit[],
  prevGhosts: Record<Team, Record<string, GhostEntry>>,
  prevVisibleByTeam: Record<Team, Set<string>>,
  currVisibleByTeam: Record<Team, Set<string>>,
): Record<Team, Record<string, GhostEntry>> {
  const teams: Team[] = ['defenders', 'attackers'];
  const result: Record<Team, Record<string, GhostEntry>> = {
    defenders: {},
    attackers: {},
  };
  const preById: Record<string, Unit> = {};
  for (const u of preMovementUnits) preById[u.id] = u;

  for (const team of teams) {
    const prev = prevGhosts[team];
    const next: Record<string, GhostEntry> = {};

    // Carry existing ghosts forward, decrementing their counter.
    for (const enemyId of Object.keys(prev)) {
      const entry = prev[enemyId];
      const remaining = entry.ticksRemaining - 1;
      if (remaining > 0) next[enemyId] = { hex: entry.hex, ticksRemaining: remaining };
    }

    // Newly lost: visible last tick, not visible this tick → drop a fresh ghost
    // at the enemy's last-seen (pre-movement) position. Replaces any older
    // ghost we might have decremented above.
    for (const enemyId of prevVisibleByTeam[team]) {
      if (currVisibleByTeam[team].has(enemyId)) continue;
      const enemy = preById[enemyId];
      if (!enemy) continue;
      next[enemyId] = { hex: enemy.pos, ticksRemaining: VISION.ghostTicks };
    }

    // Currently visible: clear any ghost (re-sighted).
    for (const enemyId of currVisibleByTeam[team]) {
      delete next[enemyId];
    }

    result[team] = next;
  }
  return result;
}
