// Pass 7 — strategy definitions (spec §14). 6 strategies (3 attacker + 3
// defender) × 2 maps = 12 entries. Each strategy is map-specific so it can
// reference regions that exist on that map (e.g. Foundry has b_squeeze, Atoll
// has b_dock/a_maze).
//
// Each strategy defines per-role region assignments; multiple variants exist
// for strategies that pick a site at round start (Rush A/B, Stack A/B). The
// match flow picks one variant deterministically via the seeded RNG.

import type { HexCoord, MapDefinition, Role, Side, Unit } from './types.ts';
import { neighbors, passableAt } from './pathfind.ts';
import { STRATEGY_MODS } from './config.ts';
import type { DirectiveSpec } from './directives.ts';

export type RoleAssignment = Record<Role, string>;

// Pass 9: per-role plan = region + directive specs. Directive specs use
// symbolic HexRefs (region names / spawn refs) so strategy authoring is
// map-agnostic; resolveDirectiveSpec materializes concrete HexCoords at
// applyStrategies time.
export type RolePlan = {
  region: string;
  directives: DirectiveSpec[];
};

export type VariantPlan = Record<Role, RolePlan>;

export type Strategy = {
  id: string;
  name: string;
  side: Side;
  description: string;
  // One entry = one variant. Rush/Stack list multiple variants (e.g. A/B site).
  variants: VariantPlan[];
  fallbackRegion: string;
  aggressionMod: number;
  retreatThresholdMod: number;
};

// --- Directive-spec authoring helpers (terse) ----------------------------
// Tight literal builders so the strategy table stays readable.
const reg = (region: string) => ({ region } as const);
const enemySpawn = { spawn: 'enemy' } as const;
const ownSpawn = { spawn: 'own' } as const;

const holdAngle = (facing: { region: string } | typeof enemySpawn | typeof ownSpawn): DirectiveSpec =>
  ({ kind: 'hold_angle', facing, priority: 50 });
const safeSniper = (angle: { region: string } | typeof enemySpawn | typeof ownSpawn): DirectiveSpec =>
  ({ kind: 'safe_sniper', angle, priority: 55 });
const rotateOnContact = (rotateTo: { region: string }, watchRoles: Role[], delayTicks = 3): DirectiveSpec =>
  ({ kind: 'rotate_on_team_contact', rotateTo, watchRoles, delayTicks, priority: 60 });
const tradeFor = (allyRole: Role, windowTicks = 4): DirectiveSpec =>
  ({ kind: 'trade_for', allyRole, windowTicks, priority: 40 });
const commitSite = (site: { region: string }, leaveOnContactInRegions: string[] = []): DirectiveSpec =>
  ({ kind: 'commit_site', site, leaveOnContactInRegions, priority: 70 });
const peek = (peekRef: { region: string }, cover?: { region: string } | typeof ownSpawn): DirectiveSpec =>
  ({ kind: 'peek_and_retreat', peek: peekRef, cover: cover ?? ownSpawn, cadenceTicks: 4, priority: 65 });

// --- Foundry ---------------------------------------------------------------

// ATTACKER playbook (Foundry):
//   Execute: split-push — V opens A, W opens B, T+S hold mid, trade chains.
//   Rush:    full commit to one site, peek/trade chain led by Vanguard.
//   Control: hold lobby + mid angles, rotate on any teammate's contact.
const FOUNDRY_ATK: Strategy[] = [
  {
    id: 'Execute', name: 'Execute', side: 'attacker',
    description: 'Split push — Vanguard opens A, Warden opens B, mid trades.',
    variants: [{
      Vanguard:   { region: 'a_site', directives: [commitSite(reg('a_site'), ['mid','b_site']), peek(reg('a_site'))] },
      Tactician:  { region: 'mid',    directives: [holdAngle(enemySpawn), tradeFor('Vanguard'), rotateOnContact(reg('a_site'), ['Vanguard'], 2)] },
      Warden:     { region: 'b_site', directives: [commitSite(reg('b_site'), ['mid','a_site']), peek(reg('b_site'))] },
      Specialist: { region: 'mid',    directives: [holdAngle(enemySpawn), tradeFor('Warden')] },
    }],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Execute.aggression,
    retreatThresholdMod: STRATEGY_MODS.Execute.retreatThreshold,
  },
  {
    id: 'Rush', name: 'Rush', side: 'attacker',
    description: 'Commit all to one site (A or B). Faster, less retreat, immediate engagement.',
    variants: [
      {
        Vanguard:   { region: 'a_site', directives: [commitSite(reg('a_site')), peek(reg('a_site'))] },
        Tactician:  { region: 'a_site', directives: [commitSite(reg('a_site')), tradeFor('Vanguard', 5)] },
        Warden:     { region: 'a_site', directives: [commitSite(reg('a_site')), tradeFor('Vanguard', 5)] },
        Specialist: { region: 'a_site', directives: [commitSite(reg('a_site')), tradeFor('Tactician', 5)] },
      },
      {
        Vanguard:   { region: 'b_site', directives: [commitSite(reg('b_site')), peek(reg('b_site'))] },
        Tactician:  { region: 'b_site', directives: [commitSite(reg('b_site')), tradeFor('Vanguard', 5)] },
        Warden:     { region: 'b_site', directives: [commitSite(reg('b_site')), tradeFor('Vanguard', 5)] },
        Specialist: { region: 'b_site', directives: [commitSite(reg('b_site')), tradeFor('Tactician', 5)] },
      },
    ],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Rush.aggression,
    retreatThresholdMod: STRATEGY_MODS.Rush.retreatThreshold,
  },
  {
    id: 'Control', name: 'Control', side: 'attacker',
    description: 'Slower, info-first — hold lobbies & mid angles, rotate on contact.',
    variants: [{
      Vanguard:   { region: 'a_lobby', directives: [holdAngle(reg('a_site')), rotateOnContact(reg('b_site'), ['Warden'], 4)] },
      Tactician:  { region: 'mid',     directives: [holdAngle(enemySpawn), safeSniper(enemySpawn), tradeFor('Vanguard')] },
      Warden:     { region: 'b_lobby', directives: [holdAngle(reg('b_site')), rotateOnContact(reg('a_site'), ['Vanguard'], 4)] },
      Specialist: { region: 'mid',     directives: [holdAngle(enemySpawn), tradeFor('Tactician')] },
    }],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Control.aggression,
    retreatThresholdMod: STRATEGY_MODS.Control.retreatThreshold,
  },
];

// DEFENDER playbook (Foundry):
//   Hold:     1 per site + mid; sites rotate to each other on contact.
//   Stack:    two units cluster on one site with trade chain.
//   Pressure: push forward off spawn into mid + main lanes.
const FOUNDRY_DEF: Strategy[] = [
  {
    id: 'Hold', name: 'Hold', side: 'defender',
    description: 'Standard: 1 each on A site, B site, mid. Rotate on contact.',
    variants: [{
      Vanguard:   { region: 'a_site', directives: [safeSniper(enemySpawn), rotateOnContact(reg('b_site'), ['Warden'], 4)] },
      Tactician:  { region: 'mid',    directives: [holdAngle(enemySpawn), tradeFor('Vanguard')] },
      Warden:     { region: 'b_site', directives: [safeSniper(enemySpawn), rotateOnContact(reg('a_site'), ['Vanguard'], 4)] },
      Specialist: { region: 'mid',    directives: [holdAngle(enemySpawn), tradeFor('Tactician')] },
    }],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Hold.aggression,
    retreatThresholdMod: STRATEGY_MODS.Hold.retreatThreshold,
  },
  {
    id: 'Stack', name: 'Stack', side: 'defender',
    description: 'Cluster two on a chosen site; third roams mid.',
    variants: [
      {
        Vanguard:   { region: 'a_site', directives: [holdAngle(enemySpawn), tradeFor('Warden', 5)] },
        Tactician:  { region: 'a_site', directives: [safeSniper(enemySpawn), tradeFor('Vanguard', 5)] },
        Warden:     { region: 'a_site', directives: [holdAngle(enemySpawn), tradeFor('Vanguard', 5)] },
        Specialist: { region: 'mid',    directives: [holdAngle(enemySpawn), rotateOnContact(reg('a_site'), ['Vanguard'], 3)] },
      },
      {
        Vanguard:   { region: 'b_site', directives: [holdAngle(enemySpawn), tradeFor('Warden', 5)] },
        Tactician:  { region: 'b_site', directives: [safeSniper(enemySpawn), tradeFor('Vanguard', 5)] },
        Warden:     { region: 'b_site', directives: [holdAngle(enemySpawn), tradeFor('Vanguard', 5)] },
        Specialist: { region: 'mid',    directives: [holdAngle(enemySpawn), rotateOnContact(reg('b_site'), ['Vanguard'], 3)] },
      },
    ],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Stack.aggression,
    retreatThresholdMod: STRATEGY_MODS.Stack.retreatThreshold,
  },
  {
    id: 'Pressure', name: 'Pressure', side: 'defender',
    description: 'Push forward off spawn — contest mid and main lanes early.',
    variants: [{
      Vanguard:   { region: 'mid',    directives: [peek(reg('mid')), tradeFor('Tactician')] },
      Tactician:  { region: 'mid',    directives: [holdAngle(enemySpawn), tradeFor('Vanguard')] },
      Warden:     { region: 'a_main', directives: [safeSniper(enemySpawn), rotateOnContact(reg('mid'), ['Tactician'], 3)] },
      Specialist: { region: 'b_main', directives: [safeSniper(enemySpawn), rotateOnContact(reg('mid'), ['Tactician'], 3)] },
    }],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Pressure.aggression,
    retreatThresholdMod: STRATEGY_MODS.Pressure.retreatThreshold,
  },
];

// --- Atoll -----------------------------------------------------------------

// Atoll — same directive playbook as Foundry; regions renamed (mid_courtyard
// instead of mid; b_dock/a_maze available but we keep symmetry with sites).
const ATOLL_ATK: Strategy[] = [
  {
    id: 'Execute', name: 'Execute', side: 'attacker',
    description: 'Split push — Vanguard opens A maze, Warden opens B dock, mid trades.',
    variants: [{
      Vanguard:   { region: 'a_site', directives: [commitSite(reg('a_site'), ['mid_courtyard','b_site']), peek(reg('a_site'))] },
      Tactician:  { region: 'mid_courtyard', directives: [holdAngle(enemySpawn), tradeFor('Vanguard'), rotateOnContact(reg('a_site'), ['Vanguard'], 2)] },
      Warden:     { region: 'b_site', directives: [commitSite(reg('b_site'), ['mid_courtyard','a_site']), peek(reg('b_site'))] },
      Specialist: { region: 'mid_courtyard', directives: [holdAngle(enemySpawn), tradeFor('Warden')] },
    }],
    fallbackRegion: 'mid_courtyard',
    aggressionMod: STRATEGY_MODS.Execute.aggression,
    retreatThresholdMod: STRATEGY_MODS.Execute.retreatThreshold,
  },
  {
    id: 'Rush', name: 'Rush', side: 'attacker',
    description: 'Commit all to one site (A maze or B dock).',
    variants: [
      {
        Vanguard:   { region: 'a_site', directives: [commitSite(reg('a_site')), peek(reg('a_site'))] },
        Tactician:  { region: 'a_site', directives: [commitSite(reg('a_site')), tradeFor('Vanguard', 5)] },
        Warden:     { region: 'a_site', directives: [commitSite(reg('a_site')), tradeFor('Vanguard', 5)] },
        Specialist: { region: 'a_site', directives: [commitSite(reg('a_site')), tradeFor('Tactician', 5)] },
      },
      {
        Vanguard:   { region: 'b_site', directives: [commitSite(reg('b_site')), peek(reg('b_site'))] },
        Tactician:  { region: 'b_site', directives: [commitSite(reg('b_site')), tradeFor('Vanguard', 5)] },
        Warden:     { region: 'b_site', directives: [commitSite(reg('b_site')), tradeFor('Vanguard', 5)] },
        Specialist: { region: 'b_site', directives: [commitSite(reg('b_site')), tradeFor('Tactician', 5)] },
      },
    ],
    fallbackRegion: 'mid_courtyard',
    aggressionMod: STRATEGY_MODS.Rush.aggression,
    retreatThresholdMod: STRATEGY_MODS.Rush.retreatThreshold,
  },
  {
    id: 'Control', name: 'Control', side: 'attacker',
    description: 'Slower, info-first — hold lobbies and the long B_main lane.',
    variants: [{
      Vanguard:   { region: 'a_lobby', directives: [holdAngle(reg('a_site')), rotateOnContact(reg('b_site'), ['Warden'], 4)] },
      Tactician:  { region: 'mid_courtyard', directives: [holdAngle(enemySpawn), safeSniper(enemySpawn), tradeFor('Vanguard')] },
      Warden:     { region: 'b_lobby', directives: [holdAngle(reg('b_site')), rotateOnContact(reg('a_site'), ['Vanguard'], 4)] },
      Specialist: { region: 'mid_courtyard', directives: [holdAngle(enemySpawn), tradeFor('Tactician')] },
    }],
    fallbackRegion: 'mid_courtyard',
    aggressionMod: STRATEGY_MODS.Control.aggression,
    retreatThresholdMod: STRATEGY_MODS.Control.retreatThreshold,
  },
];

const ATOLL_DEF: Strategy[] = [
  {
    id: 'Hold', name: 'Hold', side: 'defender',
    description: 'Standard: 1 each on A site, B site, mid courtyard. Rotate on contact.',
    variants: [{
      Vanguard:   { region: 'a_site', directives: [safeSniper(enemySpawn), rotateOnContact(reg('b_site'), ['Warden'], 4)] },
      Tactician:  { region: 'mid_courtyard', directives: [holdAngle(enemySpawn), tradeFor('Vanguard')] },
      Warden:     { region: 'b_site', directives: [safeSniper(enemySpawn), rotateOnContact(reg('a_site'), ['Vanguard'], 4)] },
      Specialist: { region: 'mid_courtyard', directives: [holdAngle(enemySpawn), tradeFor('Tactician')] },
    }],
    fallbackRegion: 'mid_courtyard',
    aggressionMod: STRATEGY_MODS.Hold.aggression,
    retreatThresholdMod: STRATEGY_MODS.Hold.retreatThreshold,
  },
  {
    id: 'Stack', name: 'Stack', side: 'defender',
    description: 'Cluster two on a chosen site; third roams mid.',
    variants: [
      {
        Vanguard:   { region: 'a_site', directives: [holdAngle(enemySpawn), tradeFor('Warden', 5)] },
        Tactician:  { region: 'a_site', directives: [safeSniper(enemySpawn), tradeFor('Vanguard', 5)] },
        Warden:     { region: 'a_site', directives: [holdAngle(enemySpawn), tradeFor('Vanguard', 5)] },
        Specialist: { region: 'mid_courtyard', directives: [holdAngle(enemySpawn), rotateOnContact(reg('a_site'), ['Vanguard'], 3)] },
      },
      {
        Vanguard:   { region: 'b_site', directives: [holdAngle(enemySpawn), tradeFor('Warden', 5)] },
        Tactician:  { region: 'b_site', directives: [safeSniper(enemySpawn), tradeFor('Vanguard', 5)] },
        Warden:     { region: 'b_site', directives: [holdAngle(enemySpawn), tradeFor('Vanguard', 5)] },
        Specialist: { region: 'mid_courtyard', directives: [holdAngle(enemySpawn), rotateOnContact(reg('b_site'), ['Vanguard'], 3)] },
      },
    ],
    fallbackRegion: 'mid_courtyard',
    aggressionMod: STRATEGY_MODS.Stack.aggression,
    retreatThresholdMod: STRATEGY_MODS.Stack.retreatThreshold,
  },
  {
    id: 'Pressure', name: 'Pressure', side: 'defender',
    description: 'Push forward off spawn — contest mid courtyard and main lanes.',
    variants: [{
      Vanguard:   { region: 'mid_courtyard', directives: [peek(reg('mid_courtyard')), tradeFor('Tactician')] },
      Tactician:  { region: 'mid_courtyard', directives: [holdAngle(enemySpawn), tradeFor('Vanguard')] },
      Warden:     { region: 'a_main',        directives: [safeSniper(enemySpawn), rotateOnContact(reg('mid_courtyard'), ['Tactician'], 3)] },
      Specialist: { region: 'b_main',        directives: [safeSniper(enemySpawn), rotateOnContact(reg('mid_courtyard'), ['Tactician'], 3)] },
    }],
    fallbackRegion: 'mid_courtyard',
    aggressionMod: STRATEGY_MODS.Pressure.aggression,
    retreatThresholdMod: STRATEGY_MODS.Pressure.retreatThreshold,
  },
];

const BY_MAP: Record<MapDefinition['name'], Strategy[]> = {
  Foundry: [...FOUNDRY_ATK, ...FOUNDRY_DEF],
  Atoll:   [...ATOLL_ATK,   ...ATOLL_DEF],
};

export function strategiesFor(side: Side, map: MapDefinition): Strategy[] {
  return BY_MAP[map.name].filter((s) => s.side === side);
}

export function strategyById(id: string, side: Side, map: MapDefinition): Strategy | null {
  return BY_MAP[map.name].find((s) => s.side === side && s.id === id) ?? null;
}

// Middle passable hex of a region (deterministic). Falls back to the region's
// first passable hex; null if the region is missing/unpassable.
export function regionCentroid(map: MapDefinition, region: string): HexCoord | null {
  const hexes = map.regions[region];
  if (!hexes || hexes.length === 0) return null;
  const passable = hexes.filter((h) => passableAt(map, h));
  if (passable.length === 0) return null;
  return passable[Math.floor(passable.length / 2)];
}

// Pass 8 — weapon-aware position adjustment. Snipers hold safer positions
// behind the strategy centroid (better sightlines, longer to die); shotguns
// push forward (need short range); rifles take the centroid. Defenders' "back"
// is north (lower rows); attackers' "back" is south (higher rows). The shifted
// position is snapped to the nearest passable hex via a small BFS so it never
// returns a wall/cover hex.
export function weaponAdjustedTarget(
  centroid: HexCoord,
  unit: Unit,
  side: Side,
  map: MapDefinition,
): HexCoord {
  const rowShift =
    unit.weapon === 'sniper' ? -3 :
    unit.weapon === 'shotgun' ? +3 :
    0;
  if (rowShift === 0) return centroid;
  // Defender's back = decreasing rows; attacker's back = increasing rows.
  const dir = side === 'defender' ? +1 : -1;
  const wantRow = clamp(centroid.row + rowShift * dir, 0, map.height - 1);
  const wantHex: HexCoord = { col: centroid.col, row: wantRow };
  return nearestPassable(map, wantHex) ?? centroid;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// BFS outward from `start`; returns the first passable hex found (or the start
// itself if it's already passable). Caps the search at 32 hexes — at this scale
// the desired hex is almost always passable or within 1–2 steps.
function nearestPassable(map: MapDefinition, start: HexCoord): HexCoord | null {
  if (passableAt(map, start)) return start;
  const seen = new Set<string>([`${start.col},${start.row}`]);
  const queue: HexCoord[] = [start];
  let steps = 0;
  while (queue.length > 0 && steps < 32) {
    const cur = queue.shift()!;
    for (const nb of neighbors(cur)) {
      const k = `${nb.col},${nb.row}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (passableAt(map, nb)) return nb;
      queue.push(nb);
    }
    steps++;
  }
  return null;
}
