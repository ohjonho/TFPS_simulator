// Pass 8 — the 13 card definitions (spec §15.4). Pure data; handlers live in
// cardEffects.ts and read these defs by id. Source labels in the UI come from
// the contributor unit's trait/role/hero combined with the card's `source`.

import type {
  BehavioralTrait,
  CardDef,
  CardSource,
  Hero,
  Role,
} from './types.ts';

// Behavioral trait cards (6) — one per trait, plays off the trait's mechanic.
const TRAIT_CARDS: CardDef[] = [
  {
    id: 'anchor_position',
    name: 'Anchor Position',
    source: 'Sentinel',
    type: 'directive',
    targeting: 'none',
    description:
      "Doubles Sentinel's stationary bonus this round (+50 HR / +40 HS once held 3 ticks). Hold wherever the strategy places you.",
  },
  {
    id: 'reckless_push',
    name: 'Reckless Push',
    source: 'Run-n-Gun',
    type: 'directive',
    targeting: 'none',
    description:
      'Unit ignores retreat all round; +1 movement speed; +15 HR moving. As an attacker, plants the spike 1 tick faster.',
  },
  {
    id: 'slow_flank',
    name: 'Slow Flank',
    source: 'Lurker',
    type: 'directive',
    targeting: 'none',
    description:
      "Unit hugs the perimeter route AND is hidden from enemy AI vision until they fire or close to 3 hexes. True lurker — flank unspotted.",
  },
  {
    id: 'opening_pick',
    name: 'Opening Pick',
    source: 'Entry',
    type: 'buff',
    targeting: 'none',
    description:
      '+30 HR / +15 HS on first 3 ticks of first engagement; no post-engagement penalty this round.',
  },
  {
    id: 'crossfire',
    name: 'Crossfire',
    source: 'Trader',
    type: 'buff',
    targeting: 'none',
    description:
      'If any ally fires, this unit gets +25 HR for 5 ticks after; stackable once.',
  },
  {
    id: 'trade_window',
    name: 'Trade Window',
    source: 'Clutch',
    type: 'buff',
    targeting: 'none',
    description:
      "When any teammate dies, their killer is auto-marked for 4 ticks; surviving allies get +20 HR vs the killer.",
  },
];

// Role cards (4) — one per role.
const ROLE_CARDS: CardDef[] = [
  {
    id: 'spearhead',
    name: 'Spearhead',
    source: 'Vanguard',
    type: 'directive',
    targeting: 'none',
    description:
      'Vanguard takes point on strategy path; +15 HR first engagement; allies follow 2 ticks behind.',
  },
  {
    id: 'setup_play',
    name: 'Setup Play',
    source: 'Tactician',
    type: 'directive',
    // Two-pick: hex (Tactician's destination) plus an ally (the bonus
    // recipient). Pass C2 — bonus fires whenever the ally is within 5 hex
    // of the anchor; no flank-angle gate.
    targeting: 'hex',
    description:
      'Tactician moves to a chosen hex; a named ally gets +20 HR all round while within 5 hex of that anchor.',
  },
  {
    id: 'hold_the_line',
    name: 'Hold the Line',
    source: 'Warden',
    type: 'directive',
    targeting: 'hex',
    description:
      "Warden holds a chosen hex; +20 HR stationary. Allies reaching the anchor get a 3-tick safe window. If anchor is on a planted site's plant zone, defusers on the spike also get the safe window.",
  },
  {
    id: 'adapt',
    name: 'Adapt',
    source: 'Specialist',
    type: 'buff',
    // Player picks one of the three role cards (Spearhead / Setup Play / Hold
    // the Line) — its effect is applied to the Specialist. Pass C2 — also
    // grants the Specialist a flat +10 HR for the entire round on top.
    targeting: 'role',
    description:
      "Specialist gains another role's card effect this round AND a flat +10 HR all round on top.",
  },
];

// Hero cards (3).
const HERO_CARDS: CardDef[] = [
  {
    id: 'guardian_aura',
    name: 'Guardian Aura',
    source: 'Angelic',
    type: 'buff',
    targeting: 'none',
    description:
      'All allies within 5 hexes of this unit get +1 max HP this round; aura moves with the unit.',
  },
  {
    id: 'tactical_scan',
    name: 'Tactical Scan',
    source: 'Techy',
    type: 'utility',
    targeting: 'none',
    description:
      'Reveals all enemy positions for 3 ticks at round start (overrides fog of war).',
  },
  {
    id: 'mark_target',
    name: 'Mark Target',
    source: 'Cursed',
    type: 'buff',
    // Pass 9 m3 — no pre-pick target. Triggers on this unit's first spotted
    // enemy of the round.
    targeting: 'none',
    description:
      "First enemy this unit spots is marked for the round; team sees it for 5 ticks even past LoS; all allied attacks vs it get +20 HR / +10 HS.",
  },
];

export const ALL_CARDS: readonly CardDef[] = [
  ...TRAIT_CARDS,
  ...ROLE_CARDS,
  ...HERO_CARDS,
];

const BY_ID: Record<string, CardDef> = Object.fromEntries(
  ALL_CARDS.map((c) => [c.id, c]),
);
const BY_SOURCE: Record<string, CardDef> = Object.fromEntries(
  ALL_CARDS.map((c) => [c.source, c]),
);

export function cardById(id: string): CardDef | null {
  return BY_ID[id] ?? null;
}

// One card per source — the inverse lookup the deck builder uses.
export function cardFromSource(source: CardSource): CardDef | null {
  return BY_SOURCE[source] ?? null;
}

// Strongly-typed helpers (for callers that already have the narrower type).
// Pass H2 — may return undefined for newly-added behavioral traits (Roamer,
// Hot Head) that don't have card defs. Card system is being removed in H3;
// callers (cards.buildDeck) defensively skip missing entries.
export function cardFromTrait(trait: BehavioralTrait): CardDef | undefined {
  return BY_SOURCE[trait];
}
export function cardFromRole(role: Role): CardDef | undefined {
  return BY_SOURCE[role];
}
export function cardFromHero(hero: Hero): CardDef | undefined {
  return BY_SOURCE[hero];
}
