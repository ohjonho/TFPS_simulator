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
  Team,
} from './types.ts';
import { applyStrategies } from './match.ts';
import { findPath, findPerimeterPath } from './pathfind.ts';
import { createRng } from './rng.ts';
import { CARD_EFFECTS } from './config.ts';
import { evaluateDirectives } from './directives.ts';
import { initialAi } from './state.ts';

export type PlayerSelection = {
  strategyId: string | null;
};

export type PlanPreview = {
  // Per player-unit target hex after applyStrategies + applyCards.
  targets: Record<string, HexCoord | null>;
  // Per player-unit A* route from current pos to target (full path including
  // start hex). Empty record if no strategy is selected.
  routes: Record<string, HexCoord[]>;
  // Per player-unit START position after strategy-aware spawn optimization
  // (applyStrategies relocates defenders to the spawn cell nearest their target
  // on optimizeSpawns maps). The UI snaps units here on pick so they sit at the
  // route origin instead of the corner. Equals the current pos on non-optimize
  // maps (no-op there).
  positions: Record<string, HexCoord>;
};

export function previewPlayerPlan(state: GameState, sel: PlayerSelection): PlanPreview {
  const empty: PlanPreview = { targets: {}, routes: {}, positions: {} };
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
  // Pass C — honor the player's explicit A/B variant choice so the preview
  // routes shift the moment a different variant is selected. Same RNG, same
  // AI variant — so reverting to the original A or B yields identical routes.
  const s = applyStrategies(
    state, state.playerTeam, sel.strategyId, aiTeam, aiStrategyId, pickRng,
    state.playerVariantChoice,
  );
  // H3.4 — commitCards removed; applyStrategies already populates strategy
  // synergies + hero passives directly into cardFlags / cardEffects.

  const targets: Record<string, HexCoord | null> = {};
  const routes: Record<string, HexCoord[]> = {};
  const positions: Record<string, HexCoord> = {};
  for (const u of s.units) {
    if (u.team !== state.playerTeam) continue;
    // `s` has the post-optimizeSpawns positions; surface them so the UI can
    // place the unit at the route origin during planning.
    positions[u.id] = { ...u.pos };
    // Pass 9: ask the directive evaluator what target the unit will actually
    // pursue at tick 1. If a directive provides a target (commit_site, peek,
    // safe_sniper reposition), use it; otherwise fall back to the strategy
    // target so the preview matches the legacy "go to region" path.
    const directiveDecision = evaluateDirectives(u, s, initialAi(), []);
    const goal = directiveDecision?.target ?? s.targets[u.id];
    targets[u.id] = goal;
    if (!goal) continue;
    const useSlow = !!u.cardFlags.slowFlank;
    const path = useSlow
      ? findPerimeterPath(s.map, u.pos, goal, CARD_EFFECTS.slowFlank.perimeterPenalty) ?? findPath(s.map, u.pos, goal)
      : findPath(s.map, u.pos, goal);
    if (path && path.length > 1) routes[u.id] = path;
  }
  return { targets, routes, positions };
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
