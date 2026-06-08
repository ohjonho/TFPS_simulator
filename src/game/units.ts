// Creates the player and AI teams from spawn positions + loadout assignments.
// Pass 1: traits are null, HP is full, facing points toward enemy side.

import type { Attributes, Facing, HexCoord, Team, Unit, Weapon } from './types.ts';
import { LOADOUTS, SPAWN_SPREAD, UNIT_DEFAULTS } from './config.ts';

// Choose `count` spawn cells (in unit order) from a team's spawn pool. With
// SPAWN_SPREAD on, fan the units across the zone's BACK EDGE — the deepest cell
// per column (away from the enemy) — so a wide painted zone is used (lateral
// width) WITHOUT pushing units forward into exposure (front-fanning measured
// −10pp def on open Foundryv2). `forward` is +1 when the zone faces south
// (defenders, north half) or −1 when it faces north (attackers, south half).
// Pure + deterministic. Off (or pool ≤ count) → the legacy first-N row-major.
export function placeSpawns(
  pool: readonly HexCoord[],
  count: number,
  forward: number,
): HexCoord[] {
  if (!SPAWN_SPREAD.enabled || pool.length <= count) {
    return Array.from({ length: count }, (_, i) => pool[Math.min(i, pool.length - 1)]);
  }
  // Back-edge cell per column (least forward — deepest, away from the enemy).
  const byCol = new Map<number, HexCoord>();
  for (const c of pool) {
    const cur = byCol.get(c.col);
    if (!cur || forward * c.row < forward * cur.row) byCol.set(c.col, c);
  }
  let line = [...byCol.values()].sort((a, b) => a.col - b.col);
  // Tall/narrow zone with fewer columns than units: fall back to the column-
  // sorted full pool so there are always ≥ count distinct cells.
  if (line.length < count) {
    line = [...pool].sort((a, b) => (a.col - b.col) || (forward * a.row - forward * b.row));
  }
  const out: HexCoord[] = [];
  const used = new Set<number>();
  for (let i = 0; i < count; i++) {
    let idx = count <= 1 ? 0 : Math.round((i * (line.length - 1)) / (count - 1));
    while (used.has(idx)) idx = (idx + 1) % line.length;
    used.add(idx);
    out.push(line[idx]);
  }
  return out;
}

// Neutral baseline used at construction; overwritten by assignAttributes at
// match start. All 50s = zero effect once attributes are wired into combat,
// so a unit that somehow skips assignment behaves identically to the
// pre-attribute baseline. Pass H1: 14 attributes → 10 hidden sub-attributes.
const NEUTRAL_ATTRIBUTES: Attributes = {
  aim: 50, headshot: 50, reflexes: 50, weaponAffinity: 50,
  vision: 50, mapIQ: 50,
  tenacity: 50,
  composure: 50, adaptability: 50,
  comms: 50,
};

// Pointy-top facing index (canonical neighbor order): 0=E, 1=NE, 2=NW, 3=W,
// 4=SW, 5=SE. There's no due-N/S neighbor, so spawn-frame cones point toward
// the enemy half via a downward/upward diagonal. Movement overrides facing on
// the first step regardless.
const DEFENDER_FACING: Facing = 5; // SE — defenders (north) look downward toward attackers
const ATTACKER_FACING: Facing = 1; // NE — attackers (south) look upward toward defenders

// Pass E m5 — optional `loadoutOverride` lets Randomize Units mode pass in
// seeded random loadouts (still constrained to a per-team rifle minimum via
// pickRandomLoadout). Default = the Standard-mode LOADOUTS table.
export function createTeam(
  team: Team,
  spawns: readonly HexCoord[],
  loadoutOverride?: readonly Weapon[],
): Unit[] {
  const loadouts = loadoutOverride ?? (LOADOUTS[team] as readonly Weapon[]);
  const slotCount = loadouts.length;
  if (spawns.length < slotCount) {
    throw new Error(
      `Team ${team} needs ${slotCount} spawn cells; map provided ${spawns.length}`,
    );
  }
  const idPrefix = team === 'defenders' ? 'D' : 'A';
  const facing = team === 'defenders' ? DEFENDER_FACING : ATTACKER_FACING;
  // Round-1 build: defenders are on the north side (forward = +row), attackers
  // south (−row). placeSpawns fans them across the zone's leading edge.
  const positions = placeSpawns(spawns, slotCount, team === 'defenders' ? 1 : -1);
  return loadouts.map((weapon, i): Unit => ({
    id: `${idPrefix}${i + 1}`,
    team,
    weapon,
    pos: positions[i],
    hp: UNIT_DEFAULTS.maxHp,
    maxHp: UNIT_DEFAULTS.maxHp,
    facing,
    state: 'alive',
    // Attributes are assigned by assignAttributes() at match start; these are
    // placeholder defaults.
    // v0.29.0 — traits assigned by assignAttributes/rollUnitMeta at match start.
    tacticalTraits: [],
    personality: null,
    role: 'Specialist',
    preferredRole: 'Specialist',
    hero: 'Angelic',
    modifiers: { aggression: 50, baseAggression: 50, offPosition: false, retreatThresholdMod: 0 },
    attributes: { ...NEUTRAL_ATTRIBUTES },
    cardFlags: {},
    directives: [],
  }));
}
