// Decision-trace observability (AI iteration efficiency, Phase 1.5).
//
// The sim is pure + deterministic, which makes win-rate boards a terrible
// debugger: a one-line semantic bug (e.g. a watch angle pointed at the enemy
// SPAWN instead of the attacker mass) survives tsc + determinism and only
// surfaces as a noisy multi-minute board anomaly. This module records WHAT the
// AI decided and WHY at the decision level, so a single traced round answers in
// seconds what a board can only hint at in minutes.
//
// Design: a module-level sink the harness installs before running a round
// (mirrors config.setHeroAbilitiesEnabled). When no sink is installed (live
// play, boards), every hook is a null-check no-op — zero behavior change, zero
// allocation. Recording is read-only w.r.t. the sim: no RNG, no state writes,
// so determinism is untouched by construction.

import type { AiMode, HexCoord, Team } from './types.ts';

// Which branch of the tick.ts decision cascade finalized this unit's action
// this tick. One tag per override branch — the cascade's "who won" question.
export type DecisionSource =
  | 'retreat'
  | 'engage'
  | 'engage-sticky'
  | `directive:${string}`
  | 'region'
  | 'push'
  | 'track-chase'
  | 'shot-react'
  | 'hold'
  | 'hold-safety'
  | 'stalemate-mid'
  | 'collapse'
  | 'collapse-matrix'
  | 'retake-defuse'
  | 'retake-cover'
  | 'postplant-cover'
  | 'urgency-plant'
  | 'hold-tuck';

export type TraceUnitRecord = {
  tick: number;
  unitId: string;
  mode: AiMode;
  source: DecisionSource;
  pos: HexCoord;
  target: HexCoord | null;
};

// Per-team belief mass at the two sites (belief.ts store) — what the AI
// actually reads when committing. Recorded each tick when a sink is active.
export type TraceBeliefSummary = Record<Team, { aSite: number; bSite: number }>;

export type TraceTickRecord = {
  tick: number;
  // Defensive-collapse read this tick (null = no commit read).
  collapseSite: string | null;
  // Per-team suspected-enemy hex counts (visible + ghosts + tracking) — the
  // belief-starvation metric (maxKnown) falls straight out of this.
  suspectedDefenders: number;
  suspectedAttackers: number;
  // Belief-store site masses (present when the caller supplies a provider).
  belief?: TraceBeliefSummary;
};

export type TraceLog = {
  units: TraceUnitRecord[];
  ticks: TraceTickRecord[];
};

let sink: TraceLog | null = null;

// Install (or clear, with null) the trace sink. Harness-only seam; live play
// never sets it.
export function setTraceLog(log: TraceLog | null): void {
  sink = log;
}

export function traceUnit(
  tick: number,
  unitId: string,
  mode: AiMode,
  source: DecisionSource,
  pos: HexCoord,
  target: HexCoord | null,
): void {
  if (!sink) return;
  sink.units.push({ tick, unitId, mode, source, pos: { ...pos }, target: target ? { ...target } : null });
}

export function traceTick(
  tick: number,
  collapseSite: string | null,
  suspectedDefenders: number,
  suspectedAttackers: number,
  // Thunk so the belief site-sums are only computed when a sink is installed.
  beliefSummary?: () => TraceBeliefSummary,
): void {
  if (!sink) return;
  sink.ticks.push({
    tick,
    collapseSite,
    suspectedDefenders,
    suspectedAttackers,
    ...(beliefSummary ? { belief: beliefSummary() } : {}),
  });
}
