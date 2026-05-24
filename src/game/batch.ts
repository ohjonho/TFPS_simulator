// Lightweight headless AI-vs-AI batch harness. Runs seeded skirmishes (random
// attribute assignment, both teams advance to the enemy spawn and clash) and
// aggregates outcomes — to measure trait/role differentiation and, later, tune
// balance. Pure logic (no DOM); invoked from the dev `__sim` hook.

import type { GameState, Team } from './types.ts';
import type { AttributeOverride } from './attributes.ts';
import { buildInitialState } from './state.ts';
import { assignAttributes } from './attributes.ts';
import { assignTarget } from './movement.ts';
import { roundFinished, stepTick } from './tick.ts';
import { createRng } from './rng.ts';

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
