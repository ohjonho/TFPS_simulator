// Threat model — the AI-competence foundation (spec: AI improvement #3a).
//
// Pure + deterministic, no RNG. Two layers:
//
//   (A) STATIC map exposure. Per map + side, how exposed each passable hex is
//       to the *enemy side's* territory — a line-of-sight count that proxies
//       "sniper-lane danger." Precomputed once per map (cached by map.name);
//       cost is O(passable × enemy-territory-within-maxRange) one time.
//
//   (B) DYNAMIC suspected-enemy threat. From what the team actually knows this
//       tick — currently-visible enemies + team-shared ghosts (last-seen) +
//       per-unit tracking — projected as line-of-sight danger onto a queried
//       hex. No omniscience: every input is a fair, observable signal (this is
//       why the AI doesn't read the enemy's hidden strategy or true positions).
//
// `threatAt(state, team, hex)` combines both. Consumers (the engagement gate
// and approach-IQ movement, later concerns) read this so a unit respects an
// angle it can't yet see down instead of strolling into it. Nothing consumes
// it yet — this module is inert until those land, so determinism is untouched.

import type { GameState, HexCoord, HexKey, MapDefinition, Side, Team } from './types.ts';
import { hexDistance } from './hex.ts';
import { isVisibleAlongLine, hexKey } from './vision.ts';
import { passableAt } from './pathfind.ts';
import { THREAT } from './config.ts';

// Per-side normalized exposure field, indexed [row][col], values 0..1.
// `attacker[r][c]` = exposure of hex (c,r) to DEFENDER-held territory (what an
// attacker-side unit standing there fears); `defender` is the mirror.
export type ExposureField = { attacker: number[][]; defender: number[][] };

// Static exposure depends only on the map geometry, so memoize per map name.
const exposureCache = new Map<string, ExposureField>();

function centroid(hexes: readonly HexCoord[]): HexCoord {
  let c = 0;
  let r = 0;
  for (const h of hexes) {
    c += h.col;
    r += h.row;
  }
  const n = Math.max(1, hexes.length);
  return { col: Math.round(c / n), row: Math.round(r / n) };
}

// Voronoi split by spawn centroid: a hex belongs to whichever side's spawn it
// is closer to. Works for asymmetric maps (Atoll) without hard-coding a
// midline. Ties go to the defender (top) side.
function territorySide(hex: HexCoord, defC: HexCoord, atkC: HexCoord): Side {
  return hexDistance(hex, defC) <= hexDistance(hex, atkC) ? 'defender' : 'attacker';
}

function blankField(map: MapDefinition): number[][] {
  const f: number[][] = [];
  for (let row = 0; row < map.height; row++) f.push(new Array<number>(map.width).fill(0));
  return f;
}

// Count vantage hexes (within maxRange) that have a clean line of sight to `h`.
// cover never blocks LoS, walls do — same rule combat/vision use.
function countLos(h: HexCoord, vantage: readonly HexCoord[], map: MapDefinition): number {
  let n = 0;
  for (const v of vantage) {
    if (v.col === h.col && v.row === h.row) continue;
    if (hexDistance(h, v) > THREAT.maxRange) continue;
    if (isVisibleAlongLine(h, v, map)) n++;
  }
  return n;
}

function normalize(field: number[][]): void {
  let max = 0;
  for (const rowArr of field) for (const v of rowArr) if (v > max) max = v;
  if (max <= 0) return;
  for (const rowArr of field) {
    for (let c = 0; c < rowArr.length; c++) rowArr[c] /= max;
  }
}

// Precompute (and cache) the per-side static exposure field for a map.
export function staticExposure(map: MapDefinition): ExposureField {
  const cached = exposureCache.get(map.name);
  if (cached) return cached;

  const defC = centroid(map.spawns.defenders);
  const atkC = centroid(map.spawns.attackers);

  const passable: HexCoord[] = [];
  const defTerritory: HexCoord[] = [];
  const atkTerritory: HexCoord[] = [];
  for (let row = 0; row < map.height; row++) {
    for (let col = 0; col < map.width; col++) {
      const h = { col, row };
      if (!passableAt(map, h)) continue;
      passable.push(h);
      if (territorySide(h, defC, atkC) === 'defender') defTerritory.push(h);
      else atkTerritory.push(h);
    }
  }

  // attacker-side units fear defender territory; defender-side units fear
  // attacker territory.
  const attacker = blankField(map);
  const defender = blankField(map);
  for (const h of passable) {
    attacker[h.row][h.col] = countLos(h, defTerritory, map);
    defender[h.row][h.col] = countLos(h, atkTerritory, map);
  }
  normalize(attacker);
  normalize(defender);

  const field: ExposureField = { attacker, defender };
  exposureCache.set(map.name, field);
  return field;
}

// The hexes a team currently suspects an enemy could be — a union of fair
// signals: enemies it can presently see, team-shared ghosts (recently lost
// sight of), and each member's per-unit tracking last-known. Deduped.
export function suspectedEnemyHexes(state: GameState, team: Team): HexCoord[] {
  const out = new Map<HexKey, HexCoord>();
  const enemyTeam: Team = team === 'defenders' ? 'attackers' : 'defenders';

  // (a) enemies in the team's shared visibility this tick.
  for (const u of state.units) {
    if (u.team !== enemyTeam || u.state !== 'alive') continue;
    const k = hexKey(u.pos);
    if (state.visibility[team].has(k)) out.set(k, u.pos);
  }
  // (b) team-shared ghosts (last-seen positions, decaying).
  const ghosts = state.ghosts[team];
  for (const id of Object.keys(ghosts)) {
    const g = ghosts[id];
    out.set(hexKey(g.hex), g.hex);
  }
  // (c) per-unit tracking last-known among this team's alive members.
  for (const u of state.units) {
    if (u.team !== team || u.state !== 'alive') continue;
    const t = state.tracking[u.id];
    if (t) out.set(hexKey(t.lastKnownHex), t.lastKnownHex);
  }
  return [...out.values()];
}

// Dynamic threat at `hex` from a precomputed suspected-enemy set: each
// suspected hex with a clean LoS to `hex` contributes, falling off with range.
export function dynamicThreatAt(
  hex: HexCoord,
  suspected: readonly HexCoord[],
  map: MapDefinition,
): number {
  let t = 0;
  for (const s of suspected) {
    if (s.col === hex.col && s.row === hex.row) continue;
    const d = hexDistance(hex, s);
    if (d > THREAT.maxRange) continue;
    if (!isVisibleAlongLine(hex, s, map)) continue;
    t += THREAT.dynamicLosWeight / (1 + d * THREAT.distanceFalloff);
  }
  return t;
}

// Combined threat a unit on `team` faces at `hex`: static lane exposure (for
// the team's current side) plus dynamic suspected-enemy danger. Callers doing
// many queries per tick should hoist `exposure` and `suspected` (both are
// stable across a tick) and pass them in.
export function threatAt(
  state: GameState,
  team: Team,
  hex: HexCoord,
  exposure: ExposureField = staticExposure(state.map),
  suspected: readonly HexCoord[] = suspectedEnemyHexes(state, team),
): number {
  const side = state.teamSide[team];
  const stat = exposure[side][hex.row]?.[hex.col] ?? 0;
  return THREAT.staticWeight * stat + dynamicThreatAt(hex, suspected, state.map);
}
