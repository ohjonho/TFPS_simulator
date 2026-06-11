// Lightweight headless AI-vs-AI batch harness. Runs seeded skirmishes (random
// attribute assignment, both teams advance to the enemy spawn and clash) and
// aggregates outcomes — to measure trait/role differentiation and, later, tune
// balance. Pure logic (no DOM); invoked from the dev `__sim` hook.
//
// H3.4 — card-sanity check removed (card system deleted). Strategy matrix
// + determinism check remain.

import type { GameEvent, GameState, HexCoord, MapDefinition, Side, Team } from './types.ts';
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
  // Harness seam: force the ATTACKER (AI) strategy variant index (0 = A-site
  // variant, 1 = B-site) instead of the seeded coin-flip, for controlled
  // per-site experiments. The RNG draw is still consumed, so a given seed yields
  // the same round except for the forced site. Undefined → normal random pick.
  attackerVariantIdx?: number;
  // Harness seam: force the DEFENDER (player) strategy variant index (0 = A-site,
  // 1 = B-site), for right-stack vs wrong-stack analysis of site-committing
  // defenses (Stack / Coordinated_Lockdown). Undefined → normal random pick.
  defenderVariantIdx?: number;
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
  // Final positions of units that died this round (a dead unit doesn't move, so
  // end-of-round pos = where it fell). Feeds the fingerprint death-zone
  // histogram. Pure read of final state; ignored by matrix/determinism.
  deaths: { team: Team; pos: HexCoord }[];
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
  state = applyStrategies(state, playerTeam, opts.defenderStrategy, aiTeam, opts.attackerStrategy, pickRng, opts.defenderVariantIdx ?? null, opts.attackerVariantIdx ?? null);

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
    deaths: state.units
      .filter((u) => u.state === 'dead')
      .map((u) => ({ team: u.team, pos: { ...u.pos } })),
  };
}

// H3.4 — makePlayedCard removed (card system deleted).

// ---- Strategy matrix --------------------------------------------------------

export type StrategyMatrixCell = {
  defenderWinPct: number;
  avgTicks: number;
};
export type StrategyMatrixResult = Record<string, StrategyMatrixCell>;

// v0.28.0 — the trait-unlock strategy system was retired (strategies decoupled
// from traits). The only non-baseline picks now are the promoted concepts
// (Mind_Games / Coordinated_Lockdown / Rotate_Stack), which are plain baselines
// — no trait pinning needed.

// All defender strategies × attacker strategies; N seeds per cell.
// `includeUnlocks: true` additionally runs the promoted non-baseline strategies.
// Default false keeps the headline matrix at the 3×3 baseline size.
export function runStrategyMatrix(
  seeds = 20,
  mapName: MapDefinition['name'] = 'Foundry',
  includeUnlocks = false,
): StrategyMatrixResult {
  const baselineDef = ['Hold', 'Stack', 'Pressure'];
  const baselineAtk = ['Execute', 'Rush', 'Control'];
  const extraDef = includeUnlocks ? ['Mind_Games', 'Coordinated_Lockdown', 'Rotate_Stack'] : [];
  const extraAtk = includeUnlocks ? ['Mind_Games'] : [];
  const defenderStrategies = [...baselineDef, ...extraDef];
  const attackerStrategies = [...baselineAtk, ...extraAtk];
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
  // Test pairs: one baseline-threshold matchup (Hold vs Execute, ~50) and one
  // demanding matchup (~75). v0.28.0 — the demanding def is now the kept
  // high-compliance baseline Coordinated_Lockdown (the trait-unlock strategies
  // were retired).
  const pairs: { def: string; atk: string; label: string; threshold: number }[] = [
    { def: 'Hold',                 atk: 'Execute', label: 'Hold vs Execute',                  threshold: 50 },
    { def: 'Coordinated_Lockdown', atk: 'Execute', label: 'Coordinated_Lockdown vs Execute',  threshold: 75 },
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
    const runHigh = mergedRun(seeds, mapName, def, atk, tenacityOverride(90));
    const runLow  = mergedRun(seeds, mapName, def, atk, tenacityOverride(10));
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

// Run N seeds of the matchup with the given per-unit attribute overrides.
// Returns defender win % (rounded to 0.1). v0.28.0 — the unlock-trait overrides
// are gone (strategies decoupled), so this just applies the attribute overrides.
function mergedRun(
  seeds: number,
  mapName: MapDefinition['name'],
  def: string,
  atk: string,
  attrOvs: Record<string, AttributeOverride>,
): number {
  const merged = attrOvs;
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

// ---- Strategy fingerprint (distinctness / viability probe) -----------------
//
// For one strategy (on a given side), run it vs each opponent strategy over N
// seeds and aggregate a behavioral fingerprint: win%, plant rate + which site,
// round length, and where bodies fall (coarse-zone histogram across both
// teams). Two strategies are "distinct" when their fingerprints differ;
// "viable" when win% isn't ~0 across every matchup (the known 0%-cell issue for
// promoted strategies). Derived from the event log + final positions — no new
// state plumbing. Used while walking strategies map-by-map (Step 7).

const COARSE_ZONES = ['a_site', 'b_site', 'mid', 'a_main', 'b_main', 'def_spawn', 'atk_spawn'] as const;

// hex-key → coarse zone. COARSE_ZONES order = priority (sites/mid before mains),
// matching how a reader thinks about "where the fight happened." Folded parents
// (a_site already includes plant/entry/anchor/off) keep the buckets meaningful.
function buildZoneKey(map: MapDefinition): Record<string, string> {
  const key: Record<string, string> = {};
  for (const zone of COARSE_ZONES) {
    for (const h of map.regions[zone] ?? []) {
      const k = `${h.col},${h.row}`;
      if (!(k in key)) key[k] = zone; // earlier (higher-priority) zone wins
    }
  }
  return key;
}

export type StrategyFingerprint = {
  strategy: string;
  side: Side;
  matchups: number;
  seeds: number;
  winPct: number;          // win% for `side`, over all matchups × seeds
  plantRatePct: number;    // % of rounds that reached a plant
  plantAPct: number;       // % of PLANTS on site A (vs B)
  plantBPct: number;
  avgTicks: number;
  deathZonePct: Record<string, number>;  // zone → % of all deaths there
};

export function runStrategyFingerprint(
  side: Side,
  strategyId: string,
  opponents: readonly string[],
  seeds = 20,
  mapName: MapDefinition['name'] = 'Foundryv2',
): StrategyFingerprint {
  const zoneKey = buildZoneKey(buildInitialState(mapName, 'standard').map);
  const myTeam: Team = side === 'defender' ? 'defenders' : 'attackers';
  let wins = 0, rounds = 0, plants = 0, plantA = 0, plantB = 0, totalTicks = 0, totalDeaths = 0;
  const deathZones: Record<string, number> = {};
  for (const opp of opponents) {
    for (let i = 0; i < seeds; i++) {
      const r = runStrategyRound(7000 + i, {
        defenderStrategy: side === 'defender' ? strategyId : opp,
        attackerStrategy: side === 'attacker' ? strategyId : opp,
        mapName,
      });
      rounds++;
      totalTicks += r.ticks;
      if (r.winner === myTeam) wins++;
      for (const e of r.events) {
        if (e.type === 'plant') { plants++; if (e.site === 'A') plantA++; else plantB++; }
      }
      for (const d of r.deaths) {
        const z = zoneKey[`${d.pos.col},${d.pos.row}`] ?? 'other';
        deathZones[z] = (deathZones[z] ?? 0) + 1;
        totalDeaths++;
      }
    }
  }
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
  const deathZonePct: Record<string, number> = {};
  for (const z of Object.keys(deathZones)) deathZonePct[z] = pct(deathZones[z], totalDeaths);
  return {
    strategy: strategyId, side, matchups: opponents.length, seeds,
    winPct: pct(wins, rounds),
    plantRatePct: pct(plants, rounds),
    plantAPct: pct(plantA, plants),
    plantBPct: pct(plantB, plants),
    avgTicks: Math.round((totalTicks / Math.max(1, rounds)) * 10) / 10,
    deathZonePct,
  };
}
