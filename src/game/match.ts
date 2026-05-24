// Pass 7 — match flow helpers (spec §17). Manages round lifecycle: reposition
// units to their team's current-side spawn at the start of every round, apply
// the chosen strategy at Begin Round, award scores at round end, and swap
// sides at halftime.

import type {
  AiState,
  Buff,
  GameState,
  GhostEntry,
  HexCoord,
  MoveState,
  PlayedCard,
  Team,
  TeamDeck,
  TrackEntry,
  Unit,
} from './types.ts';
import { initialAi } from './state.ts';
import { blankMove } from './movement.ts';
import { computeVisibility } from './vision.ts';
import { regionCentroid, strategyById } from './strategies.ts';
import { applyCards } from './cardEffects.ts';
import { discardPlayed, drawCards } from './cards.ts';
import {
  HALFTIME_AFTER_ROUND,
  MATCH_ROUND_COUNT,
  MATCH_WIN_SCORE,
  ROLE_AGGRESSION,
  UNIT_DEFAULTS,
} from './config.ts';
import { createRng, type Rng } from './rng.ts';

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
    const fresh: Unit = {
      ...u,
      pos: { ...pos },
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
    aiStrategy: null,
    roundResult: null,
    // Pass 8: card picks reset per round; deck/hand/discard persist (spec).
    playedCard: { defenders: null, attackers: null },
    cardEffects: [],
    // events accumulate across rounds (kill feed survives) — do NOT clear here.
  };
  const { visibility } = computeVisibility(seed);
  return { ...seed, visibility };
}

// Resolve both teams' picks into per-unit targets + aggression/retreat mods,
// then transition to resolution. Rush/Stack pick a variant via the seeded RNG.
export function applyStrategies(
  state: GameState,
  playerTeam: Team,
  playerStrategyId: string,
  aiTeam: Team,
  aiStrategyId: string,
  rng: Rng,
): GameState {
  const playerSide = state.teamSide[playerTeam];
  const aiSide = state.teamSide[aiTeam];
  const playerStrat = strategyById(playerStrategyId, playerSide, state.map);
  const aiStrat = strategyById(aiStrategyId, aiSide, state.map);
  if (!playerStrat || !aiStrat) return state;

  const playerVariant = playerStrat.variants[rng.int(playerStrat.variants.length)];
  const aiVariant = aiStrat.variants[rng.int(aiStrat.variants.length)];

  const nextUnits: Unit[] = [];
  const nextTargets: Record<string, HexCoord | null> = { ...state.targets };
  for (const u of state.units) {
    const isPlayer = u.team === playerTeam;
    const strat = isPlayer ? playerStrat : aiStrat;
    const variant = isPlayer ? playerVariant : aiVariant;
    const regionName = variant[u.role] ?? strat.fallbackRegion;
    const goal = regionCentroid(state.map, regionName);
    nextTargets[u.id] = goal;
    nextUnits.push({
      ...u,
      modifiers: {
        ...u.modifiers,
        aggression: Math.max(0, Math.min(100, ROLE_AGGRESSION[u.role] + strat.aggressionMod)),
        retreatThresholdMod: strat.retreatThresholdMod,
      },
    });
  }
  return {
    ...state,
    phase: 'resolution',
    units: nextUnits,
    targets: nextTargets,
    playerStrategy: playerStrategyId,
    aiStrategy: aiStrategyId,
  };
}

// Pass 8 — set each team's played card on the state, then run the card
// handlers (directive cards override strategy targets, buffs/utility register
// effects/flags). Called after applyStrategies during Begin Round.
export function commitCards(
  state: GameState,
  playerTeam: Team,
  playerCard: PlayedCard | null,
  aiTeam: Team,
  aiCard: PlayedCard | null,
  rng: Rng,
): GameState {
  const playedCard: Record<Team, PlayedCard | null> = {
    ...state.playedCard,
    [playerTeam]: playerCard,
    [aiTeam]: aiCard,
  };
  return applyCards({ ...state, playedCard }, rng);
}

// Pass 8 — at round end, move each team's played card into discard and draw
// back up to the hand cap. Deck/hand persist across rounds and halftime.
export function processCardsAtRoundEnd(state: GameState, seed: number, round: number): GameState {
  const next = { ...state };
  for (const team of ['defenders', 'attackers'] as const) {
    const played = state.playedCard[team];
    let deck = state.cards[team];
    if (played) {
      deck = discardPlayed(deck, { defId: played.defId, contributor: played.contributor });
    }
    const drawRng = createRng((seed ^ round ^ (team === 'defenders' ? 0xd00d : 0xa11a)) >>> 0);
    deck = drawCards(deck, 1, drawRng);
    next.cards = { ...next.cards, [team]: deck };
  }
  return next;
}

// Convenience used by the loop: which team is the AI?
export function aiTeamFor(playerTeam: Team): Team {
  return playerTeam === 'defenders' ? 'attackers' : 'defenders';
}

// Re-export for backward compat (some callers expect a single entry point).
export type { TeamDeck };

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
  if (aliveDef === 0 && aliveAtk === 0) return defenderTeam(state);
  if (aliveDef === 0 && aliveAtk > 0) return 'attackers';
  if (aliveAtk === 0 && aliveDef > 0) return 'defenders';
  return null;
}

// The team currently playing the defender side this half. Used for time-out
// and 0v0 tie-break rules.
export function defenderTeam(state: GameState): Team {
  return state.teamSide.defenders === 'defender' ? 'defenders' : 'attackers';
}

// Award the round to a winner team and decide the next match state: another
// round, halftime swap, or match end. AI win-rate tracking is updated by the
// host via `recordStrategyWin` (the host knows which team is AI-controlled).
export function endRound(state: GameState, winner: Team | 'draw'): GameState {
  const scores = { ...state.scores };
  if (winner !== 'draw') scores[winner]++;

  const next: GameState = {
    ...state,
    scores,
    roundResult: { winner },
    playback: { ...state.playback, playing: false },
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
