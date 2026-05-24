// Pass 8 — planning-phase "what-if" preview. Given the player's current
// strategy + card selection, computes the routes each player unit will follow
// when the round begins, so the player can see the consequences of their picks
// before committing. Pure: takes a GameState snapshot + selection, returns
// targets/routes. Reverting to the original selection on the same state yields
// byte-identical routes (deterministic — same RNG derivation as beginRound).
//
// The AI's selection is NOT previewed (only the player's team).

import type {
  GameState,
  HexCoord,
  PlayedCard,
  Team,
} from './types.ts';
import { applyStrategies, commitCards } from './match.ts';
import { findPath, findPerimeterPath } from './pathfind.ts';
import { createRng } from './rng.ts';
import { CARD_EFFECTS } from './config.ts';

export type PlayerSelection = {
  strategyId: string | null;
  card: PlayedCard | null;
};

export type PlanPreview = {
  // Per player-unit target hex after applyStrategies + applyCards.
  targets: Record<string, HexCoord | null>;
  // Per player-unit A* route from current pos to target (full path including
  // start hex). Empty record if no strategy is selected.
  routes: Record<string, HexCoord[]>;
};

export function previewPlayerPlan(state: GameState, sel: PlayerSelection): PlanPreview {
  const empty: PlanPreview = { targets: {}, routes: {} };
  if (!sel.strategyId) return empty;

  const aiTeam: Team = state.playerTeam === 'defenders' ? 'attackers' : 'defenders';
  // Same RNG derivation as beginRound + simulateRound so previewed routes match
  // committed routes exactly. The AI's strategy/card don't affect player units'
  // targets, so we pass placeholder ids (Hold for AI strategy, no card).
  const pickRng = createRng((state.seed ^ (state.round * 0x9e3779b1)) >>> 0);
  // applyStrategies advances the rng twice (one variant pick per team). To keep
  // determinism aligned with beginRound, run it the same way: pass the actual
  // AI strategy id state.aiStrategy if present, else fall back to a default.
  const aiStrategyId = state.aiStrategy ?? defaultStrategyFor(state, aiTeam);
  let s = applyStrategies(state, state.playerTeam, sel.strategyId, aiTeam, aiStrategyId, pickRng);
  s = commitCards(s, state.playerTeam, sel.card, aiTeam, null, pickRng);

  const targets: Record<string, HexCoord | null> = {};
  const routes: Record<string, HexCoord[]> = {};
  for (const u of s.units) {
    if (u.team !== state.playerTeam) continue;
    const goal = s.targets[u.id];
    targets[u.id] = goal;
    if (!goal) continue;
    const useSlow = !!u.cardFlags.slowFlank;
    const path = useSlow
      ? findPerimeterPath(s.map, u.pos, goal, CARD_EFFECTS.slowFlank.perimeterPenalty) ?? findPath(s.map, u.pos, goal)
      : findPath(s.map, u.pos, goal);
    if (path && path.length > 1) routes[u.id] = path;
  }
  return { targets, routes };
}

// Pick a stable default AI strategy id for the preview when none has been
// committed yet. The actual AI pick at Begin Round may differ; this just
// keeps the variant-pick RNG draws aligned so the player's variant is stable
// (Rush A vs B). The default mirrors what aiOpponent would prefer absent any
// win history — first option in the side's list.
function defaultStrategyFor(state: GameState, aiTeam: Team): string {
  // Avoid importing strategies module here just for the lookup; the most stable
  // pick is the player's own strategy id (which exists on the same map). Falls
  // back to 'Hold' (always present for the defender side on both maps).
  const side = state.teamSide[aiTeam];
  return side === 'attacker' ? 'Execute' : 'Hold';
}
