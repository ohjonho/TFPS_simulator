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
import { AI_STRATEGY_EXPLORATION, OPPONENT_LEAN } from './config.ts';

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
  const total = weights.reduce((s, w) => s + w, 0);
  let pick = rng.next() * total;
  for (let i = 0; i < options.length; i++) {
    pick -= weights[i];
    if (pick <= 0) return options[i].id;
  }
  return options[options.length - 1].id;
}
