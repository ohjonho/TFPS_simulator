// Strategy definitions (spec §7.2). 15 strategies total: 6 baseline
// (Hold / Stack / Pressure / Execute / Rush / Control) + 9 defender-side +
// 6 attacker-side trait-unlocked variants. Variants are gated by the
// `requiresUnlock: TraitId[]` field; `availableStrategies` in traits.ts
// filters the menu to the roster's actual unlocks.
//
// Strategy = an ORDERED LIST OF SLOTS (not a Role→region map). Each slot is
// a tactical position with a loadout preference; `assignSlots` greedily
// picks team units into slots by `preferWeapon`. Avoids the role-repeat
// bug where two Vanguards collapsed onto the same Role-keyed region.
//
// Each slot carries:
//   - region (centroid is the unit's primary target)
//   - directives (composable Directives the unit will follow this round)
//   - optional usePerimeterPath / anchorOffset tweaks
//
// Multi-site strategies (Rush A/B, Stack A/B, Execute A/B, Hold A/B) declare
// `variants[]`. The player picks the variant explicitly via the A/B
// sub-button; the AI picks via the seeded RNG.

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
// 5 at 5v5 — typically 4 rifle-pref + 1 sniper-pref to match LOADOUTS).
// Strategies with multiple variants (Rush A/B) pick one per round via the
// seeded RNG. Extra/short rosters degrade gracefully via assignSlots.
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
  // H3 — per-tick directive compliance threshold (0-100 scale). Higher =
  // more demanding adherence. Compliance roll in directives.ts is
  // `clamp(50 + 0.5×Discipline + 0.3×Composure − threshold/2 + situational, 5, 95)`.
  // Baseline strategies set ~50 (neutral); trait-unlocked variants set 60-80
  // (demanding) so a low-Discipline roster pays for picking them. Optional —
  // defaults to 50 (neutral) for baseline strategies if absent.
  complianceThreshold?: number;
  // H3 — true for trait-unlocked variants. Filtered out of the team's
  // strategy menu by availableStrategies() unless ≥1 alive unit on the
  // roster carries a trait whose `unlocks` list includes this strategy's id.
  // Baseline strategies (Hold/Stack/Pressure/Execute/Rush/Control) leave
  // this undefined (= always available).
  requiresUnlock?: boolean;
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
// to legacy "hold position" behavior. Every strategy defines 5 slots for our
// 5-unit teams, so this only matters for degenerate (draft-skewed) cases.
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
    description: 'Split push — 3 rifles commit one site (A or B) while a 4th holds the main lane; sniper anchors mid for crossfire & info.',
    variants: [
      // Variant A: commit the A side. Pass B — entry + support target the
      // plant zone (cols 22-26 on Foundry) so attackers stand on plant hexes
      // and can plant the spike. The site centroid is on the site EDGE
      // (col 20), too far from the plant zone for the plant trigger to fire.
      // 5v5: 3 rifles flood the plant, a 4th rifle holds a_main as a flank
      // watch + extra trade body, sniper anchors mid for crossfire.
      [
        { id: 'entry',       pick: rifle, region: 'a_plant',
          directives: [commitSite(reg('a_plant')), peek(reg('a_site'))] },
        { id: 'support',     pick: rifle, region: 'a_plant',
          directives: [commitSite(reg('a_plant')), tradeFor('entry', 4)] },
        { id: 'support2',    pick: rifle, region: 'a_plant',
          directives: [commitSite(reg('a_plant')), tradeFor('support', 4)] },
        { id: 'lane_watch',  pick: rifle, region: 'a_main', anchorOffset: 6, usePerimeterPath: true,
          directives: [holdAngle(reg('a_site')), tradeFor('entry', 4)] },
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
        { id: 'support2',    pick: rifle, region: 'b_plant',
          directives: [commitSite(reg('b_plant')), tradeFor('support', 4)] },
        { id: 'lane_watch',  pick: rifle, region: 'b_main', anchorOffset: 6, usePerimeterPath: true,
          directives: [holdAngle(reg('b_site')), tradeFor('entry', 4)] },
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
    description: 'All-in on one site (A or B) — four rifles flood the main lane, sniper trails for cleanup. Fast, no mid presence.',
    variants: [
      // Variant A: rush A site via A-main (perimeter forces the right edge).
      // Pass B — leads hit the plant zone for plant; cleanup sniper stays one
      // row back (anchorOffset 2) for cover-aware angle on the entry. 5v5:
      // four rifles flood, daisy-chained trades so a fallen lead is avenged.
      [
        { id: 'lead',     pick: rifle,      region: 'a_plant', usePerimeterPath: true,
          directives: [commitSite(reg('a_plant')), peek(reg('a_site'))] },
        { id: 'support',  pick: rifle,      region: 'a_plant', usePerimeterPath: true,
          directives: [commitSite(reg('a_plant')), tradeFor('lead', 5)] },
        { id: 'support2', pick: rifle,      region: 'a_plant', usePerimeterPath: true,
          directives: [commitSite(reg('a_plant')), tradeFor('support', 5)] },
        { id: 'support3', pick: rifle,      region: 'a_plant', usePerimeterPath: true,
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
        { id: 'support2', pick: rifle,      region: 'b_plant', usePerimeterPath: true,
          directives: [commitSite(reg('b_plant')), tradeFor('support', 5)] },
        { id: 'support3', pick: rifle,      region: 'b_plant', usePerimeterPath: true,
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
    description: 'Slow info — two rifles flank deep A-main, two deep B-main; sniper anchors mid for long picks.',
    variants: [[
      { id: 'flank_a',    pick: rifle,      region: 'a_main', anchorOffset: 12, usePerimeterPath: true,
        directives: [holdAngle(reg('a_site')), rotateOnContact(reg('b_site'), ['flank_b'], 4),
                     rotateOnContact(reg('mid'), ['mid_sniper'], 4)] },
      { id: 'flank_a2',   pick: rifle,      region: 'a_main', anchorOffset: 9, usePerimeterPath: true,
        directives: [holdAngle(reg('a_site')), tradeFor('flank_a', 4),
                     rotateOnContact(reg('mid'), ['mid_sniper'], 4)] },
      { id: 'flank_b',    pick: rifle,      region: 'b_main', anchorOffset: 12, usePerimeterPath: true,
        directives: [holdAngle(reg('b_site')), rotateOnContact(reg('a_site'), ['flank_a'], 4),
                     rotateOnContact(reg('mid'), ['mid_sniper'], 4)] },
      { id: 'flank_b2',   pick: rifle,      region: 'b_main', anchorOffset: 9, usePerimeterPath: true,
        directives: [holdAngle(reg('b_site')), tradeFor('flank_b', 4),
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
    description: 'Even split — two rifles anchor A, two anchor B, sniper holds back-mid covering both lanes. No site bias.',
    variants: [
      // Single variant — Hold "splits the team evenly" (per user direction).
      // Sniper sits at the back of mid where they can swing toward either
      // main lane on contact; two rifles anchor each site (a near + a deep
      // angle) so a single peek can't clear the post.
      [
        { id: 'a_anchor', pick: rifle,      region: 'a_site', anchorOffset: 1,
          directives: [holdAngle(reg('a_main')), rotateOnContact(reg('b_site'), ['b_anchor'], 4)] },
        { id: 'a_deep',   pick: rifle,      region: 'a_site', anchorOffset: 3,
          directives: [holdAngle(reg('a_main')), tradeFor('a_anchor', 4)] },
        { id: 'b_anchor', pick: rifle,      region: 'b_site', anchorOffset: 1,
          directives: [holdAngle(reg('b_main')), rotateOnContact(reg('a_site'), ['a_anchor'], 4)] },
        { id: 'b_deep',   pick: rifle,      region: 'b_site', anchorOffset: 3,
          directives: [holdAngle(reg('b_main')), tradeFor('b_anchor', 4)] },
        { id: 'mid',      pick: sniperPref, region: 'mid',    anchorOffset: 6,
          directives: [safeSniper(enemySpawn), rotateOnContact(reg('a_site'), ['a_anchor'], 3)] },
      ],
    ],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Hold.aggression,
    retreatThresholdMod: STRATEGY_MODS.Hold.retreatThreshold,
  },
  {
    id: 'Stack', name: 'Stack', side: 'defender',
    description: 'Cluster on one site (A or B) — sniper + two rifles stack for crossfire; one holds mid, one watches the off-site for rotates.',
    variants: [
      [
        { id: 'a_sniper', pick: sniperPref, region: 'a_site', anchorOffset: 1,
          directives: [safeSniper(reg('a_main')), tradeFor('a_anchor', 5)] },
        { id: 'a_anchor', pick: rifle,      region: 'a_site', anchorOffset: 1,
          directives: [holdAngle(reg('a_main')), tradeFor('a_sniper', 5)] },
        { id: 'a_support', pick: rifle,     region: 'a_site', anchorOffset: 2,
          directives: [holdAngle(reg('a_main')), tradeFor('a_anchor', 5)] },
        { id: 'mid',      pick: rifle,      region: 'mid',    anchorOffset: 6,
          directives: [holdAngle(enemySpawn), rotateOnContact(reg('a_site'), ['a_anchor'], 3)] },
        { id: 'offsite',  pick: rifle,      region: 'b_site', anchorOffset: 2,
          directives: [holdAngle(reg('b_main')), rotateOnContact(reg('a_site'), ['a_anchor'], 4)] },
      ],
      [
        { id: 'b_sniper', pick: sniperPref, region: 'b_site', anchorOffset: 1,
          directives: [safeSniper(reg('b_main')), tradeFor('b_anchor', 5)] },
        { id: 'b_anchor', pick: rifle,      region: 'b_site', anchorOffset: 1,
          directives: [holdAngle(reg('b_main')), tradeFor('b_sniper', 5)] },
        { id: 'b_support', pick: rifle,     region: 'b_site', anchorOffset: 2,
          directives: [holdAngle(reg('b_main')), tradeFor('b_anchor', 5)] },
        { id: 'mid',      pick: rifle,      region: 'mid',    anchorOffset: 6,
          directives: [holdAngle(enemySpawn), rotateOnContact(reg('b_site'), ['b_anchor'], 3)] },
        { id: 'offsite',  pick: rifle,      region: 'a_site', anchorOffset: 2,
          directives: [holdAngle(reg('a_main')), rotateOnContact(reg('b_site'), ['b_anchor'], 4)] },
      ],
    ],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Stack.aggression,
    retreatThresholdMod: STRATEGY_MODS.Stack.retreatThreshold,
  },
  {
    id: 'Pressure', name: 'Pressure', side: 'defender',
    description: 'Push mid off spawn — four rifles contest the mid corridor; sniper holds the long mid lane from behind.',
    variants: [
      // Single variant — "pushes mid" (per user direction). Four rifles
      // forward in mid in two trade pairs; sniper anchors back-mid for the
      // long sightline.
      [
        { id: 'mid_push',  pick: rifle,      region: 'mid', anchorOffset: 2,
          directives: [peek(reg('mid')), holdAngle(enemySpawn), tradeFor('mid_support', 4)] },
        { id: 'mid_push2', pick: rifle,      region: 'mid', anchorOffset: 2,
          directives: [peek(reg('mid')), holdAngle(enemySpawn), tradeFor('mid_support2', 4)] },
        { id: 'mid_support', pick: rifle,    region: 'mid', anchorOffset: 4,
          directives: [holdAngle(enemySpawn), tradeFor('mid_push', 4)] },
        { id: 'mid_support2', pick: rifle,   region: 'mid', anchorOffset: 5,
          directives: [holdAngle(enemySpawn), tradeFor('mid_push2', 4)] },
        { id: 'mid_sniper', pick: sniperPref, region: 'mid', anchorOffset: 8,
          directives: [safeSniper(enemySpawn), rotateOnContact(reg('mid'), ['mid_push'], 3)] },
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
    description: 'Split push — 3 rifles commit one site (A maze or B dock) while a 4th holds the main lane; sniper anchors courtyard.',
    variants: [
      [
        { id: 'entry',       pick: rifle, region: 'a_plant',
          directives: [commitSite(reg('a_plant')), peek(reg('a_site'))] },
        { id: 'support',     pick: rifle, region: 'a_plant',
          directives: [commitSite(reg('a_plant')), tradeFor('entry', 4)] },
        { id: 'support2',    pick: rifle, region: 'a_plant',
          directives: [commitSite(reg('a_plant')), tradeFor('support', 4)] },
        { id: 'lane_watch',  pick: rifle, region: 'a_main', anchorOffset: 6, usePerimeterPath: true,
          directives: [holdAngle(reg('a_site')), tradeFor('entry', 4)] },
        { id: 'mid_anchor',  pick: sniperPref, region: 'mid_courtyard', anchorOffset: 4,
          directives: [holdAngle(reg('a_site')), safeSniper(reg('a_site')),
                       tradeFor('entry', 4), rotateOnContact(reg('a_site'), ['entry'], 3)] },
      ],
      [
        { id: 'entry',       pick: rifle, region: 'b_plant',
          directives: [commitSite(reg('b_plant')), peek(reg('b_site'))] },
        { id: 'support',     pick: rifle, region: 'b_plant',
          directives: [commitSite(reg('b_plant')), tradeFor('entry', 4)] },
        { id: 'support2',    pick: rifle, region: 'b_plant',
          directives: [commitSite(reg('b_plant')), tradeFor('support', 4)] },
        { id: 'lane_watch',  pick: rifle, region: 'b_main', anchorOffset: 6, usePerimeterPath: true,
          directives: [holdAngle(reg('b_site')), tradeFor('entry', 4)] },
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
    description: 'All-in on one site (A maze or B dock) — four rifles flood the main lane, sniper trails. No mid presence.',
    variants: [
      [
        { id: 'lead',     pick: rifle,      region: 'a_plant', usePerimeterPath: true,
          directives: [commitSite(reg('a_plant')), peek(reg('a_site'))] },
        { id: 'support',  pick: rifle,      region: 'a_plant', usePerimeterPath: true,
          directives: [commitSite(reg('a_plant')), tradeFor('lead', 5)] },
        { id: 'support2', pick: rifle,      region: 'a_plant', usePerimeterPath: true,
          directives: [commitSite(reg('a_plant')), tradeFor('support', 5)] },
        { id: 'support3', pick: rifle,      region: 'a_plant', usePerimeterPath: true,
          directives: [commitSite(reg('a_plant')), tradeFor('lead', 5)] },
        { id: 'cleanup',  pick: sniperPref, region: 'a_site', usePerimeterPath: true, anchorOffset: 2,
          directives: [commitSite(reg('a_site')), safeSniper(reg('a_site')), tradeFor('lead', 5)] },
      ],
      [
        { id: 'lead',     pick: rifle,      region: 'b_plant', usePerimeterPath: true,
          directives: [commitSite(reg('b_plant')), peek(reg('b_site'))] },
        { id: 'support',  pick: rifle,      region: 'b_plant', usePerimeterPath: true,
          directives: [commitSite(reg('b_plant')), tradeFor('lead', 5)] },
        { id: 'support2', pick: rifle,      region: 'b_plant', usePerimeterPath: true,
          directives: [commitSite(reg('b_plant')), tradeFor('support', 5)] },
        { id: 'support3', pick: rifle,      region: 'b_plant', usePerimeterPath: true,
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
    description: 'Slow info — two rifles flank deep A-main, two deep B-main; sniper anchors courtyard.',
    variants: [[
      { id: 'flank_a',    pick: rifle,      region: 'a_main', anchorOffset: 12, usePerimeterPath: true,
        directives: [holdAngle(reg('a_site')), rotateOnContact(reg('b_site'), ['flank_b'], 4),
                     rotateOnContact(reg('mid_courtyard'), ['mid_sniper'], 4)] },
      { id: 'flank_a2',   pick: rifle,      region: 'a_main', anchorOffset: 9, usePerimeterPath: true,
        directives: [holdAngle(reg('a_site')), tradeFor('flank_a', 4),
                     rotateOnContact(reg('mid_courtyard'), ['mid_sniper'], 4)] },
      { id: 'flank_b',    pick: rifle,      region: 'b_main', anchorOffset: 12, usePerimeterPath: true,
        directives: [holdAngle(reg('b_site')), rotateOnContact(reg('a_site'), ['flank_a'], 4),
                     rotateOnContact(reg('mid_courtyard'), ['mid_sniper'], 4)] },
      { id: 'flank_b2',   pick: rifle,      region: 'b_main', anchorOffset: 9, usePerimeterPath: true,
        directives: [holdAngle(reg('b_site')), tradeFor('flank_b', 4),
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
    description: 'Even split — two rifles anchor A, two anchor B, sniper holds back-courtyard. No site bias.',
    variants: [
      // Single variant — "splits the team evenly" (per user direction).
      [
        { id: 'a_anchor', pick: rifle,      region: 'a_site', anchorOffset: 1,
          directives: [holdAngle(reg('a_main')), rotateOnContact(reg('b_site'), ['b_anchor'], 4)] },
        { id: 'a_deep',   pick: rifle,      region: 'a_site', anchorOffset: 3,
          directives: [holdAngle(reg('a_main')), tradeFor('a_anchor', 4)] },
        { id: 'b_anchor', pick: rifle,      region: 'b_site', anchorOffset: 1,
          directives: [holdAngle(reg('b_main')), rotateOnContact(reg('a_site'), ['a_anchor'], 4)] },
        { id: 'b_deep',   pick: rifle,      region: 'b_site', anchorOffset: 3,
          directives: [holdAngle(reg('b_main')), tradeFor('b_anchor', 4)] },
        { id: 'mid',      pick: sniperPref, region: 'mid_courtyard', anchorOffset: 6,
          directives: [safeSniper(enemySpawn), rotateOnContact(reg('a_site'), ['a_anchor'], 3)] },
      ],
    ],
    fallbackRegion: 'mid_courtyard',
    aggressionMod: STRATEGY_MODS.Hold.aggression,
    retreatThresholdMod: STRATEGY_MODS.Hold.retreatThreshold,
  },
  {
    id: 'Stack', name: 'Stack', side: 'defender',
    description: 'Cluster on one site (A or B) — sniper + two rifles stack for crossfire; one holds courtyard, one watches the off-site.',
    variants: [
      [
        { id: 'a_sniper', pick: sniperPref, region: 'a_site', anchorOffset: 1,
          directives: [safeSniper(reg('a_main')), tradeFor('a_anchor', 5)] },
        { id: 'a_anchor', pick: rifle,      region: 'a_site', anchorOffset: 1,
          directives: [holdAngle(reg('a_main')), tradeFor('a_sniper', 5)] },
        { id: 'a_support', pick: rifle,     region: 'a_site', anchorOffset: 2,
          directives: [holdAngle(reg('a_main')), tradeFor('a_anchor', 5)] },
        { id: 'mid',      pick: rifle,      region: 'mid_courtyard', anchorOffset: 6,
          directives: [holdAngle(enemySpawn), rotateOnContact(reg('a_site'), ['a_anchor'], 3)] },
        { id: 'offsite',  pick: rifle,      region: 'b_site', anchorOffset: 2,
          directives: [holdAngle(reg('b_main')), rotateOnContact(reg('a_site'), ['a_anchor'], 4)] },
      ],
      [
        { id: 'b_sniper', pick: sniperPref, region: 'b_site', anchorOffset: 1,
          directives: [safeSniper(reg('b_main')), tradeFor('b_anchor', 5)] },
        { id: 'b_anchor', pick: rifle,      region: 'b_site', anchorOffset: 1,
          directives: [holdAngle(reg('b_main')), tradeFor('b_sniper', 5)] },
        { id: 'b_support', pick: rifle,     region: 'b_site', anchorOffset: 2,
          directives: [holdAngle(reg('b_main')), tradeFor('b_anchor', 5)] },
        { id: 'mid',      pick: rifle,      region: 'mid_courtyard', anchorOffset: 6,
          directives: [holdAngle(enemySpawn), rotateOnContact(reg('b_site'), ['b_anchor'], 3)] },
        { id: 'offsite',  pick: rifle,      region: 'a_site', anchorOffset: 2,
          directives: [holdAngle(reg('a_main')), rotateOnContact(reg('b_site'), ['b_anchor'], 4)] },
      ],
    ],
    fallbackRegion: 'mid_courtyard',
    aggressionMod: STRATEGY_MODS.Stack.aggression,
    retreatThresholdMod: STRATEGY_MODS.Stack.retreatThreshold,
  },
  {
    id: 'Pressure', name: 'Pressure', side: 'defender',
    description: 'Push courtyard off spawn — four rifles contest mid; sniper holds back-mid long lane.',
    variants: [
      // Single variant — "pushes mid" (per user direction).
      [
        { id: 'mid_push',    pick: rifle,      region: 'mid_courtyard', anchorOffset: 2,
          directives: [peek(reg('mid_courtyard')), holdAngle(enemySpawn), tradeFor('mid_support', 4)] },
        { id: 'mid_push2',   pick: rifle,      region: 'mid_courtyard', anchorOffset: 2,
          directives: [peek(reg('mid_courtyard')), holdAngle(enemySpawn), tradeFor('mid_support2', 4)] },
        { id: 'mid_support', pick: rifle,      region: 'mid_courtyard', anchorOffset: 4,
          directives: [holdAngle(enemySpawn), tradeFor('mid_push', 4)] },
        { id: 'mid_support2', pick: rifle,     region: 'mid_courtyard', anchorOffset: 5,
          directives: [holdAngle(enemySpawn), tradeFor('mid_push2', 4)] },
        { id: 'mid_sniper',  pick: sniperPref, region: 'mid_courtyard', anchorOffset: 8,
          directives: [safeSniper(enemySpawn), rotateOnContact(reg('mid_courtyard'), ['mid_push'], 3)] },
      ],
    ],
    fallbackRegion: 'mid_courtyard',
    aggressionMod: STRATEGY_MODS.Pressure.aggression,
    retreatThresholdMod: STRATEGY_MODS.Pressure.retreatThreshold,
  },
];

// --- H3 trait-unlocked strategies -----------------------------------------
//
// 15 new strategies authored once as map-agnostic templates. Both maps share
// the regions these reference (a_site / b_site / a_plant / b_plant / a_main /
// b_main / mid / def_spawn / atk_spawn), so a single buildUnlocks() call
// returns the full list per map.
//
// Each strategy is themed for a specific trait's `unlocks`:
//   - Defender (9): Anchor_Hold / Crossfire_Lockdown / Last_Stand_Defense /
//     Mind_Games / Hold_Composure / Coordinated_Lockdown / Rotate_Stack /
//     Wide_Watch / Slow_Burn
//   - Attacker (7): Mobile_Push / Patient_Flank / Coordinated_Execute /
//     Solo_Frag / Scatter_Push / Aggressive_Peek / Mind_Games
//
// Mind_Games appears on both sides (Big Brain unlocks both); strategiesFor
// dispatches by side so the id collision is fine.
//
// All 15 inherit `complianceThreshold` from STRATEGY_MODS — H3.2 wires
// these into the per-tick directive adherence roll. Numbers tuned for
// "high ceiling / low floor": demanding strategies (Anchor_Hold,
// Patient_Flank, Coordinated_Execute, Slow_Burn) sit at 75-80, requiring a
// disciplined roster to execute reliably; loose ones (Solo_Frag,
// Scatter_Push) sit at 30-40, accepting freelancing as the point.

// All 15 unlock strategies share `requiresUnlock: true` so availableStrategies
// can filter them out for rosters that don't carry the unlocking trait. Spread
// from `mod(id)` so the unlock flag is consistent + can't be forgotten.
function mod(id: string): {
  aggressionMod: number;
  retreatThresholdMod: number;
  complianceThreshold: number;
  requiresUnlock: true;
} {
  const m = STRATEGY_MODS[id];
  return {
    aggressionMod: m?.aggression ?? 0,
    retreatThresholdMod: m?.retreatThreshold ?? 0,
    complianceThreshold: m?.complianceThreshold ?? 50,
    requiresUnlock: true,
  };
}

function buildUnlocks(_mapName: MapDefinition['name']): { atk: Strategy[]; def: Strategy[] } {
  // Both maps use `mid` as the central region; a_site/b_site/a_plant/b_plant
  // exist with the same names. Map-specific tighter regions
  // (Foundry: a_connector/b_squeeze/mid_pillar; Atoll: a_maze/b_dock/mid_courtyard)
  // aren't referenced here — keeps the unlock authoring single-source.
  return {
    def: [
      // Sentinel — locked positions, no rotation. The "fortress hold".
      {
        id: 'Anchor_Hold', name: 'Anchor Hold', side: 'defender',
        description: 'Sentinel-themed lockdown — five defenders hard-anchor fixed angles (two per site + sniper mid). No rotations; trades agility for max-stationary HR.',
        variants: [[
          { id: 'a_anchor',  pick: rifle,      region: 'a_site', anchorOffset: 2,
            directives: [holdAngle(reg('a_main'))] },
          { id: 'a_anchor2', pick: rifle,      region: 'a_site', anchorOffset: 1,
            directives: [holdAngle(reg('a_main'))] },
          { id: 'b_anchor',  pick: rifle,      region: 'b_site', anchorOffset: 2,
            directives: [holdAngle(reg('b_main'))] },
          { id: 'b_anchor2', pick: rifle,      region: 'b_site', anchorOffset: 1,
            directives: [holdAngle(reg('b_main'))] },
          { id: 'mid_lock',  pick: sniperPref, region: 'mid',    anchorOffset: 8,
            directives: [safeSniper(enemySpawn)] },
        ]],
        fallbackRegion: 'mid',
        ...mod('Anchor_Hold'),
      },
      // Trader — stacked crossfire on one site; both rifles trade for each other.
      {
        id: 'Crossfire_Lockdown', name: 'Crossfire Lockdown', side: 'defender',
        description: 'Trader-themed cluster — three rifles stack one site for crossfire trades; sniper holds back-mid + a rifle watches the other site.',
        variants: [
          [
            { id: 'a_lead',    pick: rifle,      region: 'a_site', anchorOffset: 1,
              directives: [holdAngle(reg('a_main')), tradeFor('a_support', 5)] },
            { id: 'a_support', pick: rifle,      region: 'a_site', anchorOffset: 2,
              directives: [holdAngle(reg('a_main')), tradeFor('a_lead', 5)] },
            { id: 'a_third',   pick: rifle,      region: 'a_site', anchorOffset: 1,
              directives: [holdAngle(reg('a_main')), tradeFor('a_support', 5)] },
            { id: 'b_watch',   pick: rifle,      region: 'b_site', anchorOffset: 2,
              directives: [holdAngle(reg('b_main')), rotateOnContact(reg('a_site'), ['a_lead'], 4)] },
            { id: 'mid_back',  pick: sniperPref, region: 'mid',    anchorOffset: 6,
              directives: [safeSniper(reg('b_main')), rotateOnContact(reg('b_site'), ['a_lead'], 3)] },
          ],
          [
            { id: 'b_lead',    pick: rifle,      region: 'b_site', anchorOffset: 1,
              directives: [holdAngle(reg('b_main')), tradeFor('b_support', 5)] },
            { id: 'b_support', pick: rifle,      region: 'b_site', anchorOffset: 2,
              directives: [holdAngle(reg('b_main')), tradeFor('b_lead', 5)] },
            { id: 'b_third',   pick: rifle,      region: 'b_site', anchorOffset: 1,
              directives: [holdAngle(reg('b_main')), tradeFor('b_support', 5)] },
            { id: 'a_watch',   pick: rifle,      region: 'a_site', anchorOffset: 2,
              directives: [holdAngle(reg('a_main')), rotateOnContact(reg('b_site'), ['b_lead'], 4)] },
            { id: 'mid_back',  pick: sniperPref, region: 'mid',    anchorOffset: 6,
              directives: [safeSniper(reg('a_main')), rotateOnContact(reg('a_site'), ['b_lead'], 3)] },
          ],
        ],
        fallbackRegion: 'mid',
        ...mod('Crossfire_Lockdown'),
      },
      // Clutch — fall back, conserve numbers, win 1v3s.
      {
        id: 'Last_Stand_Defense', name: 'Last Stand Defense', side: 'defender',
        description: 'Clutch-themed retreat-and-survive — defenders hold deep positions (two per site), trading site control for HP retention and Clutch late-game odds.',
        variants: [[
          { id: 'deep_a',  pick: rifle,      region: 'a_site', anchorOffset: 4,
            directives: [holdAngle(reg('a_main')), tradeFor('deep_mid', 4)] },
          { id: 'deep_a2', pick: rifle,      region: 'a_site', anchorOffset: 5,
            directives: [holdAngle(reg('a_main')), tradeFor('deep_a', 4)] },
          { id: 'deep_b',  pick: rifle,      region: 'b_site', anchorOffset: 4,
            directives: [holdAngle(reg('b_main')), tradeFor('deep_mid', 4)] },
          { id: 'deep_b2', pick: rifle,      region: 'b_site', anchorOffset: 5,
            directives: [holdAngle(reg('b_main')), tradeFor('deep_b', 4)] },
          { id: 'deep_mid', pick: sniperPref, region: 'mid',  anchorOffset: 10,
            directives: [safeSniper(enemySpawn)] },
        ]],
        fallbackRegion: 'mid',
        ...mod('Last_Stand_Defense'),
      },
      // Big Brain — fake one site, swing the other. Defender Mind_Games.
      {
        id: 'Mind_Games', name: 'Mind Games (D)', side: 'defender',
        description: 'Big Brain-themed fake — two defenders show A early then rotate to B where two more hold. Requires high Discipline to execute the swing cleanly.',
        variants: [
          [
            { id: 'fake',  pick: rifle,      region: 'a_site', anchorOffset: 1,
              directives: [peek(reg('a_main')), rotateOnContact(reg('b_site'), ['fake'], 5)] },
            { id: 'fake2', pick: rifle,      region: 'a_site', anchorOffset: 2,
              directives: [peek(reg('a_main')), rotateOnContact(reg('b_site'), ['fake'], 5)] },
            { id: 'real',  pick: rifle,      region: 'b_site', anchorOffset: 3,
              directives: [holdAngle(reg('b_main'))] },
            { id: 'real2', pick: rifle,      region: 'b_site', anchorOffset: 2,
              directives: [holdAngle(reg('b_main')), tradeFor('real', 4)] },
            { id: 'mid',   pick: sniperPref, region: 'mid',    anchorOffset: 4,
              directives: [safeSniper(enemySpawn), rotateOnContact(reg('b_site'), ['fake'], 3)] },
          ],
        ],
        fallbackRegion: 'mid',
        ...mod('Mind_Games'),
      },
      // Composed — slow steady spread; rewards Composure attribute.
      {
        id: 'Hold_Composure', name: 'Composed Hold', side: 'defender',
        description: 'Composed-themed steady hold — defenders spread to standard angles (two per site) with conservative ranges. Composure keeps HR retention high under pressure.',
        variants: [[
          { id: 'a_anchor',  pick: rifle,      region: 'a_site', anchorOffset: 2,
            directives: [holdAngle(reg('a_main'))] },
          { id: 'a_anchor2', pick: rifle,      region: 'a_site', anchorOffset: 1,
            directives: [holdAngle(reg('a_main'))] },
          { id: 'b_anchor',  pick: rifle,      region: 'b_site', anchorOffset: 2,
            directives: [holdAngle(reg('b_main'))] },
          { id: 'b_anchor2', pick: rifle,      region: 'b_site', anchorOffset: 1,
            directives: [holdAngle(reg('b_main'))] },
          { id: 'mid',       pick: sniperPref, region: 'mid',    anchorOffset: 5,
            directives: [safeSniper(enemySpawn)] },
        ]],
        fallbackRegion: 'mid',
        ...mod('Hold_Composure'),
      },
      // Leader — stack all 3 on one site for aura overlap (H3 hero passive).
      {
        id: 'Coordinated_Lockdown', name: 'Coordinated Lockdown', side: 'defender',
        description: 'Leader-themed cluster — all 5 stack one site for aura overlap + crossfire trades. Loses the other site entirely if attackers split.',
        variants: [
          [
            { id: 'a_cap',   pick: sniperPref, region: 'a_site', anchorOffset: 2,
              directives: [safeSniper(reg('a_main')), tradeFor('a_left', 4)] },
            { id: 'a_left',  pick: rifle,     region: 'a_site', anchorOffset: 1,
              directives: [holdAngle(reg('a_main')), tradeFor('a_right', 4)] },
            { id: 'a_right', pick: rifle,     region: 'a_site', anchorOffset: 1,
              directives: [holdAngle(reg('a_main')), tradeFor('a_left', 4)] },
            { id: 'a_back',  pick: rifle,     region: 'a_site', anchorOffset: 3,
              directives: [holdAngle(reg('a_main')), tradeFor('a_cap', 4)] },
            { id: 'a_front', pick: rifle,     region: 'a_site', anchorOffset: 1,
              directives: [peek(reg('a_main')), tradeFor('a_left', 4)] },
          ],
          [
            { id: 'b_cap',   pick: sniperPref, region: 'b_site', anchorOffset: 2,
              directives: [safeSniper(reg('b_main')), tradeFor('b_left', 4)] },
            { id: 'b_left',  pick: rifle,     region: 'b_site', anchorOffset: 1,
              directives: [holdAngle(reg('b_main')), tradeFor('b_right', 4)] },
            { id: 'b_right', pick: rifle,     region: 'b_site', anchorOffset: 1,
              directives: [holdAngle(reg('b_main')), tradeFor('b_left', 4)] },
            { id: 'b_back',  pick: rifle,     region: 'b_site', anchorOffset: 3,
              directives: [holdAngle(reg('b_main')), tradeFor('b_cap', 4)] },
            { id: 'b_front', pick: rifle,     region: 'b_site', anchorOffset: 1,
              directives: [peek(reg('b_main')), tradeFor('b_left', 4)] },
          ],
        ],
        fallbackRegion: 'mid',
        ...mod('Coordinated_Lockdown'),
      },
      // Roamer — mobile defenders rotate between sites continuously.
      {
        id: 'Rotate_Stack', name: 'Rotating Stack', side: 'defender',
        description: 'Roamer-themed mobility — defenders rotate between sites in pairs instead of holding. Bad against fast pushes; good against patient attacks.',
        variants: [[
          { id: 'rotator_a',  pick: rifle,    region: 'a_site', anchorOffset: 1,
            directives: [peek(reg('a_main')), rotateOnContact(reg('b_site'), ['rotator_b'], 2)] },
          { id: 'rotator_a2', pick: rifle,    region: 'a_site', anchorOffset: 2,
            directives: [peek(reg('a_main')), rotateOnContact(reg('b_site'), ['rotator_b'], 2)] },
          { id: 'rotator_b',  pick: rifle,    region: 'b_site', anchorOffset: 1,
            directives: [peek(reg('b_main')), rotateOnContact(reg('a_site'), ['rotator_a'], 2)] },
          { id: 'rotator_b2', pick: rifle,    region: 'b_site', anchorOffset: 2,
            directives: [peek(reg('b_main')), rotateOnContact(reg('a_site'), ['rotator_a'], 2)] },
          { id: 'mid',        pick: sniperPref, region: 'mid',  anchorOffset: 4,
            directives: [safeSniper(enemySpawn)] },
        ]],
        fallbackRegion: 'mid',
        ...mod('Rotate_Stack'),
      },
      // Paranoid — defenders spread VERY wide to cover every angle.
      {
        id: 'Wide_Watch', name: 'Wide Watch', side: 'defender',
        description: 'Paranoid-themed coverage — defenders spread to opposite extreme angles down both mains. Wide map coverage; little trade potential.',
        variants: [[
          { id: 'a_far',  pick: rifle,      region: 'a_main', anchorOffset: 10,
            directives: [holdAngle(reg('a_site'))] },
          { id: 'a_far2', pick: rifle,      region: 'a_main', anchorOffset: 6,
            directives: [holdAngle(reg('a_site'))] },
          { id: 'b_far',  pick: rifle,      region: 'b_main', anchorOffset: 10,
            directives: [holdAngle(reg('b_site'))] },
          { id: 'b_far2', pick: rifle,      region: 'b_main', anchorOffset: 6,
            directives: [holdAngle(reg('b_site'))] },
          { id: 'mid',    pick: sniperPref, region: 'mid',    anchorOffset: 2,
            directives: [safeSniper(enemySpawn)] },
        ]],
        fallbackRegion: 'mid',
        ...mod('Wide_Watch'),
      },
      // Patient — stay deep, accept round-timer wins, Patient trait bonus.
      {
        id: 'Slow_Burn', name: 'Slow Burn', side: 'defender',
        description: 'Patient-themed wait-out — defenders hold deep + safe positions (two per site), banking on the round timer + Patient late-tick HR bonus.',
        variants: [[
          { id: 'deep_a',  pick: rifle,      region: 'a_site', anchorOffset: 5,
            directives: [holdAngle(reg('a_main'))] },
          { id: 'deep_a2', pick: rifle,      region: 'a_site', anchorOffset: 4,
            directives: [holdAngle(reg('a_main'))] },
          { id: 'deep_b',  pick: rifle,      region: 'b_site', anchorOffset: 5,
            directives: [holdAngle(reg('b_main'))] },
          { id: 'deep_b2', pick: rifle,      region: 'b_site', anchorOffset: 4,
            directives: [holdAngle(reg('b_main'))] },
          { id: 'deep_mid', pick: sniperPref, region: 'mid',  anchorOffset: 12,
            directives: [safeSniper(enemySpawn)] },
        ]],
        fallbackRegion: 'mid',
        ...mod('Slow_Burn'),
      },
    ],
    atk: [
      // Run-n-Gun — fast site rush, no hesitation, sniper trails.
      {
        id: 'Mobile_Push', name: 'Mobile Push', side: 'attacker',
        description: 'Run-n-Gun-themed fast push — four attackers run a single lane direct to plant; no hesitation, no mid play. Sniper trails behind for cleanup.',
        variants: [
          [
            { id: 'lead',     pick: rifle,      region: 'a_plant',
              directives: [commitSite(reg('a_plant'))] },
            { id: 'support',  pick: rifle,      region: 'a_plant',
              directives: [commitSite(reg('a_plant')), tradeFor('lead', 4)] },
            { id: 'support2', pick: rifle,      region: 'a_plant',
              directives: [commitSite(reg('a_plant')), tradeFor('support', 4)] },
            { id: 'support3', pick: rifle,      region: 'a_plant',
              directives: [commitSite(reg('a_plant')), tradeFor('lead', 4)] },
            { id: 'trail',    pick: sniperPref, region: 'a_site', anchorOffset: 2,
              directives: [commitSite(reg('a_site')), safeSniper(reg('a_main'))] },
          ],
          [
            { id: 'lead',     pick: rifle,      region: 'b_plant',
              directives: [commitSite(reg('b_plant'))] },
            { id: 'support',  pick: rifle,      region: 'b_plant',
              directives: [commitSite(reg('b_plant')), tradeFor('lead', 4)] },
            { id: 'support2', pick: rifle,      region: 'b_plant',
              directives: [commitSite(reg('b_plant')), tradeFor('support', 4)] },
            { id: 'support3', pick: rifle,      region: 'b_plant',
              directives: [commitSite(reg('b_plant')), tradeFor('lead', 4)] },
            { id: 'trail',    pick: sniperPref, region: 'b_site', anchorOffset: 2,
              directives: [commitSite(reg('b_site')), safeSniper(reg('b_main'))] },
          ],
        ],
        fallbackRegion: 'mid',
        ...mod('Mobile_Push'),
      },
      // Lurker — perimeter approach, arrive late but unscoped (with H3 invisibility hook later).
      {
        id: 'Patient_Flank', name: 'Patient Flank', side: 'attacker',
        description: 'Lurker-themed perimeter — four attackers take the long route around the map edge. Arrives late but avoids the main lanes entirely.',
        variants: [
          [
            { id: 'lurk_lead',  pick: rifle,      region: 'a_plant', usePerimeterPath: true,
              directives: [commitSite(reg('a_plant'))] },
            { id: 'lurk_trail', pick: rifle,      region: 'a_plant', usePerimeterPath: true,
              directives: [commitSite(reg('a_plant')), tradeFor('lurk_lead', 5)] },
            { id: 'lurk_third', pick: rifle,      region: 'a_plant', usePerimeterPath: true,
              directives: [commitSite(reg('a_plant')), tradeFor('lurk_trail', 5)] },
            { id: 'watch',      pick: rifle,      region: 'a_main',  usePerimeterPath: true, anchorOffset: 4,
              directives: [holdAngle(reg('a_site')), tradeFor('lurk_lead', 5)] },
            { id: 'support',    pick: sniperPref, region: 'mid',     usePerimeterPath: true, anchorOffset: 4,
              directives: [safeSniper(reg('a_main')), tradeFor('lurk_lead', 5)] },
          ],
          [
            { id: 'lurk_lead',  pick: rifle,      region: 'b_plant', usePerimeterPath: true,
              directives: [commitSite(reg('b_plant'))] },
            { id: 'lurk_trail', pick: rifle,      region: 'b_plant', usePerimeterPath: true,
              directives: [commitSite(reg('b_plant')), tradeFor('lurk_lead', 5)] },
            { id: 'lurk_third', pick: rifle,      region: 'b_plant', usePerimeterPath: true,
              directives: [commitSite(reg('b_plant')), tradeFor('lurk_trail', 5)] },
            { id: 'watch',      pick: rifle,      region: 'b_main',  usePerimeterPath: true, anchorOffset: 4,
              directives: [holdAngle(reg('b_site')), tradeFor('lurk_lead', 5)] },
            { id: 'support',    pick: sniperPref, region: 'mid',     usePerimeterPath: true, anchorOffset: 4,
              directives: [safeSniper(reg('b_main')), tradeFor('lurk_lead', 5)] },
          ],
        ],
        fallbackRegion: 'mid',
        ...mod('Patient_Flank'),
      },
      // Entry — Vanguard leads, allies follow 2 ticks behind (timed commit).
      {
        id: 'Coordinated_Execute', name: 'Coordinated Execute', side: 'attacker',
        description: 'Entry-themed timed commit — entry fragger leads, two traders follow, a flanker watches the lane, sniper anchors mid. Higher discipline than Execute baseline.',
        variants: [
          [
            { id: 'entry',   pick: rifle,      region: 'a_plant',
              directives: [commitSite(reg('a_plant')), peek(reg('a_site'))] },
            { id: 'trader',  pick: rifle,      region: 'a_plant',
              directives: [commitSite(reg('a_plant')), tradeFor('entry', 3)] },
            { id: 'trader2', pick: rifle,      region: 'a_plant',
              directives: [commitSite(reg('a_plant')), tradeFor('trader', 3)] },
            { id: 'flank',   pick: rifle,      region: 'a_main', usePerimeterPath: true, anchorOffset: 4,
              directives: [holdAngle(reg('a_site')), tradeFor('entry', 4)] },
            { id: 'anchor',  pick: sniperPref, region: 'mid', anchorOffset: 4,
              directives: [safeSniper(reg('a_main')), tradeFor('entry', 4)] },
          ],
          [
            { id: 'entry',   pick: rifle,      region: 'b_plant',
              directives: [commitSite(reg('b_plant')), peek(reg('b_site'))] },
            { id: 'trader',  pick: rifle,      region: 'b_plant',
              directives: [commitSite(reg('b_plant')), tradeFor('entry', 3)] },
            { id: 'trader2', pick: rifle,      region: 'b_plant',
              directives: [commitSite(reg('b_plant')), tradeFor('trader', 3)] },
            { id: 'flank',   pick: rifle,      region: 'b_main', usePerimeterPath: true, anchorOffset: 4,
              directives: [holdAngle(reg('b_site')), tradeFor('entry', 4)] },
            { id: 'anchor',  pick: sniperPref, region: 'mid', anchorOffset: 4,
              directives: [safeSniper(reg('b_main')), tradeFor('entry', 4)] },
          ],
        ],
        fallbackRegion: 'mid',
        ...mod('Coordinated_Execute'),
      },
      // Ego — every unit picks own angle. Low compliance is the point.
      {
        id: 'Solo_Frag', name: 'Solo Frag', side: 'attacker',
        description: 'Ego-themed freelancing — each attacker picks their own angle across the map and engages independently. High Aim wins; low Discipline penalty is the trade.',
        variants: [[
          { id: 'frag_a',  pick: rifle,      region: 'a_main', anchorOffset: 4,
            directives: [peek(reg('a_site'))] },
          { id: 'frag_a2', pick: rifle,      region: 'a_plant',
            directives: [peek(reg('a_site'))] },
          { id: 'frag_b',  pick: rifle,      region: 'b_main', anchorOffset: 4,
            directives: [peek(reg('b_site'))] },
          { id: 'frag_b2', pick: rifle,      region: 'b_plant',
            directives: [peek(reg('b_site'))] },
          { id: 'frag_m',  pick: sniperPref, region: 'mid',    anchorOffset: 2,
            directives: [holdAngle(enemySpawn)] },
        ]],
        fallbackRegion: 'mid',
        ...mod('Solo_Frag'),
      },
      // Lone Wolf — split-3-ways push, no shared trades.
      {
        id: 'Scatter_Push', name: 'Scatter Push', side: 'attacker',
        description: 'Lone Wolf-themed split — attackers go separate sites/angles. No teammate trades; pure pressure across the whole map.',
        variants: [[
          { id: 'split_a',  pick: rifle,      region: 'a_plant',
            directives: [commitSite(reg('a_plant'))] },
          { id: 'split_a2', pick: rifle,      region: 'a_main', anchorOffset: 4,
            directives: [peek(reg('a_site'))] },
          { id: 'split_b',  pick: rifle,      region: 'b_plant',
            directives: [commitSite(reg('b_plant'))] },
          { id: 'split_b2', pick: rifle,      region: 'b_main', anchorOffset: 4,
            directives: [peek(reg('b_site'))] },
          { id: 'split_m',  pick: sniperPref, region: 'mid',    anchorOffset: 4,
            directives: [holdAngle(enemySpawn), safeSniper(enemySpawn)] },
        ]],
        fallbackRegion: 'mid',
        ...mod('Scatter_Push'),
      },
      // Hot Head — fast peeks, take fights early.
      {
        id: 'Aggressive_Peek', name: 'Aggressive Peek', side: 'attacker',
        description: 'Hot Head-themed pressure — four attackers push forward fast and peek aggressively from mid-map. Trades plant focus for early frags.',
        variants: [[
          { id: 'peek_a',  pick: rifle,      region: 'mid', anchorOffset: -4,
            directives: [peek(reg('a_main')), holdAngle(reg('a_site'))] },
          { id: 'peek_a2', pick: rifle,      region: 'mid', anchorOffset: -4,
            directives: [peek(reg('a_main')), holdAngle(reg('a_site'))] },
          { id: 'peek_b',  pick: rifle,      region: 'mid', anchorOffset: -4,
            directives: [peek(reg('b_main')), holdAngle(reg('b_site'))] },
          { id: 'peek_b2', pick: rifle,      region: 'mid', anchorOffset: -4,
            directives: [peek(reg('b_main')), holdAngle(reg('b_site'))] },
          { id: 'peek_m',  pick: sniperPref, region: 'mid', anchorOffset: 2,
            directives: [safeSniper(enemySpawn)] },
        ]],
        fallbackRegion: 'mid',
        ...mod('Aggressive_Peek'),
      },
      // Big Brain — fake one site, swing the other. Attacker Mind_Games.
      {
        id: 'Mind_Games', name: 'Mind Games (A)', side: 'attacker',
        description: 'Big Brain-themed fake — two attackers show A early then swing to B where two more commit. Punishes defender over-rotations.',
        variants: [
          [
            { id: 'feint',  pick: rifle,      region: 'a_main', anchorOffset: 6,
              directives: [peek(reg('a_site')), rotateOnContact(reg('b_plant'), ['feint'], 4)] },
            { id: 'feint2', pick: rifle,      region: 'a_main', anchorOffset: 6,
              directives: [peek(reg('a_site')), rotateOnContact(reg('b_plant'), ['feint'], 4)] },
            { id: 'real',   pick: rifle,      region: 'b_plant', usePerimeterPath: true,
              directives: [commitSite(reg('b_plant'))] },
            { id: 'real2',  pick: rifle,      region: 'b_plant', usePerimeterPath: true,
              directives: [commitSite(reg('b_plant')), tradeFor('real', 5)] },
            { id: 'anchor', pick: sniperPref, region: 'mid', anchorOffset: 4,
              directives: [safeSniper(reg('b_main')), tradeFor('real', 5)] },
          ],
        ],
        fallbackRegion: 'mid',
        ...mod('Mind_Games'),
      },
    ],
  };
}

// --- Canyon ----------------------------------------------------------------
// Canyon-native baseline playbook exploiting the richer vocabulary: site
// entries + anchors + off-angles, near/far main-lane splits, and mid left/right
// + the central choke. FIRST-PASS DRAFT against the heuristic zone placement —
// references only zones currently painted (off2/chokes/connectors are not yet
// placed, so they're avoided to prevent null-centroid drops). Sharpen once
// Canyon's zones are hand-refined. The trait-unlocked set reuses the shared
// (generic-region) templates, which resolve fine on Canyon.
const CANYON_ATK: Strategy[] = [
  {
    id: 'Execute', name: 'Execute', side: 'attacker',
    description: 'Split push — 3 rifles breach one site through its entry while a 4th holds the far main; sniper anchors the mid choke for crossfire.',
    variants: [
      [
        { id: 'entry',      pick: rifle, region: 'a_plant',
          directives: [commitSite(reg('a_plant')), peek(reg('a_entry'))] },
        { id: 'support',    pick: rifle, region: 'a_plant',
          directives: [commitSite(reg('a_plant')), tradeFor('entry', 4)] },
        { id: 'support2',   pick: rifle, region: 'a_plant',
          directives: [commitSite(reg('a_plant')), tradeFor('support', 4)] },
        { id: 'lane',       pick: rifle, region: 'a_main_far', usePerimeterPath: true,
          directives: [holdAngle(reg('a_entry')), tradeFor('entry', 4)] },
        { id: 'mid_anchor', pick: sniperPref, region: 'mid', anchorOffset: 4,
          directives: [holdAngle(reg('mid_choke')), safeSniper(reg('mid_choke')),
                       tradeFor('entry', 4), rotateOnContact(reg('a_site'), ['entry'], 3)] },
      ],
      [
        { id: 'entry',      pick: rifle, region: 'b_plant',
          directives: [commitSite(reg('b_plant')), peek(reg('b_entry'))] },
        { id: 'support',    pick: rifle, region: 'b_plant',
          directives: [commitSite(reg('b_plant')), tradeFor('entry', 4)] },
        { id: 'support2',   pick: rifle, region: 'b_plant',
          directives: [commitSite(reg('b_plant')), tradeFor('support', 4)] },
        { id: 'lane',       pick: rifle, region: 'b_main_far', usePerimeterPath: true,
          directives: [holdAngle(reg('b_entry')), tradeFor('entry', 4)] },
        { id: 'mid_anchor', pick: sniperPref, region: 'mid', anchorOffset: 4,
          directives: [holdAngle(reg('mid_choke')), safeSniper(reg('mid_choke')),
                       tradeFor('entry', 4), rotateOnContact(reg('b_site'), ['entry'], 3)] },
      ],
    ],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Execute.aggression,
    retreatThresholdMod: STRATEGY_MODS.Execute.retreatThreshold,
  },
  {
    id: 'Rush', name: 'Rush', side: 'attacker',
    description: 'All-in on one site — four rifles flood the main lane to the plant, sniper trails for cleanup. No mid presence.',
    variants: [
      [
        { id: 'lead',     pick: rifle,      region: 'a_plant', usePerimeterPath: true,
          directives: [commitSite(reg('a_plant')), peek(reg('a_entry'))] },
        { id: 'support',  pick: rifle,      region: 'a_plant', usePerimeterPath: true,
          directives: [commitSite(reg('a_plant')), tradeFor('lead', 5)] },
        { id: 'support2', pick: rifle,      region: 'a_plant', usePerimeterPath: true,
          directives: [commitSite(reg('a_plant')), tradeFor('support', 5)] },
        { id: 'support3', pick: rifle,      region: 'a_plant', usePerimeterPath: true,
          directives: [commitSite(reg('a_plant')), tradeFor('lead', 5)] },
        { id: 'cleanup',  pick: sniperPref, region: 'a_entry', usePerimeterPath: true, anchorOffset: 2,
          directives: [commitSite(reg('a_site')), safeSniper(reg('a_main_near')), tradeFor('lead', 5)] },
      ],
      [
        { id: 'lead',     pick: rifle,      region: 'b_plant', usePerimeterPath: true,
          directives: [commitSite(reg('b_plant')), peek(reg('b_entry'))] },
        { id: 'support',  pick: rifle,      region: 'b_plant', usePerimeterPath: true,
          directives: [commitSite(reg('b_plant')), tradeFor('lead', 5)] },
        { id: 'support2', pick: rifle,      region: 'b_plant', usePerimeterPath: true,
          directives: [commitSite(reg('b_plant')), tradeFor('support', 5)] },
        { id: 'support3', pick: rifle,      region: 'b_plant', usePerimeterPath: true,
          directives: [commitSite(reg('b_plant')), tradeFor('lead', 5)] },
        { id: 'cleanup',  pick: sniperPref, region: 'b_entry', usePerimeterPath: true, anchorOffset: 2,
          directives: [commitSite(reg('b_site')), safeSniper(reg('b_main_near')), tradeFor('lead', 5)] },
      ],
    ],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Rush.aggression,
    retreatThresholdMod: STRATEGY_MODS.Rush.retreatThreshold,
  },
  {
    id: 'Control', name: 'Control', side: 'attacker',
    description: 'Slow info — two rifles take the far end of each main lane; sniper holds the mid choke for long picks. Rotate to a site on team contact.',
    variants: [[
      { id: 'flank_a',    pick: rifle,      region: 'a_main_far', anchorOffset: 4, usePerimeterPath: true,
        directives: [holdAngle(reg('a_entry')), rotateOnContact(reg('mid'), ['mid_sniper'], 4)] },
      { id: 'flank_a2',   pick: rifle,      region: 'a_main_far', usePerimeterPath: true,
        directives: [holdAngle(reg('a_entry')), tradeFor('flank_a', 4)] },
      { id: 'flank_b',    pick: rifle,      region: 'b_main_far', anchorOffset: 4, usePerimeterPath: true,
        directives: [holdAngle(reg('b_entry')), rotateOnContact(reg('mid'), ['mid_sniper'], 4)] },
      { id: 'flank_b2',   pick: rifle,      region: 'b_main_far', usePerimeterPath: true,
        directives: [holdAngle(reg('b_entry')), tradeFor('flank_b', 4)] },
      { id: 'mid_sniper', pick: sniperPref, region: 'mid_choke', anchorOffset: 6,
        directives: [holdAngle(enemySpawn), safeSniper(enemySpawn), tradeFor('flank_a', 5)] },
    ]],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Control.aggression,
    retreatThresholdMod: STRATEGY_MODS.Control.retreatThreshold,
  },
];

const CANYON_DEF: Strategy[] = [
  {
    id: 'Hold', name: 'Hold', side: 'defender',
    description: 'Even split — a rifle anchors each site watching its entry, with a flank watcher on the lane; sniper holds the mid choke. Rotations flow through the connectors. No site bias.',
    variants: [[
      { id: 'a_anchor', pick: rifle,      region: 'a_anchor', anchorOffset: 1,
        directives: [holdAngle(reg('a_entry')), rotateOnContact(reg('b_site'), ['b_anchor'], 4)] },
      { id: 'a_flank',  pick: rifle,      region: 'a_off',
        directives: [holdAngle(reg('a_main_near')), tradeFor('a_anchor', 4)] },
      { id: 'b_anchor', pick: rifle,      region: 'b_anchor', anchorOffset: 1,
        directives: [holdAngle(reg('b_entry')), rotateOnContact(reg('a_site'), ['a_anchor'], 4)] },
      { id: 'b_flank',  pick: rifle,      region: 'b_off',
        directives: [holdAngle(reg('b_main_near')), tradeFor('b_anchor', 4)] },
      { id: 'mid',      pick: sniperPref, region: 'mid_choke', anchorOffset: 4,
        directives: [safeSniper(enemySpawn), rotateOnContact(reg('a_site'), ['a_anchor'], 3)] },
    ]],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Hold.aggression,
    retreatThresholdMod: STRATEGY_MODS.Hold.retreatThreshold,
  },
  {
    id: 'Stack', name: 'Stack', side: 'defender',
    description: 'Cluster on one site — sniper + two rifles hold the anchor & off-angle for crossfire; one holds mid choke, one watches the off-site for rotates.',
    variants: [
      [
        { id: 'a_sniper', pick: sniperPref, region: 'a_anchor', anchorOffset: 1,
          directives: [safeSniper(reg('a_main_near')), tradeFor('a_hold', 5)] },
        { id: 'a_hold',   pick: rifle,      region: 'a_anchor', anchorOffset: 1,
          directives: [holdAngle(reg('a_entry')), tradeFor('a_sniper', 5)] },
        { id: 'a_flank',  pick: rifle,      region: 'a_off',
          directives: [holdAngle(reg('a_main_near')), tradeFor('a_hold', 5)] },
        { id: 'mid',      pick: rifle,      region: 'mid_choke', anchorOffset: 2,
          directives: [holdAngle(enemySpawn), rotateOnContact(reg('a_site'), ['a_hold'], 3)] },
        { id: 'offsite',  pick: rifle,      region: 'b_anchor', anchorOffset: 1,
          directives: [holdAngle(reg('b_entry')), rotateOnContact(reg('a_site'), ['a_hold'], 4)] },
      ],
      [
        { id: 'b_sniper', pick: sniperPref, region: 'b_anchor', anchorOffset: 1,
          directives: [safeSniper(reg('b_main_near')), tradeFor('b_hold', 5)] },
        { id: 'b_hold',   pick: rifle,      region: 'b_anchor', anchorOffset: 1,
          directives: [holdAngle(reg('b_entry')), tradeFor('b_sniper', 5)] },
        { id: 'b_flank',  pick: rifle,      region: 'b_off',
          directives: [holdAngle(reg('b_main_near')), tradeFor('b_hold', 5)] },
        { id: 'mid',      pick: rifle,      region: 'mid_choke', anchorOffset: 2,
          directives: [holdAngle(enemySpawn), rotateOnContact(reg('b_site'), ['b_hold'], 3)] },
        { id: 'offsite',  pick: rifle,      region: 'a_anchor', anchorOffset: 1,
          directives: [holdAngle(reg('a_entry')), rotateOnContact(reg('b_site'), ['b_hold'], 4)] },
      ],
    ],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Stack.aggression,
    retreatThresholdMod: STRATEGY_MODS.Stack.retreatThreshold,
  },
  {
    id: 'Pressure', name: 'Pressure', side: 'defender',
    description: 'Push mid off spawn — four rifles contest the choke from the left/right approaches; sniper holds the long mid lane from behind.',
    variants: [[
      { id: 'mid_push',   pick: rifle,      region: 'mid_choke',
        directives: [peek(reg('mid_choke')), holdAngle(enemySpawn), tradeFor('mid_left', 4)] },
      { id: 'mid_push2',  pick: rifle,      region: 'mid_choke',
        directives: [peek(reg('mid_choke')), holdAngle(enemySpawn), tradeFor('mid_right', 4)] },
      { id: 'mid_left',   pick: rifle,      region: 'mid_left', anchorOffset: 2,
        directives: [holdAngle(enemySpawn), tradeFor('mid_push', 4)] },
      { id: 'mid_right',  pick: rifle,      region: 'mid_right', anchorOffset: 2,
        directives: [holdAngle(enemySpawn), tradeFor('mid_push2', 4)] },
      { id: 'mid_sniper', pick: sniperPref, region: 'mid', anchorOffset: 8,
        directives: [safeSniper(enemySpawn), rotateOnContact(reg('mid_choke'), ['mid_push'], 3)] },
    ]],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Pressure.aggression,
    retreatThresholdMod: STRATEGY_MODS.Pressure.retreatThreshold,
  },
];

const FOUNDRY_UNLOCKS = buildUnlocks('Foundry');
const ATOLL_UNLOCKS = buildUnlocks('Atoll');
const CANYON_UNLOCKS = buildUnlocks('Canyon');

const BY_MAP: Record<MapDefinition['name'], Strategy[]> = {
  Foundry: [...FOUNDRY_ATK, ...FOUNDRY_DEF, ...FOUNDRY_UNLOCKS.atk, ...FOUNDRY_UNLOCKS.def],
  Atoll:   [...ATOLL_ATK,   ...ATOLL_DEF,   ...ATOLL_UNLOCKS.atk,   ...ATOLL_UNLOCKS.def],
  // Canyon: native baseline (CANYON_ATK/DEF) built on the richer vocabulary
  // (entries/anchors/off-angles, near/far lane splits, mid left/right/choke).
  // Unlocks reuse the shared generic-region templates (which resolve on Canyon).
  Canyon:  [...CANYON_ATK, ...CANYON_DEF, ...CANYON_UNLOCKS.atk, ...CANYON_UNLOCKS.def],
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
