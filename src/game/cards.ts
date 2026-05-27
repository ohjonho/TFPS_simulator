// Pass 8 — deck/hand/discard mechanics. Pure. All RNG goes through the seeded
// PRNG so shuffles and draws replay identically.
//
// Spec §15:
//   - Each unit contributes 3 cards (trait, role, hero) → 9-card deck per team.
//   - Starting hand 3; per round play up to 1, draw 1; hand cap 3.
//   - Used cards shuffle back into the deck (deck never empties).
//   - Cards persist across halftime and sudden death.

import type {
  CardInstance,
  TeamDeck,
  Unit,
} from './types.ts';
import { cardFromHero, cardFromRole, cardFromTrait } from './cardData.ts';
import type { Rng } from './rng.ts';

export function buildDeck(units: readonly Unit[], rng: Rng): TeamDeck {
  const deck: CardInstance[] = [];
  for (const u of units) {
    // Each unit contributes up to 3 cards. Pass H2 — added Roamer / Hot Head
    // behavioral traits don't have card defs (the card system is being
    // dismantled in H3 entirely). Skip missing cards so deck-build doesn't
    // crash on those traits in the meantime.
    if (u.behavioralTrait) {
      const traitCard = cardFromTrait(u.behavioralTrait);
      if (traitCard) deck.push({ defId: traitCard.id, contributor: u.id });
    }
    const roleCard = cardFromRole(u.role);
    if (roleCard) deck.push({ defId: roleCard.id, contributor: u.id });
    const heroCard = cardFromHero(u.hero);
    if (heroCard) deck.push({ defId: heroCard.id, contributor: u.id });
  }
  return { deck: shuffle(deck, rng), hand: [], discard: [] };
}

// Fisher–Yates with the seeded RNG. Returns a new array; input not mutated.
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Draw up to `n` cards from the deck into the hand, capping the hand at
// `handCap`. When the deck runs empty mid-draw, shuffle the discard back in
// (spec: deck never empties). Returns a new TeamDeck.
export function drawCards(
  deckState: TeamDeck,
  n: number,
  rng: Rng,
  handCap = 3,
): TeamDeck {
  let { deck, hand, discard } = {
    deck: deckState.deck.slice(),
    hand: deckState.hand.slice(),
    discard: deckState.discard.slice(),
  };
  const want = Math.max(0, Math.min(n, handCap - hand.length));
  for (let i = 0; i < want; i++) {
    if (deck.length === 0) {
      if (discard.length === 0) break; // deck and discard both empty — no draw
      deck = shuffle(discard, rng);
      discard = [];
    }
    hand.push(deck.shift()!);
  }
  return { deck, hand, discard };
}

// Move a card from hand[idx] to a "played" position (caller handles where the
// played card goes — usually onto state.playedCard until round end, then into
// discard via discardPlayed). Pure; returns the new deck state plus the card.
export function playCard(
  deckState: TeamDeck,
  handIdx: number,
): { deck: TeamDeck; played: CardInstance } | null {
  if (handIdx < 0 || handIdx >= deckState.hand.length) return null;
  const played = deckState.hand[handIdx];
  const hand = deckState.hand.slice();
  hand.splice(handIdx, 1);
  return { deck: { ...deckState, hand }, played };
}

// Push a played card onto the discard pile AND remove the matching card
// from the hand (called at endRound). Pre-fix: the function only added to
// discard and the hand stayed at cap, so drawCards(1) was a silent no-op —
// the hand never cycled. Match by `defId` + `contributor` so identical
// duplicates are still distinguishable in deck-trace tests.
export function discardPlayed(
  deckState: TeamDeck,
  played: CardInstance,
): TeamDeck {
  const idx = deckState.hand.findIndex(
    (c) => c.defId === played.defId && c.contributor === played.contributor,
  );
  const hand = idx >= 0 ? deckState.hand.slice(0, idx).concat(deckState.hand.slice(idx + 1)) : deckState.hand.slice();
  return { ...deckState, hand, discard: [...deckState.discard, played] };
}

// Find the hand index of a card by def id (first match). Used by AI and __sim
// hooks that select by def id rather than position.
export function findInHand(deckState: TeamDeck, defId: string): number {
  return deckState.hand.findIndex((c) => c.defId === defId);
}
