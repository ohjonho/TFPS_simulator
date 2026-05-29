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
  Team,
  TrackEntry,
  Unit,
} from './types.ts';
import { initialAi } from './state.ts';
import { blankMove } from './movement.ts';
import { computeVisibility } from './vision.ts';
import { applyAnchorOffset, assignSlots, regionCentroid, strategyById, weaponAdjustedTarget } from './strategies.ts';
import { resolveDirectiveSpec, type ResolutionContext } from './directives.ts';
import type { Directive } from './types.ts';
// H3.4 — cardEffects.ts + cards.ts removed; their behaviors migrated to
// strategy + hero synergies in applyStrategies (H3.3).
import {
  CARD_EFFECTS,
  HALFTIME_AFTER_ROUND,
  MATCH_ROUND_COUNT,
  MATCH_WIN_SCORE,
  ROLE_AGGRESSION,
  UNIT_DEFAULTS,
} from './config.ts';
import type { Rng } from './rng.ts';

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

  // Index of each unit within its team for spawn assignment.
  const teamIndex: Record<Team, number> = { defenders: 0, attackers: 0 };
  for (const u of state.units) {
    const spawns = spawnsFor(state, u.team);
    const idx = teamIndex[u.team]++;
    const pos = spawns[Math.min(idx, spawns.length - 1)];
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
): GameState {
  const playerSide = state.teamSide[playerTeam];
  const aiSide = state.teamSide[aiTeam];
  const playerStrat = strategyById(playerStrategyId, playerSide, state.map);
  const aiStrat = strategyById(aiStrategyId, aiSide, state.map);
  if (!playerStrat || !aiStrat) return state;

  // AI first → its RNG position is stable across player variant choices.
  const aiVariant = aiStrat.variants[rng.int(aiStrat.variants.length)];
  const playerVariantIndex =
    playerVariantIdx !== null && playerVariantIdx >= 0 && playerVariantIdx < playerStrat.variants.length
      ? playerVariantIdx
      : rng.int(playerStrat.variants.length);
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
        retreatThresholdMod: strat.retreatThresholdMod,
      },
      directives,
      cardFlags,
    });
  }

  // H3.3 — always-on hero passive effects. Each hero on the roster
  // contributes one entry to cardEffects regardless of any card being
  // played (Angelic → guardian aura, Techy → tactical scan at round start,
  // Cursed → mark-on-first-spot trigger flag set per unit above). Builds a
  // fresh list per round; H3.4 will drop the cards-on-top layer entirely.
  const heroEffects = computeHeroPassiveEffects(nextUnits, state.tick);

  return {
    ...state,
    phase: 'resolution',
    units: nextUnits,
    targets: nextTargets,
    playerStrategy: playerStrategyId,
    aiStrategy: aiStrategyId,
    cardEffects: heroEffects,
  };
}

// H3.3 — strategy + trait synergy mapping. Each entry: if the unit has the
// listed trait AND the team's strategy id matches, set the cardFlag. Combat
// hooks unchanged — they already read these flags via the Pass 8 path; only
// the source of the flags moved from card handlers to strategy commit.
function applyTraitStrategySynergies(
  flags: import('./types.ts').CardFlags,
  unit: Unit,
  strategyId: string,
): import('./types.ts').CardFlags {
  // Sentinel + Anchor_Hold → doubles Sentinel's stationary bonus (formerly
  // the Anchor Position card).
  if (unit.behavioralTrait === 'Sentinel' && strategyId === 'Anchor_Hold') {
    flags = { ...flags, anchorPosition: true };
  }
  // Run-n-Gun + Mobile_Push → +1 speed, no retreat, +15 HR moving
  // (formerly Reckless Push card). Even non-Run-n-Gun units on Mobile_Push
  // get a smaller bump via the strategy aggression mod (already applied).
  if (unit.behavioralTrait === 'Run-n-Gun' && strategyId === 'Mobile_Push') {
    flags = { ...flags, recklessPush: true };
  }
  // Lurker + Patient_Flank → perimeter routing + invisibility-until-fire
  // (formerly Slow Flank card). slowFlank flag covers both behaviors.
  if (unit.behavioralTrait === 'Lurker' && strategyId === 'Patient_Flank') {
    flags = { ...flags, slowFlank: true, invisibleUntilFire: true };
  }
  // Entry + Coordinated_Execute → +30 HR/+15 HS first 3 engagement ticks,
  // no post-penalty (formerly Opening Pick card).
  if (unit.behavioralTrait === 'Entry' && strategyId === 'Coordinated_Execute') {
    flags = { ...flags, openingPickActive: true };
  }
  // Spearhead synergy — Vanguard role on Coordinated_Execute leads the
  // commit; allies follow 2 ticks behind (formerly Spearhead card).
  if (unit.role === 'Vanguard' && strategyId === 'Coordinated_Execute') {
    flags = { ...flags, spearhead: true };
  }
  // Trader + Crossfire_Lockdown → crossfire buff cascade on ally fire
  // (formerly Crossfire card).
  if (unit.behavioralTrait === 'Trader' && strategyId === 'Crossfire_Lockdown') {
    flags = { ...flags, crossfireEligible: true };
  }
  // Clutch + Last_Stand_Defense → trade-window mark on teammate death
  // (formerly Trade Window card).
  if (unit.behavioralTrait === 'Clutch' && strategyId === 'Last_Stand_Defense') {
    flags = { ...flags, tradeWindowEnabled: true };
  }
  // H3.3 — Cursed hero → mark-target-pending flag. The hero's passive
  // ability fires when the unit first spots an enemy this round (existing
  // Mark Target trigger in tick.ts reads this flag).
  if (unit.hero === 'Cursed') {
    flags = { ...flags, markTargetPending: true };
  }
  return flags;
}

// H3.3 — hero passives. Always-on effects derived from each unit's hero
// (no card decision required). Three heroes wired:
//   Angelic → guardian_aura (radius from CARD_EFFECTS.guardianAura)
//   Techy   → tactical_scan (lasts tacticalScan.ticks at round start)
//   Cursed  → handled per-unit via markTargetPending flag (see above)
function computeHeroPassiveEffects(
  units: readonly Unit[],
  currentTick: number,
): import('./types.ts').ActiveCardEffect[] {
  const out: import('./types.ts').ActiveCardEffect[] = [];
  for (const u of units) {
    if (u.state !== 'alive') continue;
    if (u.hero === 'Angelic') {
      out.push({
        kind: 'guardian_aura',
        team: u.team,
        sourceId: u.id,
        radius: CARD_EFFECTS.guardianAura.radius,
      });
    } else if (u.hero === 'Techy') {
      out.push({
        kind: 'tactical_scan',
        team: u.team,
        expiresAtTick: currentTick + CARD_EFFECTS.tacticalScan.ticks,
      });
    }
    // Cursed → markTargetPending flag on the unit (set in applyTraitStrategySynergies).
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
  return { ...state, teamSide: flipped };
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
