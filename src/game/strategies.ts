// Pass 7 — strategy definitions (spec §14). 6 strategies (3 attacker + 3
// defender) × 2 maps = 12 entries. Each strategy is map-specific so it can
// reference regions that exist on that map (e.g. Foundry has b_squeeze, Atoll
// has b_dock/a_maze).
//
// Each strategy defines per-role region assignments; multiple variants exist
// for strategies that pick a site at round start (Rush A/B, Stack A/B). The
// match flow picks one variant deterministically via the seeded RNG.

import type { HexCoord, MapDefinition, Role, Side } from './types.ts';
import { passableAt } from './pathfind.ts';
import { STRATEGY_MODS } from './config.ts';

export type RoleAssignment = Record<Role, string>;

export type Strategy = {
  id: string;
  name: string;
  side: Side;
  description: string;
  // One entry = one variant. Strategies with one entry have no random pick;
  // Rush/Stack list multiple variants (e.g. A-site / B-site).
  variants: RoleAssignment[];
  fallbackRegion: string;
  aggressionMod: number;
  retreatThresholdMod: number;
};

// --- Foundry ---------------------------------------------------------------

const FOUNDRY_ATK: Strategy[] = [
  {
    id: 'Execute', name: 'Execute', side: 'attacker',
    description: 'Split push — Vanguard takes A, Warden takes B, support holds mid.',
    variants: [{ Vanguard: 'a_site', Tactician: 'mid', Warden: 'b_site', Specialist: 'mid' }],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Execute.aggression,
    retreatThresholdMod: STRATEGY_MODS.Execute.retreatThreshold,
  },
  {
    id: 'Rush', name: 'Rush', side: 'attacker',
    description: 'Commit all to one site (A or B). Faster, less retreat, immediate engagement.',
    variants: [
      { Vanguard: 'a_site', Tactician: 'a_site', Warden: 'a_site', Specialist: 'a_site' },
      { Vanguard: 'b_site', Tactician: 'b_site', Warden: 'b_site', Specialist: 'b_site' },
    ],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Rush.aggression,
    retreatThresholdMod: STRATEGY_MODS.Rush.retreatThreshold,
  },
  {
    id: 'Control', name: 'Control', side: 'attacker',
    description: 'Slower, info-first — hold lobbies and mid before committing.',
    variants: [{ Vanguard: 'a_lobby', Tactician: 'mid', Warden: 'b_lobby', Specialist: 'mid' }],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Control.aggression,
    retreatThresholdMod: STRATEGY_MODS.Control.retreatThreshold,
  },
];

const FOUNDRY_DEF: Strategy[] = [
  {
    id: 'Hold', name: 'Hold', side: 'defender',
    description: 'Standard: 1 each on A site, B site, mid. React to threats.',
    variants: [{ Vanguard: 'a_site', Tactician: 'mid', Warden: 'b_site', Specialist: 'mid' }],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Hold.aggression,
    retreatThresholdMod: STRATEGY_MODS.Hold.retreatThreshold,
  },
  {
    id: 'Stack', name: 'Stack', side: 'defender',
    description: 'Cluster two on a chosen site; third roams mid.',
    variants: [
      { Vanguard: 'a_site', Tactician: 'a_site', Warden: 'a_site', Specialist: 'mid' },
      { Vanguard: 'b_site', Tactician: 'b_site', Warden: 'b_site', Specialist: 'mid' },
    ],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Stack.aggression,
    retreatThresholdMod: STRATEGY_MODS.Stack.retreatThreshold,
  },
  {
    id: 'Pressure', name: 'Pressure', side: 'defender',
    description: 'Push forward off spawn. Contest mid and forward positions.',
    variants: [{ Vanguard: 'mid', Tactician: 'mid', Warden: 'a_main', Specialist: 'b_main' }],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Pressure.aggression,
    retreatThresholdMod: STRATEGY_MODS.Pressure.retreatThreshold,
  },
];

// --- Atoll -----------------------------------------------------------------

const ATOLL_ATK: Strategy[] = [
  {
    id: 'Execute', name: 'Execute', side: 'attacker',
    description: 'Split push — Vanguard takes A maze, Warden takes B dock, support holds mid.',
    variants: [{ Vanguard: 'a_site', Tactician: 'mid_courtyard', Warden: 'b_site', Specialist: 'mid_courtyard' }],
    fallbackRegion: 'mid_courtyard',
    aggressionMod: STRATEGY_MODS.Execute.aggression,
    retreatThresholdMod: STRATEGY_MODS.Execute.retreatThreshold,
  },
  {
    id: 'Rush', name: 'Rush', side: 'attacker',
    description: 'Commit all to one site (A maze or B dock).',
    variants: [
      { Vanguard: 'a_site', Tactician: 'a_site', Warden: 'a_site', Specialist: 'a_site' },
      { Vanguard: 'b_site', Tactician: 'b_site', Warden: 'b_site', Specialist: 'b_site' },
    ],
    fallbackRegion: 'mid_courtyard',
    aggressionMod: STRATEGY_MODS.Rush.aggression,
    retreatThresholdMod: STRATEGY_MODS.Rush.retreatThreshold,
  },
  {
    id: 'Control', name: 'Control', side: 'attacker',
    description: 'Slower, info-first — hold lobbies and the long B_main lane.',
    variants: [{ Vanguard: 'a_lobby', Tactician: 'mid_courtyard', Warden: 'b_lobby', Specialist: 'mid_courtyard' }],
    fallbackRegion: 'mid_courtyard',
    aggressionMod: STRATEGY_MODS.Control.aggression,
    retreatThresholdMod: STRATEGY_MODS.Control.retreatThreshold,
  },
];

const ATOLL_DEF: Strategy[] = [
  {
    id: 'Hold', name: 'Hold', side: 'defender',
    description: 'Standard: 1 each on A site, B site, mid_courtyard.',
    variants: [{ Vanguard: 'a_site', Tactician: 'mid_courtyard', Warden: 'b_site', Specialist: 'mid_courtyard' }],
    fallbackRegion: 'mid_courtyard',
    aggressionMod: STRATEGY_MODS.Hold.aggression,
    retreatThresholdMod: STRATEGY_MODS.Hold.retreatThreshold,
  },
  {
    id: 'Stack', name: 'Stack', side: 'defender',
    description: 'Cluster two on a chosen site; third roams mid.',
    variants: [
      { Vanguard: 'a_site', Tactician: 'a_site', Warden: 'a_site', Specialist: 'mid_courtyard' },
      { Vanguard: 'b_site', Tactician: 'b_site', Warden: 'b_site', Specialist: 'mid_courtyard' },
    ],
    fallbackRegion: 'mid_courtyard',
    aggressionMod: STRATEGY_MODS.Stack.aggression,
    retreatThresholdMod: STRATEGY_MODS.Stack.retreatThreshold,
  },
  {
    id: 'Pressure', name: 'Pressure', side: 'defender',
    description: 'Push forward off spawn — contest mid_courtyard and main lanes.',
    variants: [{ Vanguard: 'mid_courtyard', Tactician: 'mid_courtyard', Warden: 'a_main', Specialist: 'b_main' }],
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
