// The bye-week (week 5) off-week focus — the player locks in how the squad spends
// its only match-free week, and it lands as a real TRADE-OFF on the season. Pure:
// maps the chosen focus to a list of Effect verbs (the same vocab events trade in)
// so the change is applied + DISPLAYED through the shared effect machinery. The
// magnitudes stay small + hidden (shown as direction arrows, per the no-numbers
// rule) — the choice is "what kind of week", not a stat-math puzzle.

import type { Effect } from './events/types.ts';

export type OffWeekFocus = 'train' | 'morale' | 'balance' | 'undecided';

// Each focus is a deliberate trade-off, never a free win:
//   train     — hard graft: sharper hands, but the grind wears on the mood.
//   morale    — pull back: a happier, steadier room, but no edge on the server.
//   balance   — split the week (and tidy the shop): smaller gains on both, plus
//               a little sponsor goodwill (League Points).
//   undecided — drift: the week slips by. A missed opportunity, not a punishment.
const FOCUS_EFFECTS: Record<OffWeekFocus, Effect[]> = {
  train: [
    { op: 'attr', scope: 'team', agg: 'mechanics', amount: 4 },
    { op: 'morale', scope: 'team', amount: -6 },
  ],
  morale: [
    { op: 'morale', scope: 'team', amount: 10 },
    { op: 'attr', scope: 'team', agg: 'improvisation', amount: 2 },
  ],
  balance: [
    { op: 'attr', scope: 'team', agg: 'mechanics', amount: 2 },
    { op: 'morale', scope: 'team', amount: 4 },
    { op: 'leaguePoints', amount: 10 },
  ],
  undecided: [],
};

export function offWeekEffects(focus: OffWeekFocus): Effect[] {
  return FOCUS_EFFECTS[focus];
}
