// AI opponent strategy picker (spec §16). Weighted random over the
// strategies available to the AI team's roster (baseline + trait-unlocked
// variants). Weights bias toward strategies that have won for the AI team
// this match (`state.aiStrategyWins`).
//
// H3.4 — `pickAiCard` removed (card system deleted). AI decisions are now
// strategy-only; trait/role/hero synergies + hero passives drive the
// rest in match.applyStrategies.

import type { GameState, Side, Team } from './types.ts';
import type { Rng } from './rng.ts';
import { availableStrategies } from './traits.ts';
import { strategyById } from './strategies.ts';
import {
  AI_STRATEGY_EXPLORATION, OPPONENT_LEAN, STRATEGY_COUNTER, STRATEGY_COUNTER_OVERRIDE,
} from './config.ts';

export function pickAiStrategy(
  state: GameState,
  team: Team,
  side: Side,
  rng: Rng,
): string {
  // Campaign tutorial: the first match's opponent plays a fixed, telegraphed
  // strategy for its side so the player learns read → counter (season.ts).
  const scripted = state.scriptedAiStrategy?.[side];
  if (scripted) return scripted;

  // H3 — AI picks from the strategies its roster can actually run
  // (baseline + trait-unlocked variants on the AI team's units).
  const aiUnits = state.units.filter((u) => u.team === team);
  let options = availableStrategies(aiUnits, side, state.map);
  // Campaign progressive unlock: restrict the AI to the same set the player has
  // (so the opponent ramps up in step, not ahead). null/absent = no restriction.
  const unlocked = state.unlockedStrategyIds;
  if (unlocked) {
    const allow = new Set(unlocked);
    const filtered = options.filter((s) => allow.has(s.id));
    if (filtered.length > 0) options = filtered;
  }
  // Campaign opponent lean: this team has a scouted tendency — pick the leaned
  // strategy `pickChance` of the time; otherwise fall through to the weighted
  // pick over the REST (so the lean rate is exact, not inflated by the fallback).
  const lean = state.opponentLean?.[side];
  if (lean && options.some((s) => s.id === lean.strategy)) {
    if (rng.next() < OPPONENT_LEAN.pickChance) return lean.strategy;
    const rest = options.filter((s) => s.id !== lean.strategy);
    if (rest.length > 0) options = rest;
  }
  const wins = state.aiStrategyWins[team] ?? {};
  // Pass 7.8 — base weight `1 + wins` (win-rate bias) plus a per-pick uniform
  // exploration noise so an early single win can't dominate the rest of the
  // match. Noise is drawn from the same seeded RNG so determinism holds.
  const weights = options.map(
    (s) => 1 + (wins[s.id] ?? 0) + rng.next() * AI_STRATEGY_EXPLORATION,
  );
  // B2.1 — soft matchup counter. If the enemy (player) has a leaned AUTHORED play
  // with a measured matchup, tilt toward the option that best counters it. Soft
  // (a weight multiplier, not an argmax) and no new RNG draws ⇒ determinism holds;
  // inert when there's no measured custom lean ⇒ existing behavior unchanged.
  if (STRATEGY_COUNTER_OVERRIDE ?? STRATEGY_COUNTER.enabled) {
    const enemy: Team = team === 'defenders' ? 'attackers' : 'defenders';
    const enemySide: Side = side === 'attacker' ? 'defender' : 'attacker';
    const enemyLean = state.strategyLean[enemy] ?? {};
    // The enemy's most-leaned authored play that carries a measured matchup.
    let sigMatchups: Record<string, number> | null = null;
    let bestW = 0;
    for (const [id, w] of Object.entries(enemyLean)) {
      if (w <= bestW) continue;
      const p = strategyById(id, enemySide, state.map);
      if (p?.authored && p.measured) { sigMatchups = p.measured.matchups; bestW = w; }
    }
    if (sigMatchups) {
      for (let i = 0; i < options.length; i++) {
        const dv = sigMatchups[options[i].id];
        if (dv === undefined) continue;
        // defender-win% → THIS AI's win% vs the play, by the AI's side.
        const aiWin = side === 'attacker' ? 100 - dv : dv;
        const factor = Math.max(STRATEGY_COUNTER.floor, 1 + STRATEGY_COUNTER.bias * (aiWin - 50) / 50);
        weights[i] *= factor;
      }
    }
  }
  const total = weights.reduce((s, w) => s + w, 0);
  let pick = rng.next() * total;
  for (let i = 0; i < options.length; i++) {
    pick -= weights[i];
    if (pick <= 0) return options[i].id;
  }
  return options[options.length - 1].id;
}
