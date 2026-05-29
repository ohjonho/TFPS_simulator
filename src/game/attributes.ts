// Per-unit attribute + trait + role + hero assignment at match start
// (spec §4). Deterministic given the seeded RNG.
//
// `rollUnitMeta(unit, rng)` is the shared per-unit roller — picks one
// skill / behavioral / personality trait, a role + preferredRole, a hero,
// and the 10 hidden sub-attributes via `generateAttributes`. Applies
// trait sub-attribute deltas on top of the rolled values.
//
// `assignAttributes(units, rng, overrides?)` runs `rollUnitMeta` across
// a team, with optional per-unit overrides for headless A/B testing.
//
// `aggregateVisible(attrs)` is the visible 5 aggregates (Mechanics / Game
// Sense / Discipline / Improvisation / Leadership) — a weighted sum of
// the hidden 10 per `ATTRIBUTES.aggregation`. Display-only; combat /
// vision read the hidden subs directly.
//
// `generateAttributes(rng, rangeOverride?)` is the sample-per-sub helper.
// Distribution = `ATTRIBUTES.generation.distribution` (flat / normal /
// uniform); `rangeOverride` lets Draft mode pin to [40, 60] regardless
// of the global distribution.

import type {
  Attributes, BehavioralTrait, Hero, PersonalityTrait, Role, SkillTrait, Unit,
  VisibleAttributes, Weapon,
} from './types.ts';
import type { Rng } from './rng.ts';
import {
  ATTRIBUTES, BEHAVIORAL_TRAIT_IDS, LOADOUT_POOL,
  PERSONALITY_TRAIT_IDS, ROLE_AGGRESSION, SKILL_TRAIT_IDS, TRAITS_BY_ID,
} from './config.ts';

const SKILL_TRAITS: readonly SkillTrait[] = SKILL_TRAIT_IDS as readonly SkillTrait[];
const BEHAVIORAL_TRAITS: readonly BehavioralTrait[] = BEHAVIORAL_TRAIT_IDS as readonly BehavioralTrait[];
const PERSONALITY_TRAITS: readonly PersonalityTrait[] = PERSONALITY_TRAIT_IDS as readonly PersonalityTrait[];
const ROLES: readonly Role[] = ['Vanguard', 'Tactician', 'Warden', 'Specialist'];
const HEROES: readonly Hero[] = ['Angelic', 'Techy', 'Cursed'];

// Pass H2 — clamp a number to [0, 100] for attribute deltas.
function clamp100(v: number): number {
  return Math.max(0, Math.min(100, v));
}

// Pass H2 — apply a trait's sub-attribute bonus deltas to a unit's
// attributes record. Each trait's `attrBonuses` is a partial map keyed by
// attribute name; we add the delta and clamp back into [0, 100] so a
// stacked bonus never escapes the rating scale (e.g. Aim 90 + Sharp Aim
// +15 = 100, not 105).
function applyTraitBonuses(u: Unit, traitId: string | null): void {
  if (!traitId) return;
  const def = TRAITS_BY_ID[traitId];
  if (!def) return;
  const attrs = u.attributes as unknown as Record<string, number>;
  for (const [key, delta] of Object.entries(def.attrBonuses)) {
    if (typeof attrs[key] === 'number') {
      attrs[key] = clamp100(attrs[key] + (delta as number));
    }
  }
}

export type AttributeOverride = Partial<
  Pick<Unit, 'skillTrait' | 'behavioralTrait' | 'personalityTrait' | 'role' | 'preferredRole' | 'hero'>
> & {
  // Pass A1 / H1 — pin individual attribute ratings for batch/A-B tests.
  // Any key present here is honored literally (post-trait-bonus application);
  // absent keys are random-generated then trait-modified.
  attributes?: Partial<Attributes>;
};

// Truncated-normal sample via Box–Muller, clamped to [min, max]. Rejection
// retry is unnecessary at the design's sd=12 / clamp=[10,90] (clamp affects
// <0.05% of samples), so we accept the tiny tail-clipping bias.
function sampleNormal(rng: Rng, mean: number, stdDev: number, min: number, max: number): number {
  // Box–Muller transform. u1 must be > 0 for log; rng.next() returns [0,1).
  const u1 = Math.max(rng.next(), 1e-12);
  const u2 = rng.next();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const raw = mean + z * stdDev;
  return Math.round(Math.max(min, Math.min(max, raw)));
}

function sampleUniform(rng: Rng, min: number, max: number): number {
  return rng.range(min, max);
}

function sampleAttribute(rng: Rng, rangeOverride?: { min: number; max: number }): number {
  // Pass E m5 — Randomize Units mode passes a uniform range override to clamp
  // every attribute slot to [40, 60] regardless of the global distribution
  // setting. Keeps Standard mode's flat-50 default intact.
  if (rangeOverride) return sampleUniform(rng, rangeOverride.min, rangeOverride.max);
  const g = ATTRIBUTES.generation;
  if (g.distribution === 'flat') return g.mean;  // deterministic baseline
  if (g.distribution === 'normal') return sampleNormal(rng, g.mean, g.stdDev, g.min, g.max);
  return sampleUniform(rng, g.min, g.max);
}

// Pure: returns a fresh Attributes record. Deterministic given the RNG.
// Pass E m5 — accepts an optional `rangeOverride` (e.g. [40, 60]) used by
// Randomize / Draft mode to pin every attribute into a single uniform window.
// Pass H1 — 14 attributes collapsed to 10 hidden subs; the player UI shows
// 5 aggregates instead. Draw order is fixed so determinism holds.
export function generateAttributes(rng: Rng, rangeOverride?: { min: number; max: number }): Attributes {
  return {
    // Mechanics block (4 subs)
    aim:            sampleAttribute(rng, rangeOverride),
    headshot:       sampleAttribute(rng, rangeOverride),
    reflexes:       sampleAttribute(rng, rangeOverride),
    weaponAffinity: sampleAttribute(rng, rangeOverride),
    // Game Sense block (2 subs)
    vision:         sampleAttribute(rng, rangeOverride),
    mapIQ:          sampleAttribute(rng, rangeOverride),
    // Discipline block (1 sub; visible aggregate is 1:1)
    tenacity:       sampleAttribute(rng, rangeOverride),
    // Improvisation block (2 subs)
    composure:      sampleAttribute(rng, rangeOverride),
    adaptability:   sampleAttribute(rng, rangeOverride),
    // Leadership block (1 sub; visible aggregate is 1:1)
    comms:          sampleAttribute(rng, rangeOverride),
  };
}

// Pass H1 — display-only aggregation. Combat / vision read raw sub-attrs;
// only the UI calls this. Pure function of (attrs, weights).
export function aggregateVisible(attrs: Attributes): VisibleAttributes {
  const w = ATTRIBUTES.aggregation;
  const sum = (entries: Record<string, number>): number => {
    let acc = 0;
    for (const [key, weight] of Object.entries(entries)) {
      acc += (attrs as unknown as Record<string, number>)[key] * weight;
    }
    return Math.round(acc);
  };
  return {
    mechanics:     sum(w.mechanics),
    gameSense:     sum(w.gameSense),
    discipline:    sum(w.discipline),
    improvisation: sum(w.improvisation),
    leadership:    sum(w.leadership),
  };
}

// Pass E m5 — pick `n` random loadouts from LOADOUT_POOL with the constraint
// "at least one rifle per team". Slot 0 is pinned to 'rifle', the rest are
// uniform; the result is then shuffled (Fisher-Yates with the same RNG) so
// the rifle isn't always the first unit visually. Deterministic given seed.
export function pickRandomLoadout(rng: Rng, n: number): Weapon[] {
  if (n <= 0) return [];
  const out: Weapon[] = ['rifle'];
  for (let i = 1; i < n; i++) {
    out.push(rng.pick(LOADOUT_POOL));
  }
  // Fisher-Yates shuffle.
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Pass G — extracted from `assignAttributes` so the draft pool generator
// (draft.generatePool) can populate freshly-built pool units with the same
// trait/role/hero/modifiers + attribute logic. Pure: mutates `u` in place.
// Returns nothing.
// Pass H2 — adds a third trait (personality) per unit, and applies each
// trait's sub-attribute bonus deltas on top of the random attribute roll.
// Bonuses are clamped to [0, 100]; explicit override attribute values still
// trump (applied LAST in the merge below).
export function rollUnitMeta(
  u: Unit,
  rng: Rng,
  override: AttributeOverride = {},
  rangeOverride?: { min: number; max: number },
): void {
  // An override key that is *present* is honored literally — even when null
  // (meaning "no trait"); only an absent key randomizes. This keeps A/B tests
  // clean (e.g. "vanilla" = explicit nulls).
  u.skillTrait = 'skillTrait' in override ? override.skillTrait! : rng.pick(SKILL_TRAITS);
  u.behavioralTrait = 'behavioralTrait' in override
    ? override.behavioralTrait!
    : rng.pick(BEHAVIORAL_TRAITS);
  // Pass H2 — personality (mental + social) trait. Inert combat-wise in H2
  // but its attrBonuses apply now + its `unlocks` list expands the team's
  // strategy menu in H3.
  u.personalityTrait = 'personalityTrait' in override
    ? override.personalityTrait!
    : rng.pick(PERSONALITY_TRAITS);

  // Default: assigned role == preferred role (no off-position in normal play;
  // off-position is set when a player assigns an off-role — Pass 7 — or via
  // an explicit override here).
  const preferred = 'preferredRole' in override ? override.preferredRole! : rng.pick(ROLES);
  const role = 'role' in override ? override.role! : preferred;
  u.preferredRole = preferred;
  u.role = role;
  u.hero = 'hero' in override ? override.hero! : rng.pick(HEROES);

  u.modifiers = {
    aggression: ROLE_AGGRESSION[role],
    offPosition: role !== preferred,
    retreatThresholdMod: 0,
  };

  // Pass A1 / H1 — roll the 10 sub-attributes. Pass E m5: rangeOverride
  // flattens generation to a uniform window for randomize/draft modes.
  const generated = generateAttributes(rng, rangeOverride);
  u.attributes = { ...generated };

  // Pass H2 — apply trait sub-attribute bonuses on top of the random roll.
  // Order: skill → behavioral → personality (stacks compose). Each clamps
  // to [0, 100] so a stacked bonus can never escape the rating scale.
  applyTraitBonuses(u, u.skillTrait);
  applyTraitBonuses(u, u.behavioralTrait);
  applyTraitBonuses(u, u.personalityTrait);

  // Explicit attribute overrides land LAST so A/B tests can pin a final
  // value regardless of trait bonus interactions.
  const ao = override.attributes;
  if (ao) u.attributes = { ...u.attributes, ...ao };
}

// Assign attributes to every unit. `overrides` (keyed by unit id) lets callers
// (tests / the batch harness) pin specific attributes for A/B comparisons.
// Pass E m5 — `options.rangeOverride` clamps every attribute slot to a single
// uniform window (used by Randomize Units mode for [40, 60]). Overrides still
// apply on top.
// Pass G — body now delegates to rollUnitMeta so the draft pool generator
// shares the same RNG-draw sequence (determinism stays bit-identical).
export function assignAttributes(
  units: Unit[],
  rng: Rng,
  overrides: Record<string, AttributeOverride> = {},
  options: { rangeOverride?: { min: number; max: number } } = {},
): void {
  for (const u of units) {
    rollUnitMeta(u, rng, overrides[u.id] ?? {}, options.rangeOverride);
  }
}
