// AI opponent strategy picker (spec §16). Weighted random over the three
// strategies for the AI team's current side; weights bias toward strategies
// that have won for the AI team this match (`state.aiStrategyWins`).

import type { GameState, PlayedCard, Side, Team } from './types.ts';
import type { Rng } from './rng.ts';
import { regionCentroid, strategyById, strategiesFor } from './strategies.ts';
import { AI_CARD_PLAY_CHANCE, AI_STRATEGY_EXPLORATION, STRATEGY_CARD_THEMES } from './config.ts';
import { cardById } from './cardData.ts';

export function pickAiStrategy(
  state: GameState,
  team: Team,
  side: Side,
  rng: Rng,
): string {
  const options = strategiesFor(side, state.map);
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

// Pass 8 — AI card play (spec §15.6). 70% of rounds the AI plays a card from
// its hand, weighted toward STRATEGY_CARD_THEMES for the chosen strategy. For
// targeted cards the AI auto-picks the target heuristically. Returns null when
// the AI passes on playing a card this round.
export function pickAiCard(
  state: GameState,
  team: Team,
  side: Side,
  strategyId: string,
  rng: Rng,
): PlayedCard | null {
  if (rng.next() > AI_CARD_PLAY_CHANCE) return null;
  const hand = state.cards[team].hand;
  if (hand.length === 0) return null;

  const themed = STRATEGY_CARD_THEMES[strategyId] ?? [];
  const matching = hand.filter((c) => themed.includes(c.defId));
  const pool = matching.length > 0 ? matching : hand;
  const pick = pool[rng.int(pool.length)];
  const def = cardById(pick.defId);
  if (!def) return null;

  const played: PlayedCard = { defId: pick.defId, contributor: pick.contributor };

  // Auto-target per §15.6. Pass 9 m3 — Mark Target uses a runtime trigger
  // now, so no pre-pick target.
  if (def.targeting === 'hex') {
    // Setup Play → primary attack region; Hold the Line → anchor region.
    // Pass A — strategies are slot-based now; take variant[0]'s first slot
    // as the "primary" position for both cards. (Slot 0 is typically the
    // entry/anchor in our authored strategies.)
    const strat = strategyById(strategyId, side, state.map);
    if (!strat) return null;
    const variant = strat.variants[0];
    const regionName = variant[0]?.region ?? strat.fallbackRegion;
    const hex = regionCentroid(state.map, regionName);
    if (!hex) return null;
    played.target = hex;
    if (def.id === 'setup_play') {
      // Bonus ally = first teammate that isn't the Tactician (deterministic).
      const ally = state.units.find((u) => u.team === team && u.id !== pick.contributor);
      if (ally) played.secondaryTarget = ally.id;
    }
  } else if (def.targeting === 'role') {
    // Adapt: pick the first role card present in hand (excluding Adapt itself).
    const roleCards = hand.filter((c) => c.defId === 'spearhead' || c.defId === 'setup_play' || c.defId === 'hold_the_line');
    if (roleCards.length === 0) return null;
    const choice = cardById(roleCards[0].defId);
    if (!choice) return null;
    // The target carries the role name; the handler routes via role.
    played.target = choice.source as PlayedCard['target'];
  }
  return played;
}
