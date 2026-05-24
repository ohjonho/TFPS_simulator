// Lightweight headless AI-vs-AI batch harness. Runs seeded skirmishes (random
// attribute assignment, both teams advance to the enemy spawn and clash) and
// aggregates outcomes — to measure trait/role differentiation and, later, tune
// balance. Pure logic (no DOM); invoked from the dev `__sim` hook.
//
// Pass 9 m5 — also hosts the strategy-matrix / card-sanity / determinism
// validation helpers built on the real applyStrategies + commitCards pipeline.

import type { GameEvent, GameState, MapDefinition, PlayedCard, Team } from './types.ts';
import type { AttributeOverride } from './attributes.ts';
import { buildInitialState } from './state.ts';
import { assignAttributes } from './attributes.ts';
import { assignTarget } from './movement.ts';
import { roundFinished, stepTick } from './tick.ts';
import { createRng } from './rng.ts';
import { applyStrategies, commitCards, eliminationWinner, defenderTeam } from './match.ts';
import { ROUND_TICK_LIMIT } from './config.ts';
import { regionCentroid } from './strategies.ts';
import { cardById } from './cardData.ts';

export type SkirmishOpts = {
  // Per-unit attribute overrides, or a blanket override per team (A/B tests).
  overrides?: Record<string, AttributeOverride>;
  team?: Partial<Record<Team, AttributeOverride>>;
  cap?: number; // max ticks before declaring a draw
};

export type SkirmishResult = {
  winner: Team | 'draw';
  ticks: number;
  defAlive: number;
  atkAlive: number;
};

export function runSkirmish(seed: number, opts: SkirmishOpts = {}): SkirmishResult {
  let state = buildInitialState();

  // Re-assign attributes for this seed, layering team-wide then per-unit overrides.
  const overrides: Record<string, AttributeOverride> = {};
  for (const u of state.units) {
    const teamOv = opts.team?.[u.team];
    overrides[u.id] = { ...(teamOv ?? {}), ...(opts.overrides?.[u.id] ?? {}) };
  }
  assignAttributes(state.units, createRng(seed ^ 0x5f3759df), overrides);

  // Both teams advance to the middle enemy spawn hex and clash in mid.
  const defGoal = midSpawn(state, 'attackers');
  const atkGoal = midSpawn(state, 'defenders');
  for (const u of state.units) {
    state = assignTarget(state, u.id, u.team === 'defenders' ? defGoal : atkGoal);
  }

  const cap = opts.cap ?? 300;
  while (!roundFinished(state) && state.tick < cap) {
    state = stepTick(state);
  }

  const defAlive = aliveCount(state, 'defenders');
  const atkAlive = aliveCount(state, 'attackers');
  let winner: Team | 'draw' = 'draw';
  if (defAlive > 0 && atkAlive === 0) winner = 'defenders';
  else if (atkAlive > 0 && defAlive === 0) winner = 'attackers';
  return { winner, ticks: state.tick, defAlive, atkAlive };
}

export type BatchResult = {
  matches: number;
  defWinPct: number;
  atkWinPct: number;
  drawPct: number;
  avgTicks: number;
};

export function runBatch(matches: number, opts: SkirmishOpts = {}, baseSeed = 1): BatchResult {
  let def = 0;
  let atk = 0;
  let draw = 0;
  let totalTicks = 0;
  for (let i = 0; i < matches; i++) {
    const r = runSkirmish(baseSeed + i, opts);
    if (r.winner === 'defenders') def++;
    else if (r.winner === 'attackers') atk++;
    else draw++;
    totalTicks += r.ticks;
  }
  const pct = (n: number) => Math.round((n / matches) * 1000) / 10;
  return {
    matches,
    defWinPct: pct(def),
    atkWinPct: pct(atk),
    drawPct: pct(draw),
    avgTicks: Math.round((totalTicks / matches) * 10) / 10,
  };
}

function midSpawn(state: GameState, team: Team) {
  const spawns = state.map.spawns[team];
  return spawns[Math.floor(spawns.length / 2)];
}

function aliveCount(state: GameState, team: Team): number {
  let n = 0;
  for (const u of state.units) if (u.team === team && u.state === 'alive') n++;
  return n;
}

// ---------------------------------------------------------------------------
// Pass 9 m5 — strategy / card / determinism validation harness
// ---------------------------------------------------------------------------

export type StrategyRoundOpts = {
  // Player team's strategy id. Player is always defenders here for simplicity.
  defenderStrategy: string;
  // AI team's (attacker side) strategy id.
  attackerStrategy: string;
  // Optional card def ids to play this round. Defaults to no card.
  defenderCardDefId?: string | null;
  attackerCardDefId?: string | null;
  mapName?: MapDefinition['name'];
  cap?: number;
};

export type StrategyRoundResult = {
  winner: Team;       // never 'draw' — round timer awards to defenders.
  ticks: number;
  defAlive: number;
  atkAlive: number;
  events: readonly GameEvent[];
};

// One round driven by the real strategy+card pipeline. Mirrors main.beginRound
// + the loop fire(): apply strategies, commit cards, step to elimination or
// timeout, defender-wins on timeout.
export function runStrategyRound(seed: number, opts: StrategyRoundOpts): StrategyRoundResult {
  let state = buildInitialState(opts.mapName);
  // Same per-match attribute re-seed as runSkirmish so seeds → reproducible.
  assignAttributes(state.units, createRng(seed ^ 0x5f3759df));

  const playerTeam: Team = 'defenders';
  const aiTeam: Team = 'attackers';

  // Same RNG derivation as main.beginRound so variant picks + AI card picks
  // are bit-identical to what the UI would produce.
  const pickRng = createRng((seed ^ (state.round * 0x9e3779b1)) >>> 0);
  state = applyStrategies(state, playerTeam, opts.defenderStrategy, aiTeam, opts.attackerStrategy, pickRng);

  const defCard = makePlayedCard(state, playerTeam, opts.defenderCardDefId ?? null);
  const atkCard = makePlayedCard(state, aiTeam, opts.attackerCardDefId ?? null);
  state = commitCards(state, playerTeam, defCard, aiTeam, atkCard, pickRng);

  const cap = opts.cap ?? ROUND_TICK_LIMIT;
  let winner: Team | null = null;
  while (!winner && state.tick < cap) {
    state = stepTick(state);
    winner = eliminationWinner(state);
  }
  const w: Team = winner ?? defenderTeam(state);
  return {
    winner: w,
    ticks: state.tick,
    defAlive: aliveCount(state, 'defenders'),
    atkAlive: aliveCount(state, 'attackers'),
    events: state.events,
  };
}

// Build a PlayedCard from a def id by picking a contributor from the team's
// hand. Auto-targets are sensible defaults so batches can exercise targeted
// cards (Setup Play / Hold the Line / Adapt) without UI input.
function makePlayedCard(state: GameState, team: Team, defId: string | null): PlayedCard | null {
  if (!defId) return null;
  const inHand = state.cards[team].hand.find((c) => c.defId === defId);
  if (!inHand) return null; // not in this seed's deck — skip
  const def = cardById(defId);
  if (!def) return null;
  const played: PlayedCard = { defId, contributor: inHand.contributor };
  if (def.targeting === 'hex') {
    // Setup Play → vanguard region centroid + first non-tactician ally.
    // Hold the Line → warden region centroid.
    const contributor = state.units.find((u) => u.id === inHand.contributor);
    if (!contributor) return null;
    played.target = contributor.pos;
    if (defId === 'setup_play') {
      const ally = state.units.find((u) => u.team === team && u.id !== inHand.contributor);
      if (ally) played.secondaryTarget = ally.id;
    }
  } else if (def.targeting === 'role') {
    played.target = 'Vanguard';
  }
  // 'enemy' / 'ally' / 'none' targeting: untargeted at selection time (Mark
  // Target is now 'none' post-Pass 9 m3).
  return played;
}

// ---- Strategy matrix --------------------------------------------------------

export type StrategyMatrixCell = {
  defenderWinPct: number;
  avgTicks: number;
};
export type StrategyMatrixResult = Record<string, StrategyMatrixCell>;

// All defender strategies × attacker strategies; N seeds per cell.
export function runStrategyMatrix(seeds = 20, mapName: MapDefinition['name'] = 'Foundry'): StrategyMatrixResult {
  const defenderStrategies = ['Hold', 'Stack', 'Pressure'];
  const attackerStrategies = ['Execute', 'Rush', 'Control'];
  const out: StrategyMatrixResult = {};
  for (const defS of defenderStrategies) {
    for (const atkS of attackerStrategies) {
      let defWins = 0;
      let totalTicks = 0;
      for (let i = 0; i < seeds; i++) {
        const r = runStrategyRound(1000 + i, {
          defenderStrategy: defS,
          attackerStrategy: atkS,
          mapName,
        });
        if (r.winner === 'defenders') defWins++;
        totalTicks += r.ticks;
      }
      out[`${defS} vs ${atkS}`] = {
        defenderWinPct: Math.round((defWins / seeds) * 1000) / 10,
        avgTicks: Math.round((totalTicks / seeds) * 10) / 10,
      };
    }
  }
  return out;
}

// ---- Card sanity ------------------------------------------------------------

export type CardSanityRow = {
  cardId: string;
  cardName: string;
  baselineDefWinPct: number;
  withCardDefWinPct: number;
  deltaPp: number;          // positive = card helped defender
};

// For each card, run N matches with that card forced into the defender team's
// hand vs no card. Reports the win-rate delta. Cards near 0pp delta may need
// re-tuning (or simply don't apply to the test scenario).
export function cardSanityCheck(seeds = 20, mapName: MapDefinition['name'] = 'Foundry'): CardSanityRow[] {
  const ids = [
    'anchor_position', 'reckless_push', 'slow_flank', 'opening_pick',
    'crossfire', 'trade_window', 'spearhead', 'setup_play', 'hold_the_line',
    'adapt', 'guardian_aura', 'tactical_scan', 'mark_target',
  ];
  const out: CardSanityRow[] = [];
  // Baseline: Hold vs Execute, no cards.
  let baseDefWins = 0;
  for (let i = 0; i < seeds; i++) {
    const r = runStrategyRound(2000 + i, {
      defenderStrategy: 'Hold',
      attackerStrategy: 'Execute',
      mapName,
    });
    if (r.winner === 'defenders') baseDefWins++;
  }
  const baseDefPct = Math.round((baseDefWins / seeds) * 1000) / 10;
  for (const cardId of ids) {
    let withWins = 0;
    let played = 0;
    for (let i = 0; i < seeds; i++) {
      const r = runStrategyRound(2000 + i, {
        defenderStrategy: 'Hold',
        attackerStrategy: 'Execute',
        defenderCardDefId: cardId,
        mapName,
      });
      // Confirm the card actually played (it might not be in this seed's hand).
      if (r.events.some((e) => e.type === 'cardPlay' && e.team === 'defenders' && e.defId === cardId)) {
        played++;
        if (r.winner === 'defenders') withWins++;
      }
    }
    if (played === 0) {
      out.push({
        cardId,
        cardName: cardById(cardId)?.name ?? cardId,
        baselineDefWinPct: baseDefPct,
        withCardDefWinPct: NaN,
        deltaPp: NaN,
      });
      continue;
    }
    const withPct = Math.round((withWins / played) * 1000) / 10;
    out.push({
      cardId,
      cardName: cardById(cardId)?.name ?? cardId,
      baselineDefWinPct: baseDefPct,
      withCardDefWinPct: withPct,
      deltaPp: Math.round((withPct - baseDefPct) * 10) / 10,
    });
  }
  return out;
}

// ---- Determinism check -----------------------------------------------------

export type DeterminismResult = {
  total: number;
  matched: number;
  mismatchedSeeds: number[];
};

// Stable hash of an event log. We round-trip serialize each event's discriminator
// + key fields so JSON key order doesn't matter.
function hashEvents(events: readonly GameEvent[]): string {
  const parts: string[] = [];
  for (const e of events) {
    if (e.type === 'shot') parts.push(`${e.tick}:S:${e.shooter}>${e.target}:${e.hit?'H':'M'}:${e.headshot?'h':'b'}:${e.damage}:${e.range}:${e.cover?1:0}`);
    else if (e.type === 'death') parts.push(`${e.tick}:D:${e.target}`);
    else if (e.type === 'cardPlay') parts.push(`${e.tick}:C:${e.team}:${e.defId}:${e.contributor}`);
    else if (e.type === 'safeWindowBlock') parts.push(`${e.tick}:B:${e.shooter}>${e.target}`);
    else if (e.type === 'strategyPick') parts.push(`${e.tick}:P:R${e.round}:${e.playerStrategy}/${e.aiStrategy}/${e.playerCardDefId}/${e.aiCardDefId}`);
  }
  // Sum-based fingerprint — cheap, stable enough for cross-run match detection.
  let h = 5381 >>> 0;
  const joined = parts.join('|');
  for (let i = 0; i < joined.length; i++) h = (Math.imul(h, 33) ^ joined.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

export function determinismCheck(seeds = 10, mapName: MapDefinition['name'] = 'Foundry'): DeterminismResult {
  const mismatched: number[] = [];
  for (let i = 0; i < seeds; i++) {
    const a = runStrategyRound(3000 + i, { defenderStrategy: 'Hold', attackerStrategy: 'Execute', mapName });
    const b = runStrategyRound(3000 + i, { defenderStrategy: 'Hold', attackerStrategy: 'Execute', mapName });
    if (hashEvents(a.events) !== hashEvents(b.events)) mismatched.push(3000 + i);
  }
  return {
    total: seeds,
    matched: seeds - mismatched.length,
    mismatchedSeeds: mismatched,
  };
}

// Suppress the unused-import warning for regionCentroid — kept for future use
// when the Setup Play / Hold the Line auto-targets switch from "contributor's
// own pos" to "strategy region centroid" (more sensible default).
void regionCentroid;
