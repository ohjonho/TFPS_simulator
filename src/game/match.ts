// Match flow helpers (spec §1, §9). Manages the round lifecycle:
//
// - `startRound` — reposition units to their team's current-side spawn,
//   restore HP / state / facing, reset AI / move / buffs / tracking /
//   ghosts / plant / cardEffects, recompute initial visibility, mark
//   phase 'planning'.
// - `applyStrategies` — picks the strategy variant + assigns units to
//   slots; resolves region-named DirectiveSpecs to concrete HexCoords;
//   sets `targets` / `directives` / aggression + retreat mods; runs the
//   hero-passive synergies (Guardian Aura / Tactical Scan / Mark Target);
//   marks phase 'resolution'.
// - `endRound` — bumps score, updates AI strategy win-tracker, sets
//   `roundResult`. Checks match-end (`MATCH_WIN_SCORE`).
// - `halftimeSwap` — flips `state.teamSide` entries; `startRound` then
//   spawns each team at its new side's spawn.
// - `eliminationWinner` — checks team alive counts; post-plant mutual
//   annihilation awards attackers (planting was the win condition).
// - `defenderTeam` — whichever team currently holds the 'defender' side.

import type {
  AiState,
  Buff,
  GameState,
  GhostEntry,
  HexCoord,
  MoveState,
  Side,
  Team,
  TrackEntry,
  Unit,
} from './types.ts';
import { initialAi } from './state.ts';
import { blankMove } from './movement.ts';
import { computeVisibility } from './vision.ts';
import { applyAnchorOffset, applyLateralOffset, assignSlots, regionCentroid, strategyById, weaponAdjustedTarget } from './strategies.ts';
import { resolveDirectiveSpec, type ResolutionContext } from './directives.ts';
import type { Directive } from './types.ts';
// H3.4 — cardEffects.ts + cards.ts removed; their behaviors migrated to
// strategy + hero synergies in applyStrategies (H3.3).
import {
  ATTACKER_APPRAISAL,
  ATTACKER_SITE_APPRAISAL_ENABLED,
  SCOUTING,
  SCOUTING_ENABLED,
  SCOUTING_DEFENDER_LEAN_OVERRIDE,
  STRATEGY_LEAN,
  OPPONENT_LEAN,
  CROSSFIRE_SPREAD_COLS,
  HALFTIME_AFTER_ROUND,
  HERO_ABILITIES_ENABLED,
  MATCH_ROUND_COUNT,
  MATCH_WIN_SCORE,
  ROLE_AGGRESSION,
  ROLE_PROFILE,
  UNIT_DEFAULTS,
} from './config.ts';
import { siteAttackDifficulty } from './threat.ts';
import type { StrategyVariant } from './strategies.ts';
import { hexDistance } from './hex.ts';
import { placeSpawns } from './units.ts';
import type { Rng } from './rng.ts';

// Strategy-aware spawn placement (SPAWN_PLACEMENT). DEFENDERS ONLY: the
// row-major generic spawn already drops attackers at the forward edge of their
// zone but defenders at the BACK edge, so only defenders start sub-optimally.
// Each defender takes the spawn-zone cell nearest where its strategy sends it
// (`targets[u.id]`) — closing the approach to its hold. Measured: optimizing
// attackers too just speeds their plant-rush and tips balanced maps, while this
// asymmetric form gives defenders the gain without that side effect. Pure +
// deterministic: nearest by hex distance; ties resolve to the pool's row-major-
// earliest cell (strict <); one cell per unit, greedy in team order; a unit
// with no target takes the first free cell. Returns unitId → spawn hex.
function optimizeSpawns(
  teamUnits: readonly Unit[],
  targets: Record<string, HexCoord | null>,
  pool: readonly HexCoord[],
): Record<string, HexCoord> {
  const out: Record<string, HexCoord> = {};
  const used = new Set<string>();
  for (const u of teamUnits) {
    const t = targets[u.id];
    let best: HexCoord | null = null;
    let bestD = Infinity;
    for (const cell of pool) {
      const k = `${cell.col},${cell.row}`;
      if (used.has(k)) continue;
      const d = t ? hexDistance(cell, t) : 0;
      if (d < bestD) { bestD = d; best = cell; }
    }
    if (best) { out[u.id] = best; used.add(`${best.col},${best.row}`); }
  }
  return out;
}

// Returns the spawn list this team should occupy this round, based on its
// current side (attacker → attackers spawns, defender → defenders spawns).
function spawnsFor(state: GameState, team: Team): HexCoord[] {
  const side = state.teamSide[team];
  const key = side === 'attacker' ? 'attackers' : 'defenders';
  return state.map.spawns[key];
}

// Restore every unit to its team's current-side spawn with full HP, fresh AI/
// move/buff state. Called at the start of every round and after halftime swap.
export function startRound(state: GameState): GameState {
  const nextUnits: Unit[] = [];
  const nextMoves: Record<string, MoveState> = {};
  const nextAi: Record<string, AiState> = {};
  const nextTargets: Record<string, HexCoord | null> = {};
  const nextBuffs: Record<string, Buff[]> = {};
  const nextTracking: Record<string, TrackEntry | null> = {};
  const nextPrevPos: Record<string, HexCoord> = {};

  // Fan each team across its current-side spawn zone (placeSpawns) — same
  // deterministic placement createTeam uses, so round transitions match.
  const teamCounts: Record<Team, number> = { defenders: 0, attackers: 0 };
  for (const u of state.units) teamCounts[u.team]++;
  const teamPositions: Record<Team, HexCoord[]> = {
    defenders: placeSpawns(spawnsFor(state, 'defenders'), teamCounts.defenders, state.teamSide.defenders === 'defender' ? 1 : -1),
    attackers: placeSpawns(spawnsFor(state, 'attackers'), teamCounts.attackers, state.teamSide.attackers === 'defender' ? 1 : -1),
  };
  const teamIndex: Record<Team, number> = { defenders: 0, attackers: 0 };
  for (const u of state.units) {
    const idx = teamIndex[u.team]++;
    const pos = teamPositions[u.team][idx];
    // Pass E2 — reset facing per the unit's CURRENT side so the spawn-frame
    // cone points at the enemy half after halftime. Defenders (top half)
    // look down via facing 5 (SE); attackers (bottom half) look up via
    // facing 1 (NE). Matches the constants in src/game/units.ts. Without
    // this reset, the post-halftime defender team kept its pre-swap facing
    // (looking south) even though it had moved to the south spawn.
    const facing: 0 | 1 | 2 | 3 | 4 | 5 = state.teamSide[u.team] === 'defender' ? 5 : 1;
    const fresh: Unit = {
      ...u,
      pos: { ...pos },
      facing,
      hp: UNIT_DEFAULTS.maxHp,
      maxHp: UNIT_DEFAULTS.maxHp,  // Pass 8: Guardian Aura may bump per-round.
      state: 'alive',
      // Reset modifiers that strategy/round will set; preserve aggression base
      // (will be overwritten by applyStrategies). Off-position persists for the
      // whole match per spec; retreatThresholdMod is per-round.
      modifiers: {
        ...u.modifiers,
        aggression: ROLE_AGGRESSION[u.role],
        baseAggression: ROLE_AGGRESSION[u.role],
        retreatThresholdMod: 0,
      },
      // Pass 8: all card flags are per-round — clear at round start.
      cardFlags: {},
      // Pass 9: directives are per-round; populated by applyStrategies/commitCards.
      directives: [],
    };
    nextUnits.push(fresh);
    nextMoves[u.id] = blankMove(fresh.pos);
    nextAi[u.id] = initialAi();
    nextTargets[u.id] = null;
    nextBuffs[u.id] = [];
    nextTracking[u.id] = null;
    nextPrevPos[u.id] = fresh.pos;
  }
  const nextGhosts: Record<Team, Record<string, GhostEntry>> = {
    defenders: {}, attackers: {},
  };

  const seed: GameState = {
    ...state,
    phase: 'planning',
    units: nextUnits,
    moves: nextMoves,
    targets: nextTargets,
    ai: nextAi,
    buffs: nextBuffs,
    tracking: nextTracking,
    prevPos: nextPrevPos,
    ghosts: nextGhosts,
    beliefs: { defenders: [], attackers: [] },
    visibility: { defenders: new Set(), attackers: new Set() },
    tick: 0,
    playback: { ...state.playback, playing: false },
    playerStrategy: null,
    playerVariantChoice: null,
    aiStrategy: null,
    roundResult: null,
    // H3.4 — card playedCard removed; cardEffects still reset per round
    // (populated by applyStrategies with strategy synergies + hero passives).
    cardEffects: [],
    // Pass B: plant state is per-round; prev-visibility wiped so first-sight
    // penalty applies on tick 0 (everyone "first sees" what they see).
    plant: { planted: null, planting: null, defusing: null },
    prevPerUnitVisible: {},
    // events accumulate across rounds (kill feed survives) — do NOT clear here.
  };
  const { visibility } = computeVisibility(seed);
  return { ...seed, visibility };
}

// Which bomb site a variant commits to, by the majority of its plant-region
// slots ('a_plant' vs 'b_plant'). Null when neither dominates (single-lane /
// no-plant variants) → caller falls back to a uniform pick. Robust to fakes:
// Mind Games' REAL slots target the true plant, so the shown site doesn't win.
function variantCommitSite(variant: StrategyVariant): 'A' | 'B' | null {
  let a = 0;
  let b = 0;
  for (const slot of variant) {
    if (slot.region === 'a_plant') a++;
    else if (slot.region === 'b_plant') b++;
  }
  if (a > b) return 'A';
  if (b > a) return 'B';
  return null;
}

// Pick a variant index from per-variant weights using one pre-drawn float in
// [0,1). With uniform weights this equals `rng.int(len)` exactly, so a disabled
// appraisal/scouting layer is byte-identical to the old coin flip.
function weightedIndex(weights: readonly number[], roll: number): number {
  const total = weights.reduce((s, w) => s + w, 0);
  let acc = roll * total;
  for (let i = 0; i < weights.length; i++) {
    acc -= weights[i];
    if (acc < 0) return i;
  }
  return weights.length - 1;
}

// Deterministic per-roster lean toward variant 0 (the defender's scoutable
// "tell"), clamped to [lo, hi]. Same roster → same lean every match; flat
// rosters → a fixed (still scoutable) lean. FNV-ish hash over stable attrs.
function rosterVariantLean(teamUnits: readonly Unit[]): number {
  let h = 2166136261;
  for (const u of teamUnits) {
    const a = u.attributes;
    h = Math.imul(h ^ (a.aim + 7 * a.mapIQ + 13 * a.composure + 17 * a.tenacity), 16777619);
  }
  const f = ((h >>> 0) % 1000) / 1000;
  return SCOUTING.defenderLeanLo + (SCOUTING.defenderLeanHi - SCOUTING.defenderLeanLo) * f;
}

// Per-variant pick weights for a team. ATTACKER: static site difficulty (easier
// favored) × the cross-round scouting read of the ENEMY (under-defended site
// favored). DEFENDER: roster-derived lean toward variant 0 (the scoutable tell).
// Uniform when the relevant flags are off / single-variant → byte-identical pick.
function variantWeights(strat: { id: string; variants: StrategyVariant[] }, team: Team, side: Side, state: GameState): number[] {
  const n = strat.variants.length;
  const uniform = strat.variants.map(() => 1);
  if (n <= 1) return uniform;
  // Campaign opponent site lean: when this team is running its leaned strategy,
  // bias its A/B variant strongly toward the preferred site, so the scouted read
  // ("they Rush A") is reliable rather than a 50/50 site guess.
  const lean = state.opponentLean?.[side];
  if (lean && lean.site && strat.id === lean.strategy) {
    return strat.variants.map((v) => (variantCommitSite(v) === lean.site ? OPPONENT_LEAN.siteWeight : 1));
  }
  if (side === 'attacker') {
    if (!ATTACKER_SITE_APPRAISAL_ENABLED && !SCOUTING_ENABLED) return uniform;
    const enemy: Team = team === 'defenders' ? 'attackers' : 'defenders';
    const scout = state.scouting[enemy];
    const scoutTotal = scout.a + scout.b;
    return strat.variants.map((v) => {
      const cs = variantCommitSite(v);
      if (!cs) return 1;
      // Static base: favor the statically-easier site.
      let w = Math.max(0.05, 1 - ATTACKER_APPRAISAL.bias * siteAttackDifficulty(state.map, cs));
      // Scouting: favor the site the enemy has UNDER-defended.
      if (SCOUTING_ENABLED && scoutTotal > 0) {
        const enemyLean = (cs === 'A' ? scout.a : scout.b) / scoutTotal;
        w *= Math.max(0.05, 1 - SCOUTING.attackerExploitBias * enemyLean);
      }
      return w;
    });
  }
  // Defender tendency (only A/B-variant defenses have a site). The test override
  // forces the lean even with scouting off, so an A/B can isolate the attacker's
  // exploit (defender leans the same in both arms).
  if ((SCOUTING_ENABLED || SCOUTING_DEFENDER_LEAN_OVERRIDE !== null) && n === 2) {
    const lean0 = SCOUTING_DEFENDER_LEAN_OVERRIDE ?? rosterVariantLean(state.units.filter((u) => u.team === team));
    return [lean0, 1 - lean0];
  }
  return uniform;
}

// Resolve both teams' picks into per-unit targets + aggression/retreat mods,
// then transition to resolution. Rush/Stack pick a variant via the seeded
// RNG by default; Pass C — `playerVariantIdx` lets the caller override the
// player team's variant (player explicitly picks A or B in the UI). AI's
// variant still goes through the seeded RNG.
//
// Determinism note: AI variant is drawn FIRST so swapping the player's
// explicit choice for an RNG draw (or vice-versa) doesn't shift the AI's
// RNG position. Same seed + same player variant choice → identical AI pick.
export function applyStrategies(
  state: GameState,
  playerTeam: Team,
  playerStrategyId: string,
  aiTeam: Team,
  aiStrategyId: string,
  rng: Rng,
  playerVariantIdx: number | null = null,
  aiVariantIdx: number | null = null,
): GameState {
  const playerSide = state.teamSide[playerTeam];
  const aiSide = state.teamSide[aiTeam];
  const playerStrat = strategyById(playerStrategyId, playerSide, state.map);
  const aiStrat = strategyById(aiStrategyId, aiSide, state.map);
  if (!playerStrat || !aiStrat) return state;

  // AI first → its RNG position is stable across player variant choices. The AI
  // draw is always consumed; `aiVariantIdx` only overrides WHICH variant is used
  // (harness seam). The pick is weighted by side (variantWeights): an attacker
  // appraises site difficulty + reads the enemy's scouted tendency; a defender
  // leans by roster. Uniform weights (flags off / single variant) reproduce the
  // old coin flip exactly, so disabled = byte-identical.
  const aiVariantDraw = weightedIndex(variantWeights(aiStrat, aiTeam, aiSide, state), rng.next());
  const aiVariantIndex =
    aiVariantIdx !== null && aiVariantIdx >= 0 && aiVariantIdx < aiStrat.variants.length
      ? aiVariantIdx
      : aiVariantDraw;
  const aiVariant = aiStrat.variants[aiVariantIndex];
  // Player team: an explicit UI pick wins; otherwise a same-weighted draw — so an
  // AI-vs-AI match (runMatch) gives BOTH teams the smart pick. One draw only when
  // not overridden, preserving the AI-first RNG order.
  const playerVariantIndex =
    playerVariantIdx !== null && playerVariantIdx >= 0 && playerVariantIdx < playerStrat.variants.length
      ? playerVariantIdx
      : weightedIndex(variantWeights(playerStrat, playerTeam, playerSide, state), rng.next());
  const playerVariant = playerStrat.variants[playerVariantIndex];

  // Pass A strategy review — slot-based assignment. For each team, walk the
  // chosen variant's slots and greedily pick which actual unit on the team
  // fills each slot, preferring loadout matches. Build slot id → unit id +
  // unit id → slot lookup tables so directives can resolve ally references
  // and slot plans can be applied per-unit below.
  const playerTeamUnits = state.units.filter((u) => u.team === playerTeam);
  const aiTeamUnits = state.units.filter((u) => u.team === aiTeam);
  const playerSlotsToUnit = assignSlots(playerVariant, playerTeamUnits);
  const aiSlotsToUnit = assignSlots(aiVariant, aiTeamUnits);
  // Reverse map: unit id → slot index in its team's variant (-1 if unassigned).
  const unitToSlotIdx: Record<string, number> = {};
  for (let i = 0; i < playerVariant.length; i++) {
    const uid = playerSlotsToUnit[playerVariant[i].id];
    if (uid) unitToSlotIdx[uid] = i;
  }
  for (let i = 0; i < aiVariant.length; i++) {
    const uid = aiSlotsToUnit[aiVariant[i].id];
    if (uid) unitToSlotIdx[uid] = i;
  }

  // v0.27.0 — crossfire grouping (Pass 1). Group same-team, same-region Warden
  // holders so each fans laterally by index (i of n) → divergent angles onto the
  // choke, and never collapse onto one hex. Deterministic: units + groups in
  // declaration order. Recomputes each Warden's region the same way the loop does.
  const crossfireIndex: Record<string, { i: number; n: number }> = {};
  {
    const groups: Record<string, string[]> = {};
    for (const u of state.units) {
      if (!ROLE_PROFILE[u.role][state.teamSide[u.team]].crossfire) continue;
      const variant = u.team === playerTeam ? playerVariant : aiVariant;
      const strat = u.team === playerTeam ? playerStrat : aiStrat;
      const slotIdx = unitToSlotIdx[u.id];
      const region = (slotIdx !== undefined ? variant[slotIdx]?.region : undefined) ?? strat.fallbackRegion;
      (groups[`${u.team}|${region}`] ??= []).push(u.id);
    }
    for (const ids of Object.values(groups)) ids.forEach((id, i) => { crossfireIndex[id] = { i, n: ids.length }; });
  }

  const nextUnits: Unit[] = [];
  const nextTargets: Record<string, HexCoord | null> = { ...state.targets };
  for (const u of state.units) {
    const isPlayer = u.team === playerTeam;
    const strat = isPlayer ? playerStrat : aiStrat;
    const variant = isPlayer ? playerVariant : aiVariant;
    const slotsToUnitIds = isPlayer ? playerSlotsToUnit : aiSlotsToUnit;
    const slotIdx = unitToSlotIdx[u.id];
    const slot = slotIdx !== undefined ? variant[slotIdx] : undefined;
    const regionName = slot?.region ?? strat.fallbackRegion;
    const goal = regionCentroid(state.map, regionName);
    // Pass 8 — weapon-aware position adjustment. Snipers held back, shotguns
    // pushed forward. Skipped when no centroid (degenerate map) or when a
    // card directive (Anchor / Hold the Line / Setup Play) overrides via
    // commitCards downstream.
    const side = state.teamSide[u.team];
    let adjusted = goal ? weaponAdjustedTarget(goal, u, side, state.map) : null;
    // Pass 9 — apply the per-slot anchor offset on top of weapon adjustment.
    if (adjusted && slot?.anchorOffset) {
      adjusted = applyAnchorOffset(adjusted, slot.anchorOffset, side, state.map);
    }
    // v0.27.0 — role micro-position ON TOP of the slot: deep (Warden) / forward
    // (Vanguard) via applyAnchorOffset, then the Warden crossfire lateral fan so
    // same-site Wardens diverge instead of stacking.
    if (adjusted) {
      const rp = ROLE_PROFILE[u.role][side];
      if (rp.positionOffset !== 0) {
        adjusted = applyAnchorOffset(adjusted, rp.positionOffset, side, state.map);
      }
      const cf = crossfireIndex[u.id];
      if (rp.crossfire && cf && cf.n > 1) {
        const cols = Math.round((cf.i - (cf.n - 1) / 2) * CROSSFIRE_SPREAD_COLS);
        adjusted = applyLateralOffset(adjusted, cols, state.map);
      }
    }
    nextTargets[u.id] = adjusted;

    // Pass 9 — resolve this slot's DirectiveSpecs into concrete Directives.
    // Specs that can't be resolved (e.g. ally slot not filled this round) are
    // dropped.
    const ctx: ResolutionContext = {
      map: state.map,
      side,
      slotsToUnitIds,
    };
    const directives: Directive[] = [];
    for (const spec of slot?.directives ?? []) {
      const resolved = resolveDirectiveSpec(spec, ctx);
      if (resolved) directives.push(resolved);
    }

    // Pass A strategy review — `usePerimeterPath` on the slot tells the tick
    // loop to A*-route this unit along the map edges instead of the shortest
    // centerline path. Reuses the same `cardFlags.slowFlank` flag the Slow
    // Flank card sets (identical routing behavior; the flag's name is
    // card-historical but the mechanism is generic).
    let cardFlags = slot?.usePerimeterPath
      ? { ...u.cardFlags, slowFlank: true }
      : { ...u.cardFlags };

    // H3.3 — apply trait + strategy synergy flags. These migrate the
    // 5 surviving card behaviors (Reckless Push, Anchor Position, Slow
    // Flank, Spearhead, Crossfire, Trade Window) into always-on effects
    // gated by the team's chosen strategy + each unit's trait. Combat
    // hooks in combat.ts already read these `cardFlags` keys; we're just
    // changing what populates them.
    cardFlags = applyTraitStrategySynergies(cardFlags, u, strat.id);

    nextUnits.push({
      ...u,
      modifiers: {
        ...u.modifiers,
        aggression: Math.max(0, Math.min(100, ROLE_AGGRESSION[u.role] + strat.aggressionMod)),
        baseAggression: Math.max(0, Math.min(100, ROLE_AGGRESSION[u.role] + strat.aggressionMod)),
        retreatThresholdMod: strat.retreatThresholdMod,
      },
      directives,
      cardFlags,
    });
  }

  // Strategy-aware spawn placement: relocate each unit to the spawn-zone cell
  // nearest its resolved target, then refresh its move/prevPos so the sim
  // doesn't read the relocation as a tick-1 teleport. Per team (each uses its
  // current side's spawn pool). Off → units keep startRound's first-N cells.
  let placedUnits = nextUnits;
  const nextMoves = { ...state.moves };
  const nextPrevPos = { ...state.prevPos };
  if (state.map.optimizeSpawns) {
    const posById: Record<string, HexCoord> = {};
    for (const team of [playerTeam, aiTeam]) {
      // Only the defending side optimizes — attackers already spawn forward.
      if (state.teamSide[team] !== 'defender') continue;
      const teamUnits = nextUnits.filter((u) => u.team === team);
      Object.assign(posById, optimizeSpawns(teamUnits, nextTargets, state.map.spawns.defenders));
    }
    placedUnits = nextUnits.map((u) => {
      const p = posById[u.id];
      if (!p) return u;
      nextMoves[u.id] = blankMove(p);
      nextPrevPos[u.id] = { ...p };
      return { ...u, pos: { ...p } };
    });
  }

  // H3.3 — always-on hero passive effects. Each hero on the roster
  // contributes one entry to cardEffects regardless of any card being
  // played (Angelic → guardian aura, Techy → tactical scan at round start,
  // Cursed → mark-on-first-spot trigger flag set per unit above). Builds a
  // fresh list per round; H3.4 will drop the cards-on-top layer entirely.
  const heroEffects = computeHeroPassiveEffects(placedUnits, state.tick);

  // Cross-round scouting: record which site the DEFENDER set up on this round —
  // its resolved holds bucketed by a_site/b_site (mid holds are neutral) —
  // decayed into the per-team tally so next round's attacker reads the enemy's
  // entry. Only when enabled (else scouting stays inert). A balanced Hold records
  // ~0.5/0.5; a fake (Mind Games) records its shown setup, faithfully neutral.
  let nextScouting = state.scouting;
  if (SCOUTING_ENABLED) {
    const defTeam: Team | null =
      state.teamSide[playerTeam] === 'defender' ? playerTeam
      : state.teamSide[aiTeam] === 'defender' ? aiTeam : null;
    if (defTeam) {
      const aCells = new Set((state.map.regions['a_site'] ?? []).map((h) => `${h.col},${h.row}`));
      const bCells = new Set((state.map.regions['b_site'] ?? []).map((h) => `${h.col},${h.row}`));
      let ca = 0;
      let cb = 0;
      for (const u of placedUnits) {
        if (u.team !== defTeam) continue;
        const t = nextTargets[u.id];
        if (!t) continue;
        const k = `${t.col},${t.row}`;
        if (aCells.has(k)) ca++;
        else if (bCells.has(k)) cb++;
      }
      const tot = ca + cb;
      if (tot > 0) {
        const prev = state.scouting[defTeam];
        nextScouting = {
          ...state.scouting,
          [defTeam]: { a: SCOUTING.decay * prev.a + ca / tot, b: SCOUTING.decay * prev.b + cb / tot },
        };
      }
    }
  }

  // Cross-round strategy lean (for the pre-round Scout): decay each team's prior
  // picks and add this round's pick (+1). Always recorded — read-only data the
  // Scout UI surfaces; nothing in the sim acts on it, so determinism holds.
  const bump = (lean: Record<string, number>, id: string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const k in lean) out[k] = lean[k] * STRATEGY_LEAN.decay;
    out[id] = (out[id] ?? 0) + 1;
    return out;
  };
  const nextStrategyLean = {
    ...state.strategyLean,
    [playerTeam]: bump(state.strategyLean[playerTeam], playerStrategyId),
    [aiTeam]: bump(state.strategyLean[aiTeam], aiStrategyId),
  };

  return {
    ...state,
    phase: 'resolution',
    units: placedUnits,
    targets: nextTargets,
    moves: nextMoves,
    prevPos: nextPrevPos,
    playerStrategy: playerStrategyId,
    aiStrategy: aiStrategyId,
    cardEffects: heroEffects,
    scouting: nextScouting,
    strategyLean: nextStrategyLean,
  };
}

// Per-unit round-start synergy flags. v0.28.0 — the old trait+strategy synergy
// branches all keyed off retired trait-unlock strategies and were removed with
// them (Pass 7 deleted the leftover STRATEGY_MODS entries too). Hero arming is
// the only per-unit round-start synergy now; the trait reworks (Pass 2b) own the
// rest of the synergy story. `strategyId` is kept on
// the signature for the upcoming hero/trait passes.
function applyTraitStrategySynergies(
  flags: import('./types.ts').CardFlags,
  unit: Unit,
  strategyId: string,
): import('./types.ts').CardFlags {
  void strategyId;
  // Pass 5 — hero-neutral measurement toggle: skip arming entirely when off.
  if (!HERO_ABILITIES_ENABLED) return flags;
  // Pass 3 — arm each hero's once-per-round active + weak passive at round start.
  //   Cursed → Mark Target (markTargetPending; fires on first enemy spotted) +
  //            hunterBonus weak passive (flat self +HR, read in combat).
  //   Angelic/Techy → heroActivePending; the trigger condition differs by hero
  //            (Angelic rally fires in tick.ts's death loop on first ally death;
  //            Techy scan fires on the team's first enemy contact).
  if (unit.hero === 'Cursed') {
    flags = { ...flags, markTargetPending: true, hunterBonus: true };
  } else if (unit.hero === 'Angelic' || unit.hero === 'Techy' || unit.hero === 'Bulwark') {
    // Angelic Field Medic (first wounded ally), Techy Scan (first contact),
    // Bulwark Fortify (first damage taken) — all gated by heroActivePending;
    // the trigger condition differs by hero (handled in tick.ts).
    flags = { ...flags, heroActivePending: true };
  }
  return flags;
}

// Pass 4 — standing hero passives. Most hero identity is now in the triggered
// actives + per-unit flags (Angelic heal / Techy scan / Cursed mark+hunterBonus,
// all armed in applyTraitStrategySynergies; cone passive in vision). The only
// standing cardEffect is Bulwark's weak passive: a radius-0 guardian_aura giving
// the Bulwark itself +1 maxHP (reusing the aura's maxHp plumbing, self only).
function computeHeroPassiveEffects(
  units: readonly Unit[],
  currentTick: number,
): import('./types.ts').ActiveCardEffect[] {
  void currentTick;
  const out: import('./types.ts').ActiveCardEffect[] = [];
  if (!HERO_ABILITIES_ENABLED) return out; // Pass 5 hero-neutral toggle.
  for (const u of units) {
    if (u.state !== 'alive') continue;
    if (u.hero === 'Bulwark') {
      out.push({ kind: 'guardian_aura', team: u.team, sourceId: u.id, radius: 0 });
    }
  }
  return out;
}

// H3.4 — commitCards / processCardsAtRoundEnd removed (card system deleted).
// Strategy + trait + hero synergies set their effects directly in
// applyStrategies (cardFlags + cardEffects). No deck / hand / discard
// lifecycle to maintain anymore.

// Convenience used by the loop: which team is the AI?
export function aiTeamFor(playerTeam: Team): Team {
  return playerTeam === 'defenders' ? 'attackers' : 'defenders';
}

// True when one team has been eliminated (the round-end signal for the loop).
// Mutual annihilation (both teams at 0 alive on the same tick) awards the round
// to the team currently on the defender side — consistent with the round-timer
// rule "attackers ran out of time".
export function eliminationWinner(state: GameState): Team | null {
  let aliveDef = 0;
  let aliveAtk = 0;
  for (const u of state.units) {
    if (u.state !== 'alive') continue;
    if (u.team === 'defenders') aliveDef++;
    else aliveAtk++;
  }
  // Mutual annihilation: post-plant the spike still detonates with no
  // defuser → attackers win. Pre-plant: defender side wins the tiebreaker
  // (Pass 7.5 rule — "ran out of time" semantics).
  if (aliveDef === 0 && aliveAtk === 0) {
    return state.plant.planted ? attackerTeam(state) : defenderTeam(state);
  }
  // H3.fix1 — these elimination outcomes are decisive regardless of plant
  // state: all defenders dead → attackers win (no defuser possible, even if
  // spike isn't planted yet); all attackers dead → defenders win
  // (post-plant: defenders will walk to the spike and defuse uncontested;
  // pre-plant: standard elim). Loop.ts used to gate the entire branch on
  // `plant.planted === null`, which left planted+team-dead rounds frozen.
  if (aliveDef === 0) return 'attackers';
  if (aliveAtk === 0) return 'defenders';
  return null;
}

// The team currently playing the defender side this half. Used for time-out
// and 0v0 tie-break rules.
export function defenderTeam(state: GameState): Team {
  return state.teamSide.defenders === 'defender' ? 'defenders' : 'attackers';
}

// The team currently playing the attacker side this half. Mirror of
// defenderTeam; used by the post-plant mutual-annihilation tiebreaker.
export function attackerTeam(state: GameState): Team {
  return state.teamSide.defenders === 'defender' ? 'attackers' : 'defenders';
}

// Award the round to a winner team and decide the next match state: another
// round, halftime swap, or match end. AI win-rate tracking is updated by the
// host via `recordStrategyWin` (the host knows which team is AI-controlled).
export function endRound(state: GameState, winner: Team | 'draw'): GameState {
  const scores = { ...state.scores };
  if (winner !== 'draw') scores[winner]++;

  // Pass A5 — push a 'roundResult' event so stats.ts has a stable anchor
  // for KAST-S (survival) computation: a unit survived round N iff no
  // 'death' event with their target appears at roundIndex N.
  const roundResultEvent = {
    tick: state.tick,
    roundIndex: state.round,
    type: 'roundResult' as const,
    winner,
    ticks: state.tick,
  };

  const next: GameState = {
    ...state,
    scores,
    roundResult: { winner },
    playback: { ...state.playback, playing: false },
    events: [...state.events, roundResultEvent],
  };

  if (winner !== 'draw' && scores[winner] >= MATCH_WIN_SCORE) {
    return { ...next, matchOver: true, matchWinner: winner };
  }
  // After regular rounds with no first-to-MATCH_WIN_SCORE: sudden death is
  // deferred to Pass 9; the leader (or 'draw' at 3–3) ends the match.
  if (state.round >= MATCH_ROUND_COUNT) {
    if (scores.defenders === scores.attackers) {
      return { ...next, matchOver: true, matchWinner: 'draw' };
    }
    const leader: Team = scores.defenders > scores.attackers ? 'defenders' : 'attackers';
    return { ...next, matchOver: true, matchWinner: leader };
  }
  return next;
}

// Credit a single team's chosen strategy with a win (called by host once it
// knows which team the win belongs to and which strategy each team picked).
export function recordStrategyWin(
  state: GameState,
  team: Team,
  strategyId: string | null,
): GameState {
  if (!strategyId) return state;
  const wins = {
    defenders: { ...state.aiStrategyWins.defenders },
    attackers: { ...state.aiStrategyWins.attackers },
  };
  wins[team] = { ...wins[team], [strategyId]: (wins[team][strategyId] ?? 0) + 1 };
  return { ...state, aiStrategyWins: wins };
}

// Swap each team's side at halftime. Reposition happens in the next startRound.
export function halftimeSwap(state: GameState): GameState {
  const flipped: Record<Team, 'attacker' | 'defender'> = {
    defenders: state.teamSide.defenders === 'attacker' ? 'defender' : 'attacker',
    attackers: state.teamSide.attackers === 'attacker' ? 'defender' : 'attacker',
  };
  // Sides swap → each team's strategy pool changes, so the cross-round pick lean
  // (the Scout's read) no longer applies — a team's attacking tendencies don't
  // predict its defending ones. Reset it; the second half builds a fresh read.
  return { ...state, teamSide: flipped, strategyLean: { defenders: {}, attackers: {} } };
}

export function isHalftime(state: GameState): boolean {
  return state.round === HALFTIME_AFTER_ROUND && !state.matchOver;
}

// Advance to the next round (called by host after dismissing the round-result
// modal and, if applicable, the halftime modal).
export function advanceToNextRound(state: GameState): GameState {
  const next = { ...state, round: state.round + 1 };
  return startRound(next);
}
