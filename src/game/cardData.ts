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
      'Unit holds spawn-side position all round; doubles trait bonus (+50 HR / +40 HS stationary).',
  },
  {
    id: 'reckless_push',
    name: 'Reckless Push',
    source: 'Run-n-Gun',
    type: 'directive',
    targeting: 'none',
    description:
      'Unit ignores retreat all round; +1 movement speed; +15 HR moving.',
  },
  {
    id: 'slow_flank',
    name: 'Slow Flank',
    source: 'Lurker',
    type: 'directive',
    targeting: 'none',
    description:
      'Unit takes the longest perimeter route to its region; +20 HR wall-adjacent; arrives unspotted longer.',
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
    id: 'last_stand',
    name: 'Last Stand',
    source: 'Clutch',
    type: 'buff',
    targeting: 'none',
    description:
      'If last alive: +30 HR / +20 HS AND skip next ghost marker (vanish 5 ticks).',
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
    // Two-pick: hex (Tactician's destination) plus an ally (the flank bonus
    // recipient). The UI flow picks hex first, then ally.
    targeting: 'hex',
    description:
      'Tactician moves to a chosen hex first; a named ally gets +20 HR if engaging from a flank angle (>60° off enemy facing).',
  },
  {
    id: 'hold_the_line',
    name: 'Hold the Line',
    source: 'Warden',
    type: 'directive',
    targeting: 'hex',
    description:
      'Warden holds a chosen hex; +20 HR stationary; allies reaching that hex get a 3-tick safe window.',
  },
  {
    id: 'adapt',
    name: 'Adapt',
    source: 'Specialist',
    type: 'buff',
    // Player picks one of the three role cards (Spearhead / Setup Play / Hold
    // the Line) — its effect is applied to the Specialist instead.
    targeting: 'role',
    description:
      "Specialist gains another role's card effect for the round (must be a role on the team).",
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
      'Reveals all enemy positions for 5 ticks at round start (overrides fog of war).',
  },
  {
    id: 'mark_target',
    name: 'Mark Target',
    source: 'Cursed',
    type: 'buff',
    targeting: 'enemy',
    description:
      'Choose 1 enemy; all allied attacks against that unit get +20 HR / +10 HS for the round.',
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
export function cardFromTrait(trait: BehavioralTrait): CardDef {
  return BY_SOURCE[trait]; // present for every behavioral trait
}
export function cardFromRole(role: Role): CardDef {
  return BY_SOURCE[role];
}
export function cardFromHero(hero: Hero): CardDef {
  return BY_SOURCE[hero];
}
