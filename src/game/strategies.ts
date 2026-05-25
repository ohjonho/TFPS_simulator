// Pass 7 — strategy definitions (spec §14). 6 strategies (3 attacker + 3
// defender) × 2 maps = 12 entries. Each strategy is map-specific so it can
// reference regions that exist on that map (e.g. Foundry has b_squeeze,
// Atoll has b_dock/a_maze).
//
// Pass A strategy review — strategies are now defined as an ORDERED LIST OF
// SLOTS instead of a Role→region map. Each slot is a tactical position
// ('site_anchor', 'mid_info') with a loadout preference. At Begin Round,
// assignSlots() greedily picks the team's units into slots based on
// `preferWeapon`. This fixes the bug where teams with role repeats (e.g. two
// Vanguards) had multiple units collapse onto the same Role-keyed region.
//
// Each strategy defines per-slot directives. Variants exist for strategies
// that pick a site at round start (Rush A/B, Stack A/B, Execute A/B). The
// match flow picks one variant deterministically via the seeded RNG.

import type { HexCoord, MapDefinition, Side, Unit, Weapon } from './types.ts';
import { neighbors, passableAt } from './pathfind.ts';
import { STRATEGY_MODS } from './config.ts';
import type { DirectiveSpec } from './directives.ts';

// --- Slot-based strategy types --------------------------------------------

// Loadout/role preference used by assignSlots when picking which team unit
// fills this slot. Currently weapon-only; extensible to role/skill later.
export type SlotPick = {
  preferWeapon?: Weapon;
  // True = strongly prefer this weapon (only fall back to others if none
  // available). False/undefined = soft preference (use as tiebreaker).
  strict?: boolean;
};

// One named position in a strategy: region + directives + optional pathing /
// anchor tweaks. `id` is referenced by ally-aware directives (trade_for,
// rotate_on_team_contact) via `ally` / `watch` fields.
export type StrategySlot = {
  id: string;
  pick: SlotPick;
  region: string;
  anchorOffset?: number;
  usePerimeterPath?: boolean;
  directives: DirectiveSpec[];
};

// A variant is a complete slot list (one slot per actual unit on the team,
// typically 3 in v0). Strategies with multiple variants (Rush A/B) pick one
// per round via the seeded RNG.
export type StrategyVariant = StrategySlot[];

export type Strategy = {
  id: string;
  name: string;
  side: Side;
  description: string;
  variants: StrategyVariant[];
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
const rotateOnContact = (rotateTo: { region: string }, watchSlots: string[], delayTicks = 3): DirectiveSpec =>
  ({ kind: 'rotate_on_team_contact', rotateTo, watch: watchSlots, delayTicks, priority: 60 });
const tradeFor = (allySlot: string, windowTicks = 4): DirectiveSpec =>
  ({ kind: 'trade_for', ally: allySlot, windowTicks, priority: 40 });
const commitSite = (site: { region: string }, leaveOnContactInRegions: string[] = []): DirectiveSpec =>
  ({ kind: 'commit_site', site, leaveOnContactInRegions, priority: 70 });
const peek = (peekRef: { region: string }, cover?: { region: string } | typeof ownSpawn): DirectiveSpec =>
  ({ kind: 'peek_and_retreat', peek: peekRef, cover: cover ?? ownSpawn, cadenceTicks: 4, priority: 65 });

// --- Slot assignment -------------------------------------------------------

// Greedy loadout-aware mapping of slots → unit IDs. Walk slots in declaration
// order; each slot picks the best unassigned unit, preferring matching
// `preferWeapon`. Slots with `strict: true` only consider matching units and
// remain unfilled if none available. Unfilled slots are dropped (the unit
// they would have controlled isn't on the team / weapon mismatch).
//
// Units not picked by any slot get no directives + no target — they fall back
// to legacy "hold position" behavior. In v0 every strategy defines 3 slots
// for our 3-unit teams, so this only matters for degenerate cases.
export function assignSlots(
  slots: readonly StrategySlot[],
  teamUnits: readonly Unit[],
): Record<string, string> {
  const assignment: Record<string, string> = {};
  const taken = new Set<string>();
  // First pass: strict preferences (must match preferWeapon).
  for (const slot of slots) {
    if (!slot.pick.strict || !slot.pick.preferWeapon) continue;
    const match = teamUnits.find((u) => !taken.has(u.id) && u.weapon === slot.pick.preferWeapon);
    if (match) {
      assignment[slot.id] = match.id;
      taken.add(match.id);
    }
  }
  // Second pass: soft preferences (preferred weapon first, then any).
  for (const slot of slots) {
    if (slot.id in assignment) continue;
    let pick: Unit | undefined;
    if (slot.pick.preferWeapon) {
      pick = teamUnits.find((u) => !taken.has(u.id) && u.weapon === slot.pick.preferWeapon);
    }
    pick ??= teamUnits.find((u) => !taken.has(u.id));
    if (pick) {
      assignment[slot.id] = pick.id;
      taken.add(pick.id);
    }
  }
  return assignment;
}

// Slot-pick shorthands.
const sniperPref: SlotPick = { preferWeapon: 'sniper' };                  // sniper if available
const rifle: SlotPick = { preferWeapon: 'rifle' };                        // rifle preferred

// --- Foundry ---------------------------------------------------------------

// ATTACKER playbook (Foundry):
//   Execute: 2 rifles commit one site (entry + support); sniper anchors mid
//            for crossfire and info. Variants A / B.
//   Rush:    ALL up one main lane (perimeter routing). Sniper trails for
//            back-line cleanup. Variants A / B.
//   Control: rifles flank deep into A-main + B-main (perimeter); sniper
//            anchors mid for long-range info / picks.
const FOUNDRY_ATK: Strategy[] = [
  {
    id: 'Execute', name: 'Execute', side: 'attacker',
    description: 'Split push — 2 rifles commit one site (A or B); sniper anchors mid for crossfire & info.',
    variants: [
      // Variant A: commit the A side. Pass B — entry + support target the
      // plant zone (cols 22-26 on Foundry) so attackers stand on plant hexes
      // and can plant the spike. The site centroid is on the site EDGE
      // (col 20), too far from the plant zone for the plant trigger to fire.
      [
        { id: 'entry',       pick: rifle, region: 'a_plant',
          directives: [commitSite(reg('a_plant')), peek(reg('a_site'))] },
        { id: 'support',     pick: rifle, region: 'a_plant',
          directives: [commitSite(reg('a_plant')), tradeFor('entry', 4)] },
        { id: 'mid_anchor',  pick: sniperPref, region: 'mid', anchorOffset: 4,
          directives: [holdAngle(reg('a_connector')), safeSniper(reg('a_connector')),
                       tradeFor('entry', 4), rotateOnContact(reg('a_site'), ['entry'], 3)] },
      ],
      // Variant B: commit the B side.
      [
        { id: 'entry',       pick: rifle, region: 'b_plant',
          directives: [commitSite(reg('b_plant')), peek(reg('b_site'))] },
        { id: 'support',     pick: rifle, region: 'b_plant',
          directives: [commitSite(reg('b_plant')), tradeFor('entry', 4)] },
        { id: 'mid_anchor',  pick: sniperPref, region: 'mid', anchorOffset: 4,
          directives: [holdAngle(reg('b_squeeze')), safeSniper(reg('b_squeeze')),
                       tradeFor('entry', 4), rotateOnContact(reg('b_site'), ['entry'], 3)] },
      ],
    ],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Execute.aggression,
    retreatThresholdMod: STRATEGY_MODS.Execute.retreatThreshold,
  },
  {
    id: 'Rush', name: 'Rush', side: 'attacker',
    description: 'All-in on one site (A or B) up the main lane. Fast, no mid presence.',
    variants: [
      // Variant A: rush A site via A-main (perimeter forces the right edge).
      // Pass B — lead + support hit the plant zone for plant; cleanup sniper
      // stays one row back (anchorOffset 2) for cover-aware angle on the entry.
      [
        { id: 'lead',     pick: rifle,      region: 'a_plant', usePerimeterPath: true,
          directives: [commitSite(reg('a_plant')), peek(reg('a_site'))] },
        { id: 'support',  pick: rifle,      region: 'a_plant', usePerimeterPath: true,
          directives: [commitSite(reg('a_plant')), tradeFor('lead', 5)] },
        { id: 'cleanup',  pick: sniperPref, region: 'a_site', usePerimeterPath: true, anchorOffset: 2,
          directives: [commitSite(reg('a_site')), safeSniper(reg('a_site')), tradeFor('lead', 5)] },
      ],
      // Variant B: rush B site via B-main.
      [
        { id: 'lead',     pick: rifle,      region: 'b_plant', usePerimeterPath: true,
          directives: [commitSite(reg('b_plant')), peek(reg('b_site'))] },
        { id: 'support',  pick: rifle,      region: 'b_plant', usePerimeterPath: true,
          directives: [commitSite(reg('b_plant')), tradeFor('lead', 5)] },
        { id: 'cleanup',  pick: sniperPref, region: 'b_site', usePerimeterPath: true, anchorOffset: 2,
          directives: [commitSite(reg('b_site')), safeSniper(reg('b_site')), tradeFor('lead', 5)] },
      ],
    ],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Rush.aggression,
    retreatThresholdMod: STRATEGY_MODS.Rush.retreatThreshold,
  },
  {
    id: 'Control', name: 'Control', side: 'attacker',
    description: 'Slow info — rifles flank deep A-main + B-main; sniper anchors mid for long picks.',
    variants: [[
      { id: 'flank_a',    pick: rifle,      region: 'a_main', anchorOffset: 12, usePerimeterPath: true,
        directives: [holdAngle(reg('a_site')), rotateOnContact(reg('b_site'), ['flank_b'], 4),
                     rotateOnContact(reg('mid'), ['mid_sniper'], 4)] },
      { id: 'flank_b',    pick: rifle,      region: 'b_main', anchorOffset: 12, usePerimeterPath: true,
        directives: [holdAngle(reg('b_site')), rotateOnContact(reg('a_site'), ['flank_a'], 4),
                     rotateOnContact(reg('mid'), ['mid_sniper'], 4)] },
      { id: 'mid_sniper', pick: sniperPref, region: 'mid',    anchorOffset: 8,
        directives: [holdAngle(enemySpawn), safeSniper(enemySpawn), tradeFor('flank_a', 5)] },
    ]],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Control.aggression,
    retreatThresholdMod: STRATEGY_MODS.Control.retreatThreshold,
  },
];

// DEFENDER playbook (Foundry):
//   Hold:     1 sniper on a site holding the long lane, 1 rifle on the other
//             site, 1 rifle mid. Variants A/B for which site the sniper plays.
//   Stack:    2 on one site (sniper + rifle) + 1 mid for rotates. Variants A/B.
//   Pressure: rifle pushes mid; sniper holds one main lane deep; second rifle
//             contests other main. Variants A/B for sniper lane.
const FOUNDRY_DEF: Strategy[] = [
  {
    id: 'Hold', name: 'Hold', side: 'defender',
    description: '1 each on A site, B site, mid. Sniper denies plant on the chosen site; rifle anchor holds the other from site edge.',
    variants: [
      // Variant A: sniper plays A plant (denies plant directly); rifle holds
      // the OTHER site (B) from its edge so attackers can still plant B if
      // they out-route the sniper. Asymmetric per round — variant choice
      // matters strategically.
      [
        { id: 'a_sniper',  pick: sniperPref, region: 'a_plant',
          directives: [safeSniper(reg('a_main')), rotateOnContact(reg('b_plant'), ['b_anchor'], 4)] },
        { id: 'b_anchor',  pick: rifle,      region: 'b_site', anchorOffset: 1,
          directives: [holdAngle(reg('b_main')), rotateOnContact(reg('a_plant'), ['a_sniper'], 4)] },
        { id: 'mid',       pick: rifle,      region: 'mid',    anchorOffset: 6,
          directives: [holdAngle(enemySpawn), tradeFor('a_sniper', 4)] },
      ],
      // Variant B: sniper plays B plant; rifle holds A site edge.
      [
        { id: 'b_sniper',  pick: sniperPref, region: 'b_plant',
          directives: [safeSniper(reg('b_main')), rotateOnContact(reg('a_plant'), ['a_anchor'], 4)] },
        { id: 'a_anchor',  pick: rifle,      region: 'a_site', anchorOffset: 1,
          directives: [holdAngle(reg('a_main')), rotateOnContact(reg('b_plant'), ['b_sniper'], 4)] },
        { id: 'mid',       pick: rifle,      region: 'mid',    anchorOffset: 6,
          directives: [holdAngle(enemySpawn), tradeFor('b_sniper', 4)] },
      ],
    ],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Hold.aggression,
    retreatThresholdMod: STRATEGY_MODS.Hold.retreatThreshold,
  },
  {
    id: 'Stack', name: 'Stack', side: 'defender',
    description: 'Cluster sniper + rifle on one site (A or B); third holds mid for rotates.',
    variants: [
      [
        { id: 'a_sniper', pick: sniperPref, region: 'a_site', anchorOffset: 1,
          directives: [safeSniper(reg('a_main')), tradeFor('a_anchor', 5)] },
        { id: 'a_anchor', pick: rifle,      region: 'a_site', anchorOffset: 1,
          directives: [holdAngle(reg('a_main')), tradeFor('a_sniper', 5)] },
        { id: 'mid',      pick: rifle,      region: 'mid',    anchorOffset: 6,
          directives: [holdAngle(enemySpawn), rotateOnContact(reg('a_site'), ['a_anchor'], 3)] },
      ],
      [
        { id: 'b_sniper', pick: sniperPref, region: 'b_site', anchorOffset: 1,
          directives: [safeSniper(reg('b_main')), tradeFor('b_anchor', 5)] },
        { id: 'b_anchor', pick: rifle,      region: 'b_site', anchorOffset: 1,
          directives: [holdAngle(reg('b_main')), tradeFor('b_sniper', 5)] },
        { id: 'mid',      pick: rifle,      region: 'mid',    anchorOffset: 6,
          directives: [holdAngle(enemySpawn), rotateOnContact(reg('b_site'), ['b_anchor'], 3)] },
      ],
    ],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Stack.aggression,
    retreatThresholdMod: STRATEGY_MODS.Stack.retreatThreshold,
  },
  {
    id: 'Pressure', name: 'Pressure', side: 'defender',
    description: 'Push forward off spawn — rifle contests mid; sniper holds one main choke deep.',
    variants: [
      // Variant A: sniper plays A-main, rifle pushes mid, second rifle contests B-main shallow.
      [
        { id: 'mid_push',   pick: rifle,      region: 'mid',    anchorOffset: 2,
          directives: [peek(reg('mid')), holdAngle(enemySpawn), tradeFor('a_sniper_deep', 4)] },
        { id: 'a_sniper_deep', pick: sniperPref, region: 'a_main', anchorOffset: 18,
          directives: [safeSniper(reg('a_main')), rotateOnContact(reg('mid'), ['mid_push'], 3)] },
        { id: 'b_contest',  pick: rifle,      region: 'b_main', anchorOffset: 18,
          directives: [holdAngle(reg('b_main')), tradeFor('mid_push', 4)] },
      ],
      // Variant B: sniper plays B-main, rifle pushes mid, second rifle contests A-main shallow.
      [
        { id: 'mid_push',   pick: rifle,      region: 'mid',    anchorOffset: 2,
          directives: [peek(reg('mid')), holdAngle(enemySpawn), tradeFor('b_sniper_deep', 4)] },
        { id: 'b_sniper_deep', pick: sniperPref, region: 'b_main', anchorOffset: 18,
          directives: [safeSniper(reg('b_main')), rotateOnContact(reg('mid'), ['mid_push'], 3)] },
        { id: 'a_contest',  pick: rifle,      region: 'a_main', anchorOffset: 18,
          directives: [holdAngle(reg('a_main')), tradeFor('mid_push', 4)] },
      ],
    ],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Pressure.aggression,
    retreatThresholdMod: STRATEGY_MODS.Pressure.retreatThreshold,
  },
];

// --- Atoll -----------------------------------------------------------------

// Atoll mirrors Foundry's playbook (mid_courtyard instead of mid). Atoll's
// long B-main "dock" lane is preserved via the sniper-down-the-lane angle on
// the defender Hold/Stack variants. Atoll has wider mid spaces so flank
// routes pay off more on Control.
const ATOLL_ATK: Strategy[] = [
  {
    id: 'Execute', name: 'Execute', side: 'attacker',
    description: 'Split push — 2 rifles commit one site (A maze or B dock); sniper anchors courtyard.',
    variants: [
      [
        { id: 'entry',       pick: rifle, region: 'a_plant',
          directives: [commitSite(reg('a_plant')), peek(reg('a_site'))] },
        { id: 'support',     pick: rifle, region: 'a_plant',
          directives: [commitSite(reg('a_plant')), tradeFor('entry', 4)] },
        { id: 'mid_anchor',  pick: sniperPref, region: 'mid_courtyard', anchorOffset: 4,
          directives: [holdAngle(reg('a_site')), safeSniper(reg('a_site')),
                       tradeFor('entry', 4), rotateOnContact(reg('a_site'), ['entry'], 3)] },
      ],
      [
        { id: 'entry',       pick: rifle, region: 'b_plant',
          directives: [commitSite(reg('b_plant')), peek(reg('b_site'))] },
        { id: 'support',     pick: rifle, region: 'b_plant',
          directives: [commitSite(reg('b_plant')), tradeFor('entry', 4)] },
        { id: 'mid_anchor',  pick: sniperPref, region: 'mid_courtyard', anchorOffset: 4,
          directives: [holdAngle(reg('b_site')), safeSniper(reg('b_site')),
                       tradeFor('entry', 4), rotateOnContact(reg('b_site'), ['entry'], 3)] },
      ],
    ],
    fallbackRegion: 'mid_courtyard',
    aggressionMod: STRATEGY_MODS.Execute.aggression,
    retreatThresholdMod: STRATEGY_MODS.Execute.retreatThreshold,
  },
  {
    id: 'Rush', name: 'Rush', side: 'attacker',
    description: 'All-in on one site (A maze or B dock) up the main lane. No mid presence.',
    variants: [
      [
        { id: 'lead',     pick: rifle,      region: 'a_plant', usePerimeterPath: true,
          directives: [commitSite(reg('a_plant')), peek(reg('a_site'))] },
        { id: 'support',  pick: rifle,      region: 'a_plant', usePerimeterPath: true,
          directives: [commitSite(reg('a_plant')), tradeFor('lead', 5)] },
        { id: 'cleanup',  pick: sniperPref, region: 'a_site', usePerimeterPath: true, anchorOffset: 2,
          directives: [commitSite(reg('a_site')), safeSniper(reg('a_site')), tradeFor('lead', 5)] },
      ],
      [
        { id: 'lead',     pick: rifle,      region: 'b_plant', usePerimeterPath: true,
          directives: [commitSite(reg('b_plant')), peek(reg('b_site'))] },
        { id: 'support',  pick: rifle,      region: 'b_plant', usePerimeterPath: true,
          directives: [commitSite(reg('b_plant')), tradeFor('lead', 5)] },
        { id: 'cleanup',  pick: sniperPref, region: 'b_site', usePerimeterPath: true, anchorOffset: 2,
          directives: [commitSite(reg('b_site')), safeSniper(reg('b_site')), tradeFor('lead', 5)] },
      ],
    ],
    fallbackRegion: 'mid_courtyard',
    aggressionMod: STRATEGY_MODS.Rush.aggression,
    retreatThresholdMod: STRATEGY_MODS.Rush.retreatThreshold,
  },
  {
    id: 'Control', name: 'Control', side: 'attacker',
    description: 'Slow info — rifles flank deep A-main + B-main; sniper anchors courtyard.',
    variants: [[
      { id: 'flank_a',    pick: rifle,      region: 'a_main', anchorOffset: 12, usePerimeterPath: true,
        directives: [holdAngle(reg('a_site')), rotateOnContact(reg('b_site'), ['flank_b'], 4),
                     rotateOnContact(reg('mid_courtyard'), ['mid_sniper'], 4)] },
      { id: 'flank_b',    pick: rifle,      region: 'b_main', anchorOffset: 12, usePerimeterPath: true,
        directives: [holdAngle(reg('b_site')), rotateOnContact(reg('a_site'), ['flank_a'], 4),
                     rotateOnContact(reg('mid_courtyard'), ['mid_sniper'], 4)] },
      { id: 'mid_sniper', pick: sniperPref, region: 'mid_courtyard', anchorOffset: 8,
        directives: [holdAngle(enemySpawn), safeSniper(enemySpawn), tradeFor('flank_a', 5)] },
    ]],
    fallbackRegion: 'mid_courtyard',
    aggressionMod: STRATEGY_MODS.Control.aggression,
    retreatThresholdMod: STRATEGY_MODS.Control.retreatThreshold,
  },
];

const ATOLL_DEF: Strategy[] = [
  {
    id: 'Hold', name: 'Hold', side: 'defender',
    description: '1 each on A site, B site, courtyard. Sniper denies plant on chosen site; rifle anchor holds other site from edge.',
    variants: [
      [
        { id: 'a_sniper', pick: sniperPref, region: 'a_plant',
          directives: [safeSniper(reg('a_main')), rotateOnContact(reg('b_plant'), ['b_anchor'], 4)] },
        { id: 'b_anchor', pick: rifle,      region: 'b_site', anchorOffset: 1,
          directives: [holdAngle(reg('b_main')), rotateOnContact(reg('a_plant'), ['a_sniper'], 4)] },
        { id: 'mid',      pick: rifle,      region: 'mid_courtyard', anchorOffset: 6,
          directives: [holdAngle(enemySpawn), tradeFor('a_sniper', 4)] },
      ],
      [
        { id: 'b_sniper', pick: sniperPref, region: 'b_plant',
          directives: [safeSniper(reg('b_main')), rotateOnContact(reg('a_plant'), ['a_anchor'], 4)] },
        { id: 'a_anchor', pick: rifle,      region: 'a_site', anchorOffset: 1,
          directives: [holdAngle(reg('a_main')), rotateOnContact(reg('b_plant'), ['b_sniper'], 4)] },
        { id: 'mid',      pick: rifle,      region: 'mid_courtyard', anchorOffset: 6,
          directives: [holdAngle(enemySpawn), tradeFor('b_sniper', 4)] },
      ],
    ],
    fallbackRegion: 'mid_courtyard',
    aggressionMod: STRATEGY_MODS.Hold.aggression,
    retreatThresholdMod: STRATEGY_MODS.Hold.retreatThreshold,
  },
  {
    id: 'Stack', name: 'Stack', side: 'defender',
    description: 'Cluster sniper + rifle on one site (A or B); third holds courtyard for rotates.',
    variants: [
      [
        { id: 'a_sniper', pick: sniperPref, region: 'a_site', anchorOffset: 1,
          directives: [safeSniper(reg('a_main')), tradeFor('a_anchor', 5)] },
        { id: 'a_anchor', pick: rifle,      region: 'a_site', anchorOffset: 1,
          directives: [holdAngle(reg('a_main')), tradeFor('a_sniper', 5)] },
        { id: 'mid',      pick: rifle,      region: 'mid_courtyard', anchorOffset: 6,
          directives: [holdAngle(enemySpawn), rotateOnContact(reg('a_site'), ['a_anchor'], 3)] },
      ],
      [
        { id: 'b_sniper', pick: sniperPref, region: 'b_site', anchorOffset: 1,
          directives: [safeSniper(reg('b_main')), tradeFor('b_anchor', 5)] },
        { id: 'b_anchor', pick: rifle,      region: 'b_site', anchorOffset: 1,
          directives: [holdAngle(reg('b_main')), tradeFor('b_sniper', 5)] },
        { id: 'mid',      pick: rifle,      region: 'mid_courtyard', anchorOffset: 6,
          directives: [holdAngle(enemySpawn), rotateOnContact(reg('b_site'), ['b_anchor'], 3)] },
      ],
    ],
    fallbackRegion: 'mid_courtyard',
    aggressionMod: STRATEGY_MODS.Stack.aggression,
    retreatThresholdMod: STRATEGY_MODS.Stack.retreatThreshold,
  },
  {
    id: 'Pressure', name: 'Pressure', side: 'defender',
    description: 'Push forward off spawn — rifle contests courtyard; sniper holds one main deep.',
    variants: [
      [
        { id: 'mid_push',      pick: rifle,      region: 'mid_courtyard', anchorOffset: 2,
          directives: [peek(reg('mid_courtyard')), holdAngle(enemySpawn), tradeFor('a_sniper_deep', 4)] },
        { id: 'a_sniper_deep', pick: sniperPref, region: 'a_main', anchorOffset: 18,
          directives: [safeSniper(reg('a_main')), rotateOnContact(reg('mid_courtyard'), ['mid_push'], 3)] },
        { id: 'b_contest',     pick: rifle,      region: 'b_main', anchorOffset: 18,
          directives: [holdAngle(reg('b_main')), tradeFor('mid_push', 4)] },
      ],
      [
        { id: 'mid_push',      pick: rifle,      region: 'mid_courtyard', anchorOffset: 2,
          directives: [peek(reg('mid_courtyard')), holdAngle(enemySpawn), tradeFor('b_sniper_deep', 4)] },
        { id: 'b_sniper_deep', pick: sniperPref, region: 'b_main', anchorOffset: 18,
          directives: [safeSniper(reg('b_main')), rotateOnContact(reg('mid_courtyard'), ['mid_push'], 3)] },
        { id: 'a_contest',     pick: rifle,      region: 'a_main', anchorOffset: 18,
          directives: [holdAngle(reg('a_main')), tradeFor('mid_push', 4)] },
      ],
    ],
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

// Pass 9 — apply an "anchor" offset toward own spawn. Defenders' spawn is at
// the top (decreasing rows); attackers' at the bottom. Positive offset moves
// toward own spawn, negative pushes forward. Snaps to nearest passable hex.
export function applyAnchorOffset(
  hex: HexCoord,
  offset: number,
  side: Side,
  map: MapDefinition,
): HexCoord {
  if (offset === 0) return hex;
  const dir = side === 'defender' ? -1 : +1;
  const wantRow = clamp(hex.row + offset * dir, 0, map.height - 1);
  const want: HexCoord = { col: hex.col, row: wantRow };
  return nearestPassable(map, want) ?? hex;
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
