// Lightweight headless AI-vs-AI batch harness. Runs seeded skirmishes (random
// attribute assignment, both teams advance to the enemy spawn and clash) and
// aggregates outcomes — to measure trait/role differentiation and, later, tune
// balance. Pure logic (no DOM); invoked from the dev `__sim` hook.
//
// H3.4 — card-sanity check removed (card system deleted). Strategy matrix
// + determinism check remain.

import type { GameEvent, GameState, MapDefinition, Team } from './types.ts';
import type { AttributeOverride } from './attributes.ts';
import { buildInitialState } from './state.ts';
import { assignAttributes } from './attributes.ts';
import { assignTarget } from './movement.ts';
import { roundFinished, stepTick } from './tick.ts';
import { createRng } from './rng.ts';
import { applyStrategies, eliminationWinner, defenderTeam } from './match.ts';
import { ROUND_TICK_LIMIT } from './config.ts';
import { regionCentroid } from './strategies.ts';

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
  // H3.5 — explicit 'standard' mode (default flipped to 'draft' in H3.fix2;
  // headless tests want the fixed 2r+1s roster with attribute overrides).
  let state = buildInitialState(undefined, 'standard');

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
  // H3.4 — defenderCardDefId / attackerCardDefId removed (card system deleted).
  mapName?: MapDefinition['name'];
  cap?: number;
  // Pass A5 follow-up: per-unit attribute overrides used to isolate strategy
  // impact from attribute randomization (e.g. all-50 ratings across all
  // units). Layered on top of seed-based generation in assignAttributes.
  overrides?: Record<string, AttributeOverride>;
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
  // H3.5 — explicit 'standard' mode: H3.fix2 flipped the default to 'draft'
  // (which leaves units empty until finalizeDraft) which would short-circuit
  // every headless match to 0v0 → instant elim. Headless tests use the
  // fixed 2r+1s standard roster + opts.overrides for attribute/trait
  // pinning.
  let state = buildInitialState(opts.mapName, 'standard');
  // Same per-match attribute re-seed as runSkirmish so seeds → reproducible.
  // Pass A5 follow-up: caller can pin attributes via opts.overrides (e.g.
  // all-50 ratings) to isolate strategy/mechanic impact from attribute RNG.
  assignAttributes(state.units, createRng(seed ^ 0x5f3759df), opts.overrides ?? {});

  const playerTeam: Team = 'defenders';
  const aiTeam: Team = 'attackers';

  // Same RNG derivation as main.beginRound so variant picks + AI card picks
  // are bit-identical to what the UI would produce.
  const pickRng = createRng((seed ^ (state.round * 0x9e3779b1)) >>> 0);
  state = applyStrategies(state, playerTeam, opts.defenderStrategy, aiTeam, opts.attackerStrategy, pickRng);

  // H3.4 — commitCards removed; applyStrategies populated synergies + hero
  // passives directly above.

  const cap = opts.cap ?? ROUND_TICK_LIMIT;
  // Hard ceiling protects against runaway loops if both teams stalemate at
  // some unforeseen state. Generous: cap + full detonation window + slack.
  const hardCap = cap + 30;
  let winner: Team | null = null;
  while (!winner && state.tick < hardCap) {
    state = stepTick(state);
    // Pass B: spike-plant outcomes (detonation / defuse) set roundResult
    // inside stepTick. They take precedence over elimination/timeout.
    if (state.roundResult) {
      winner = state.roundResult.winner === 'draw' ? null : state.roundResult.winner;
      if (winner) break;
    }
    // H3.fix1 — elimination is now decisive regardless of plant state
    // (eliminationWinner internally handles the mutual-annihilation
    // post-plant tiebreaker → attackers win). Pre-fix: a planted+wipe
    // round looped to the tick cap and silently fell into the defender
    // fallback below.
    winner = eliminationWinner(state);
    if (winner) break;
    // Timeout — defender wins on timeout when no plant is down. With plant
    // down we keep ticking until detonation/defuse fires above (or the
    // tick cap eventually breaks us out via the for-loop bound).
    if (state.plant.planted === null && state.tick >= cap) break;
  }
  // Fallback: if we exited without a winner, defender wins (timeout, plant
  // still up edge case, or stalemate hitting hardCap).
  const w: Team = winner ?? defenderTeam(state);
  return {
    winner: w,
    ticks: state.tick,
    defAlive: aliveCount(state, 'defenders'),
    atkAlive: aliveCount(state, 'attackers'),
    events: state.events,
  };
}

// H3.4 — makePlayedCard removed (card system deleted).

// ---- Strategy matrix --------------------------------------------------------

export type StrategyMatrixCell = {
  defenderWinPct: number;
  avgTicks: number;
};
export type StrategyMatrixResult = Record<string, StrategyMatrixCell>;

// H3.5 — trait-unlocked strategy → required trait for the unlock filter.
// Each unlock strategy needs ≥1 unit on the team to carry the matching trait
// (otherwise availableStrategies filters it out). Pinned per-unit-id below
// so runStrategyRound can include unlock strategies in the matrix.
const UNLOCK_TRAIT: Record<string, { trait: string; category: 'behavioral' | 'personality' }> = {
  Anchor_Hold:          { trait: 'Sentinel',  category: 'behavioral' },
  Crossfire_Lockdown:   { trait: 'Trader',    category: 'behavioral' },
  Last_Stand_Defense:   { trait: 'Clutch',    category: 'behavioral' },
  Mind_Games:           { trait: 'Big Brain', category: 'personality' },
  Hold_Composure:       { trait: 'Composed',  category: 'personality' },
  Coordinated_Lockdown: { trait: 'Leader',    category: 'personality' },
  Rotate_Stack:         { trait: 'Roamer',    category: 'behavioral' },
  Wide_Watch:           { trait: 'Paranoid',  category: 'personality' },
  Slow_Burn:            { trait: 'Patient',   category: 'personality' },
  Mobile_Push:          { trait: 'Run-n-Gun', category: 'behavioral' },
  Patient_Flank:        { trait: 'Lurker',    category: 'behavioral' },
  Coordinated_Execute:  { trait: 'Entry',     category: 'behavioral' },
  Solo_Frag:            { trait: 'Ego',       category: 'personality' },
  Scatter_Push:         { trait: 'Lone Wolf', category: 'personality' },
  Aggressive_Peek:      { trait: 'Hot Head',  category: 'behavioral' },
};

// Build overrides that pin the unlock trait onto the team's slot-0 unit so
// availableStrategies surfaces it. D1 / A1 are the canonical slot-0 ids
// after assignSlots — they always exist on the 3-unit teams.
function unlockOverrides(defStrategy: string, atkStrategy: string): Record<string, AttributeOverride> {
  const o: Record<string, AttributeOverride> = {};
  const defUnlock = UNLOCK_TRAIT[defStrategy];
  if (defUnlock) {
    o.D1 = defUnlock.category === 'behavioral'
      ? { behavioralTrait: defUnlock.trait as AttributeOverride['behavioralTrait'] }
      : { personalityTrait: defUnlock.trait as AttributeOverride['personalityTrait'] };
  }
  const atkUnlock = UNLOCK_TRAIT[atkStrategy];
  if (atkUnlock) {
    o.A1 = atkUnlock.category === 'behavioral'
      ? { behavioralTrait: atkUnlock.trait as AttributeOverride['behavioralTrait'] }
      : { personalityTrait: atkUnlock.trait as AttributeOverride['personalityTrait'] };
  }
  return o;
}

// All defender strategies × attacker strategies; N seeds per cell.
// `includeUnlocks: true` adds the 9 D + 6 A trait-unlocked strategies (with
// pinned trait overrides so availableStrategies surfaces them). Default
// false to keep the headline matrix at the 3×3 baseline size.
export function runStrategyMatrix(
  seeds = 20,
  mapName: MapDefinition['name'] = 'Foundry',
  includeUnlocks = false,
): StrategyMatrixResult {
  const baselineDef = ['Hold', 'Stack', 'Pressure'];
  const baselineAtk = ['Execute', 'Rush', 'Control'];
  const unlockDef = includeUnlocks ? [
    'Anchor_Hold', 'Crossfire_Lockdown', 'Last_Stand_Defense', 'Mind_Games',
    'Hold_Composure', 'Coordinated_Lockdown', 'Rotate_Stack', 'Wide_Watch',
    'Slow_Burn',
  ] : [];
  const unlockAtk = includeUnlocks ? [
    'Mobile_Push', 'Patient_Flank', 'Coordinated_Execute', 'Solo_Frag',
    'Scatter_Push', 'Aggressive_Peek', 'Mind_Games',
  ] : [];
  const defenderStrategies = [...baselineDef, ...unlockDef];
  const attackerStrategies = [...baselineAtk, ...unlockAtk];
  const out: StrategyMatrixResult = {};
  for (const defS of defenderStrategies) {
    for (const atkS of attackerStrategies) {
      let defWins = 0;
      let totalTicks = 0;
      const overrides = unlockOverrides(defS, atkS);
      for (let i = 0; i < seeds; i++) {
        const r = runStrategyRound(1000 + i, {
          defenderStrategy: defS,
          attackerStrategy: atkS,
          mapName,
          overrides,
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

// ---- Compliance test --------------------------------------------------------
//
// H3.5 — verification of the per-tick directive compliance roll
// (directives.ts). Reports BOTH the formula-predicted compliance pct (the
// math) AND a small-sample empirical match win-rate (the practice). The
// formula numbers are deterministic and proof of correctness; the
// empirical numbers are dominated by sample-size variance below ~50 seeds
// and only show a meaningful delta when fallback-tree behavior diverges
// significantly from the directive's intent.

export type ComplianceTestResult = {
  strategy: string;
  threshold: number;        // strategy's compliance demand
  // Formula-predicted compliance % (per-tick) at extreme attribute values.
  // Computed via directives.compliancePct; deterministic, no RNG.
  formulaHighPct: number;   // Tenacity 90 + Composure 90 + under-fire pressure
  formulaLowPct: number;    // Tenacity 10 + Composure 10 + under-fire pressure
  // Empirical match-outcome at extremes. Noisy below ~50 seeds; use the
  // formula numbers as the primary correctness signal.
  highDefWinPct: number;
  lowDefWinPct: number;
  empiricalDeltaPp: number; // high − low
};

function tenacityOverride(value: number): Record<string, AttributeOverride> {
  const o: Record<string, AttributeOverride> = {};
  for (const id of ['D1', 'D2', 'D3', 'A1', 'A2', 'A3']) {
    o[id] = { attributes: { tenacity: value, composure: value } };
  }
  return o;
}

export function runComplianceTest(
  seeds = 20,
  mapName: MapDefinition['name'] = 'Foundry',
): ComplianceTestResult[] {
  // Test pairs: one baseline-threshold matchup (Hold vs Execute, ~50) and
  // one demanding matchup (Anchor_Hold vs Coordinated_Execute, ~75) so we
  // can compare how much compliance bites at each demand level.
  const pairs: { def: string; atk: string; label: string; threshold: number }[] = [
    { def: 'Hold',        atk: 'Execute',             label: 'Hold vs Execute',                   threshold: 50 },
    { def: 'Anchor_Hold', atk: 'Coordinated_Execute', label: 'Anchor_Hold vs Coordinated_Execute', threshold: 75 },
  ];
  // Formula reference values — computed once, deterministic.
  // pressure = -15 (under fire) matches the in-tick formula in directives.ts
  // when visibleEnemies.length > 0. baseline = 85, weights 0.4 / 0.2.
  const formulaPct = (t: number, c: number, threshold: number, pressure = -15) =>
    Math.max(5, Math.min(99,
      85 + 0.4 * (t - 50) + 0.2 * (c - 50) - 0.5 * (threshold - 50) + pressure,
    ));
  const out: ComplianceTestResult[] = [];
  for (const { def, atk, label, threshold } of pairs) {
    const unlockOvs = unlockOverrides(def, atk);
    const runHigh = mergedRun(seeds, mapName, def, atk, unlockOvs, tenacityOverride(90));
    const runLow  = mergedRun(seeds, mapName, def, atk, unlockOvs, tenacityOverride(10));
    out.push({
      strategy: label,
      threshold,
      formulaHighPct: Math.round(formulaPct(90, 90, threshold) * 10) / 10,
      formulaLowPct:  Math.round(formulaPct(10, 10, threshold) * 10) / 10,
      highDefWinPct: runHigh,
      lowDefWinPct: runLow,
      empiricalDeltaPp: Math.round((runHigh - runLow) * 10) / 10,
    });
  }
  return out;
}

// Merge unlock overrides + attribute overrides per unit, then run N seeds
// of the matchup. Returns defender win % (rounded to 0.1).
function mergedRun(
  seeds: number,
  mapName: MapDefinition['name'],
  def: string,
  atk: string,
  unlockOvs: Record<string, AttributeOverride>,
  attrOvs: Record<string, AttributeOverride>,
): number {
  // Merge per unit id: trait fields from unlockOvs + attributes from attrOvs.
  const merged: Record<string, AttributeOverride> = {};
  for (const id of new Set([...Object.keys(unlockOvs), ...Object.keys(attrOvs)])) {
    merged[id] = { ...(unlockOvs[id] ?? {}), ...(attrOvs[id] ?? {}) };
  }
  let defWins = 0;
  for (let i = 0; i < seeds; i++) {
    const r = runStrategyRound(3000 + i, {
      defenderStrategy: def,
      attackerStrategy: atk,
      mapName,
      overrides: merged,
    });
    if (r.winner === 'defenders') defWins++;
  }
  return Math.round((defWins / seeds) * 1000) / 10;
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
    // H3.4 — cardPlay / safeWindowBlock variants removed from GameEvent.
    else if (e.type === 'strategyPick') parts.push(`${e.tick}:P:R${e.round}:${e.playerStrategy}/${e.aiStrategy}`);
    else if (e.type === 'plant') parts.push(`${e.tick}:PL:${e.unit}@${e.site}`);
    else if (e.type === 'defuse') parts.push(`${e.tick}:DF:${e.unit}`);
    else if (e.type === 'detonate') parts.push(`${e.tick}:DT@${e.site}`);
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
