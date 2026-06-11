// Strategy definitions (spec §7.2). v0.28.0 — DECOUPLED from traits: the menu is
// the same for every roster (no trait-unlock gating). 9 strategies total:
//   Attacker (4): Execute / Rush / Control / Mind_Games
//   Defender (6): Hold / Stack / Pressure / Mind_Games / Coordinated_Lockdown /
//                 Rotate_Stack
// (The retired trait-unlock strategies + the dead Foundry/Atoll-v1 playbooks were
// removed here; the live maps Foundryv2 / Atoll_v2 / Canyon all share this one
// rich-vocab set.)
//
// Strategy = an ORDERED LIST OF SLOTS (not a Role→region map). Each slot is a
// tactical position with a loadout preference; `assignSlots` greedily picks team
// units into slots by `preferWeapon`. Avoids the role-repeat bug where two
// Vanguards collapsed onto the same Role-keyed region.
//
// Each slot carries:
//   - region (centroid is the unit's primary target)
//   - directives (composable Directives the unit will follow this round)
//   - optional usePerimeterPath / anchorOffset tweaks
//
// Multi-site strategies (Rush A/B, Stack A/B, Execute A/B, Coordinated_Lockdown
// A/B) declare `variants[]`. The player picks the variant explicitly via the A/B
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
  // Baseline strategies set ~50 (neutral); the demanding plays (Mind_Games,
  // Coordinated_Lockdown) set 60-75 so a low-Discipline roster pays for picking
  // them. Optional — defaults to 50 (neutral) if absent.
  complianceThreshold?: number;
  // v0.28.0 — reserved for the future management/progression layer to gate a
  // strategy behind earned unlocks. NOTHING sets it today (the menu is fully
  // available); `availableStrategies` still filters on it so the seam is live.
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
// `cover` is an OPTIONAL explicit retreat override; when omitted the unit falls
// back to its assigned hold (see directives.peekAndRetreat) — NOT own spawn,
// which used to yo-yo peekers across the whole map.
const peek = (peekRef: { region: string }, cover?: { region: string } | typeof ownSpawn): DirectiveSpec =>
  ({ kind: 'peek_and_retreat', peek: peekRef, ...(cover ? { cover } : {}), cadenceTicks: 4, priority: 65 });
// read_and_commit — the "read the defense" attacker call. Once the team knows
// ≥minKnown defenders, commit to the plant of the lighter-held site. Priority 70
// (same as commit_site) so it drives the commit once a read forms; returns null
// before then, leaving the unit to advance/gather via lower directives.
const readAndCommit = (defaultSite: 'a' | 'b', minKnown = 2): DirectiveSpec =>
  ({ kind: 'read_and_commit', defaultSite, minKnown, priority: 70 });

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

// --- Attacker playbook -----------------------------------------------------
// Built on the rich region vocabulary: site entries + anchors + off-angles,
// near/far main-lane splits, and mid left/right + the central choke.
const ATK: Strategy[] = [
  {
    id: 'Execute', name: 'Execute', side: 'attacker',
    description: 'Split push — 3 rifles breach one site through its entry while a 4th holds the far main; sniper anchors the mid choke for crossfire.',
    variants: [
      [
        { id: 'entry',      pick: rifle, region: 'a_plant',
          directives: [commitSite(reg('a_plant'), ['mid_choke', 'a_main_near']), peek(reg('a_entry'))] },
        { id: 'support',    pick: rifle, region: 'a_plant',
          directives: [commitSite(reg('a_plant'), ['mid_choke', 'a_main_near']), tradeFor('entry', 4)] },
        { id: 'support2',   pick: rifle, region: 'a_plant',
          directives: [commitSite(reg('a_plant'), ['mid_choke', 'a_main_near']), tradeFor('support', 4)] },
        { id: 'lane',       pick: rifle, region: 'a_main_far', usePerimeterPath: true,
          directives: [holdAngle(reg('a_entry')), tradeFor('entry', 4)] },
        { id: 'mid_anchor', pick: sniperPref, region: 'mid', anchorOffset: 4,
          directives: [holdAngle(reg('mid_choke')), safeSniper(reg('mid_choke')),
                       tradeFor('entry', 4), rotateOnContact(reg('a_site'), ['entry'], 3)] },
      ],
      [
        { id: 'entry',      pick: rifle, region: 'b_plant',
          directives: [commitSite(reg('b_plant'), ['mid_choke', 'b_main_near']), peek(reg('b_entry'))] },
        { id: 'support',    pick: rifle, region: 'b_plant',
          directives: [commitSite(reg('b_plant'), ['mid_choke', 'b_main_near']), tradeFor('entry', 4)] },
        { id: 'support2',   pick: rifle, region: 'b_plant',
          directives: [commitSite(reg('b_plant'), ['mid_choke', 'b_main_near']), tradeFor('support', 4)] },
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
    description: 'Slow read — two rifles probe each main lane to read where the defenders are, then all four commit to whichever site is held lighter; sniper holds the mid choke for long picks. Punishes a defense that over-shows one site (and gets baited by a fake).',
    // v0.40.0 — Control now READS the defense (read_and_commit): it stages on both
    // main lanes to gather vision, then commits to the site holding fewer known
    // defenders. (The matching defensive-fake payoff is parked behind the threat-
    // matrix — see the Mind Games note — but Control committing the lighter site is
    // a standalone improvement over its old passive mid-consolidation.)
    variants: [[
      { id: 'flank_a',    pick: rifle,      region: 'a_main_far', anchorOffset: 4, usePerimeterPath: true,
        directives: [readAndCommit('a'), holdAngle(reg('a_entry'))] },
      { id: 'flank_a2',   pick: rifle,      region: 'a_main_far', usePerimeterPath: true,
        directives: [readAndCommit('a'), holdAngle(reg('a_entry')), tradeFor('flank_a', 4)] },
      { id: 'flank_b',    pick: rifle,      region: 'b_main_far', anchorOffset: 4, usePerimeterPath: true,
        directives: [readAndCommit('b'), holdAngle(reg('b_entry'))] },
      { id: 'flank_b2',   pick: rifle,      region: 'b_main_far', usePerimeterPath: true,
        directives: [readAndCommit('b'), holdAngle(reg('b_entry')), tradeFor('flank_b', 4)] },
      { id: 'mid_sniper', pick: sniperPref, region: 'mid_choke', anchorOffset: 6,
        directives: [holdAngle(enemySpawn), safeSniper(enemySpawn), tradeFor('flank_a', 5)] },
    ]],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Control.aggression,
    retreatThresholdMod: STRATEGY_MODS.Control.retreatThreshold,
  },
  // Mind Games (attacker) — show one site then swing to the other. Promoted to
  // baseline in v0.28.0 (was a Big Brain trait-unlock); rich-vocab regions.
  {
    id: 'Mind_Games', name: 'Mind Games', side: 'attacker',
    description: 'Fake-and-swing — two attackers show one site then rotate to the other, where two more commit to the plant; sniper anchors the mid choke. Punishes defender over-rotations.',
    variants: [
      [
        { id: 'feint',  pick: rifle,      region: 'a_main_far', usePerimeterPath: true, anchorOffset: 2,
          directives: [peek(reg('a_entry')), rotateOnContact(reg('b_plant'), ['feint'], 4)] },
        { id: 'feint2', pick: rifle,      region: 'a_main_far', usePerimeterPath: true,
          directives: [peek(reg('a_entry')), rotateOnContact(reg('b_plant'), ['feint'], 4)] },
        { id: 'real',   pick: rifle,      region: 'b_plant', usePerimeterPath: true,
          directives: [commitSite(reg('b_plant'), ['mid_choke', 'b_main_near'])] },
        { id: 'real2',  pick: rifle,      region: 'b_plant', usePerimeterPath: true,
          directives: [commitSite(reg('b_plant'), ['mid_choke', 'b_main_near']), tradeFor('real', 5)] },
        { id: 'anchor', pick: sniperPref, region: 'mid_choke', anchorOffset: 4,
          directives: [safeSniper(reg('b_main_near')), tradeFor('real', 5)] },
      ],
      [
        { id: 'feint',  pick: rifle,      region: 'b_main_far', usePerimeterPath: true, anchorOffset: 2,
          directives: [peek(reg('b_entry')), rotateOnContact(reg('a_plant'), ['feint'], 4)] },
        { id: 'feint2', pick: rifle,      region: 'b_main_far', usePerimeterPath: true,
          directives: [peek(reg('b_entry')), rotateOnContact(reg('a_plant'), ['feint'], 4)] },
        { id: 'real',   pick: rifle,      region: 'a_plant', usePerimeterPath: true,
          directives: [commitSite(reg('a_plant'), ['mid_choke', 'a_main_near'])] },
        { id: 'real2',  pick: rifle,      region: 'a_plant', usePerimeterPath: true,
          directives: [commitSite(reg('a_plant'), ['mid_choke', 'a_main_near']), tradeFor('real', 5)] },
        { id: 'anchor', pick: sniperPref, region: 'mid_choke', anchorOffset: 4,
          directives: [safeSniper(reg('a_main_near')), tradeFor('real', 5)] },
      ],
    ],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Mind_Games.aggression,
    retreatThresholdMod: STRATEGY_MODS.Mind_Games.retreatThreshold,
    complianceThreshold: STRATEGY_MODS.Mind_Games.complianceThreshold,
  },
];

// --- Defender playbook -----------------------------------------------------
const DEF: Strategy[] = [
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
  // Mind Games (defender) — show one site then swing to the other. Promoted to
  // baseline in v0.28.0 (was a Big Brain trait-unlock); rich-vocab regions.
  {
    id: 'Mind_Games', name: 'Mind Games', side: 'defender',
    description: 'Fake-and-swing — two defenders show one site (peek then rotate), two more hold the other from the anchor + off-angle, sniper reads from the mid choke. Punishes attacker over-commits to the fake.',
    // NOTE: the "bait a reading attacker into the trap" rework was reverted (v0.40.0
    // experiment) — it needs a richer perception substrate than the sim has: the
    // attacker can't reliably perceive the show (maxKnown ~2 visible defenders), so
    // the bait doesn't register. Parked behind the threat-matrix; this is the
    // original fake-and-swing (still beats attacker Mind Games, loses to Control).
    variants: [
      [
        { id: 'fake',  pick: rifle,      region: 'a_anchor', anchorOffset: 1,
          directives: [peek(reg('a_entry')), rotateOnContact(reg('b_site'), ['fake'], 5)] },
        { id: 'fake2', pick: rifle,      region: 'a_off',
          directives: [peek(reg('a_main_near')), rotateOnContact(reg('b_site'), ['fake'], 5)] },
        { id: 'real',  pick: rifle,      region: 'b_anchor', anchorOffset: 1,
          directives: [holdAngle(reg('b_entry'))] },
        { id: 'real2', pick: rifle,      region: 'b_off',
          directives: [holdAngle(reg('b_main_near')), tradeFor('real', 4)] },
        { id: 'mid',   pick: sniperPref, region: 'mid_choke', anchorOffset: 4,
          directives: [safeSniper(enemySpawn), rotateOnContact(reg('b_site'), ['fake'], 3)] },
      ],
      [
        { id: 'fake',  pick: rifle,      region: 'b_anchor', anchorOffset: 1,
          directives: [peek(reg('b_entry')), rotateOnContact(reg('a_site'), ['fake'], 5)] },
        { id: 'fake2', pick: rifle,      region: 'b_off',
          directives: [peek(reg('b_main_near')), rotateOnContact(reg('a_site'), ['fake'], 5)] },
        { id: 'real',  pick: rifle,      region: 'a_anchor', anchorOffset: 1,
          directives: [holdAngle(reg('a_entry'))] },
        { id: 'real2', pick: rifle,      region: 'a_off',
          directives: [holdAngle(reg('a_main_near')), tradeFor('real', 4)] },
        { id: 'mid',   pick: sniperPref, region: 'mid_choke', anchorOffset: 4,
          directives: [safeSniper(enemySpawn), rotateOnContact(reg('a_site'), ['fake'], 3)] },
      ],
    ],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Mind_Games.aggression,
    retreatThresholdMod: STRATEGY_MODS.Mind_Games.retreatThreshold,
    complianceThreshold: STRATEGY_MODS.Mind_Games.complianceThreshold,
  },
  // Coordinated Lockdown — stack all five on one site. Promoted to baseline in
  // v0.28.0 (was a Leader trait-unlock); rich-vocab regions. Loses the other
  // site entirely if attackers split — high commitment.
  {
    id: 'Coordinated_Lockdown', name: 'Coordinated Lockdown', side: 'defender',
    description: 'All-in defense — all five stack one site (anchor + off-angle + entry) for overlapping crossfire and trades. Wins the held site outright; concedes the other if attackers go there.',
    variants: [
      [
        { id: 'a_cap',   pick: sniperPref, region: 'a_anchor', anchorOffset: 2,
          directives: [safeSniper(reg('a_main_near')), tradeFor('a_left', 4)] },
        { id: 'a_left',  pick: rifle,      region: 'a_anchor', anchorOffset: 1,
          directives: [holdAngle(reg('a_entry')), tradeFor('a_right', 4)] },
        { id: 'a_right', pick: rifle,      region: 'a_off',
          directives: [holdAngle(reg('a_main_near')), tradeFor('a_left', 4)] },
        { id: 'a_back',  pick: rifle,      region: 'a_anchor', anchorOffset: 3,
          directives: [holdAngle(reg('a_entry')), tradeFor('a_cap', 4)] },
        { id: 'a_front', pick: rifle,      region: 'a_entry',
          directives: [peek(reg('a_main_near')), tradeFor('a_left', 4)] },
      ],
      [
        { id: 'b_cap',   pick: sniperPref, region: 'b_anchor', anchorOffset: 2,
          directives: [safeSniper(reg('b_main_near')), tradeFor('b_left', 4)] },
        { id: 'b_left',  pick: rifle,      region: 'b_anchor', anchorOffset: 1,
          directives: [holdAngle(reg('b_entry')), tradeFor('b_right', 4)] },
        { id: 'b_right', pick: rifle,      region: 'b_off',
          directives: [holdAngle(reg('b_main_near')), tradeFor('b_left', 4)] },
        { id: 'b_back',  pick: rifle,      region: 'b_anchor', anchorOffset: 3,
          directives: [holdAngle(reg('b_entry')), tradeFor('b_cap', 4)] },
        { id: 'b_front', pick: rifle,      region: 'b_entry',
          directives: [peek(reg('b_main_near')), tradeFor('b_left', 4)] },
      ],
    ],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Coordinated_Lockdown.aggression,
    retreatThresholdMod: STRATEGY_MODS.Coordinated_Lockdown.retreatThreshold,
    complianceThreshold: STRATEGY_MODS.Coordinated_Lockdown.complianceThreshold,
  },
  // Rotate — rotating mobile defense (pairs swap sites continuously). Promoted to
  // baseline in v0.28.0 (was a Roamer trait-unlock); rich-vocab regions.
  {
    id: 'Rotate_Stack', name: 'Rotate', side: 'defender',
    description: 'Rotating mobile defense — defenders hold an angle, then swap sites in pairs when a teammate makes contact. Weak to fast direct hits; strong against patient or split attacks.',
    // Rotators HOLD their angle (holdAngle, priority 50) and rotate on a
    // teammate's contact (rotateOnContact, priority 60 — now un-shadowed; the
    // old peek at priority 65 both shadowed the rotation AND yo-yo'd the unit to
    // its own spawn every cadence, so Rotate never actually rotated and bled
    // ~42% of deaths in transit).
    variants: [[
      { id: 'rotator_a',  pick: rifle,      region: 'a_anchor', anchorOffset: 1,
        directives: [holdAngle(reg('a_entry')), rotateOnContact(reg('b_site'), ['rotator_b'], 2)] },
      { id: 'rotator_a2', pick: rifle,      region: 'a_off',
        directives: [holdAngle(reg('a_main_near')), rotateOnContact(reg('b_site'), ['rotator_b'], 2)] },
      { id: 'rotator_b',  pick: rifle,      region: 'b_anchor', anchorOffset: 1,
        directives: [holdAngle(reg('b_entry')), rotateOnContact(reg('a_site'), ['rotator_a'], 2)] },
      { id: 'rotator_b2', pick: rifle,      region: 'b_off',
        directives: [holdAngle(reg('b_main_near')), rotateOnContact(reg('a_site'), ['rotator_a'], 2)] },
      { id: 'mid',        pick: sniperPref, region: 'mid_choke', anchorOffset: 4,
        directives: [safeSniper(enemySpawn)] },
    ]],
    fallbackRegion: 'mid',
    aggressionMod: STRATEGY_MODS.Rotate_Stack.aggression,
    retreatThresholdMod: STRATEGY_MODS.Rotate_Stack.retreatThreshold,
    complianceThreshold: STRATEGY_MODS.Rotate_Stack.complianceThreshold,
  },
];

// --- Map-specific defenses -------------------------------------------------
// Mid Control — a LARGE-MAP defense. On a big layout an even split (Hold) is too
// thin and can't reinforce across the long A↔B rotation, so attackers win the
// force-concentration race. Mid Control instead garrisons the central rotation
// hub with three (one positioned toward each site + a central sniper) and leaves
// one tripwire anchor on each site; the hub collapses onto whichever site the
// anchor makes contact at, winning the man-count at the point of contact from a
// shorter, central distance than a cross-map rotation. Single variant (the play
// is site-agnostic — it reacts to the read rather than pre-committing).
const MID_CONTROL: Strategy = {
  id: 'Mid_Control', name: 'Mid Control', side: 'defender',
  description: 'Hold the center, collapse on contact — three garrison the central rotation hub (one leaning each site, sniper on the choke) while one tripwire anchors each site. Whichever site is hit, the hub floods it from short range. Built for large maps where an even split can\'t reinforce in time.',
  variants: [[
    // The two site tripwires — hold their entry, trigger the collapse on contact.
    { id: 'a_anchor', pick: rifle,      region: 'a_anchor', anchorOffset: 1,
      directives: [holdAngle(reg('a_entry'))] },
    { id: 'b_anchor', pick: rifle,      region: 'b_anchor', anchorOffset: 1,
      directives: [holdAngle(reg('b_entry'))] },
    // The hub — three hold the center, each collapses to whichever site contacts.
    // mid_off leans toward A (top), mid_anchor leans toward B (bottom) so each
    // site has a near reinforcer; the sniper holds the central choke long lane.
    { id: 'hub_a',    pick: rifle,      region: 'mid_off',
      directives: [rotateOnContact(reg('a_site'), ['a_anchor'], 2),
                   rotateOnContact(reg('b_site'), ['b_anchor'], 2),
                   holdAngle(reg('a_main_near')), tradeFor('a_anchor', 4)] },
    { id: 'hub_b',    pick: rifle,      region: 'mid_anchor',
      directives: [rotateOnContact(reg('b_site'), ['b_anchor'], 2),
                   rotateOnContact(reg('a_site'), ['a_anchor'], 2),
                   holdAngle(reg('b_main_near')), tradeFor('b_anchor', 4)] },
    { id: 'hub_mid',  pick: sniperPref, region: 'mid_choke', anchorOffset: 4,
      directives: [rotateOnContact(reg('a_site'), ['a_anchor'], 2),
                   rotateOnContact(reg('b_site'), ['b_anchor'], 2),
                   safeSniper(enemySpawn)] },
  ]],
  fallbackRegion: 'mid',
  aggressionMod: STRATEGY_MODS.Mid_Control.aggression,
  retreatThresholdMod: STRATEGY_MODS.Mid_Control.retreatThreshold,
  complianceThreshold: STRATEGY_MODS.Mid_Control.complianceThreshold,
};

// v0.28.0 — one consolidated, rich-vocab strategy set for every map. The live
// maps (Foundryv2 / Atoll_v2 / Canyon) share it; the retired v1 maps point here
// too (they're out of the picker). Map-specific native sets can be dropped in
// per map name later if a layout's balance needs it.
const ALL_STRATEGIES = [...ATK, ...DEF];
const BY_MAP: Record<MapDefinition['name'], Strategy[]> = {
  Foundry: ALL_STRATEGIES,
  Atoll: ALL_STRATEGIES,
  Canyon: ALL_STRATEGIES,
  Foundryv2: ALL_STRATEGIES,
  Atoll_v2: ALL_STRATEGIES,
  Foundryv3: ALL_STRATEGIES,
  // Foundry IV (large/diagonal) swaps the shared mid-stack Pressure — which is
  // structurally broken on a large map (mass-mid can't reinforce the far sites in
  // time; measured 28% def) — for MID_CONTROL, a scale-fit central-garrison defense
  // that holds the rotation hub and collapses onto the contacted site (45% def, the
  // Control-counter). Pressure stays available on every other (smaller) map, where
  // it's healthy. Mid Control kept map-specific pending a wider viability check.
  Foundryv4: [...ALL_STRATEGIES.filter((s) => s.id !== 'Pressure'), MID_CONTROL],
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

// v0.27.0 — lateral (column) shift, used by the Warden crossfire fan to fan
// same-site holders across columns so their cones onto the choke diverge.
// Side-agnostic (a column offset reads the same for both teams). Snaps to the
// nearest passable hex; returns the input unchanged when the shift is 0.
export function applyLateralOffset(
  hex: HexCoord,
  cols: number,
  map: MapDefinition,
): HexCoord {
  if (cols === 0) return hex;
  const want: HexCoord = { col: clamp(hex.col + cols, 0, map.width - 1), row: hex.row };
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
