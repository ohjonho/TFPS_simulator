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
  Attributes, Hero, Personality, Role, TacticalTrait, Unit,
  VisibleAttributes, Weapon,
} from './types.ts';
import type { Rng } from './rng.ts';
import {
  ATTRIBUTES, LOADOUT_POOL, PERSONALITIES, PERSONALITY_IDS,
  ROLE_AGGRESSION, TACTICAL_TRAITS, TACTICAL_TRAIT_IDS,
} from './config.ts';

const TACTICALS: readonly TacticalTrait[] = TACTICAL_TRAIT_IDS as readonly TacticalTrait[];
const PERSONALITIES_LIST: readonly Personality[] = PERSONALITY_IDS as readonly Personality[];
const ROLES: readonly Role[] = ['Vanguard', 'Tactician', 'Warden', 'Specialist'];
const HEROES: readonly Hero[] = ['Angelic', 'Techy', 'Cursed'];

// Clamp a number to [0, 100] for attribute deltas.
function clamp100(v: number): number {
  return Math.max(0, Math.min(100, v));
}

// Apply a trait/personality's sub-attribute bonus deltas to a unit. Each
// `attrBonuses` is a partial map keyed by attribute name; we add the delta and
// clamp into [0, 100] so a stacked bonus never escapes the rating scale.
function applyAttrBonuses(u: Unit, bonuses: Record<string, number> | undefined): void {
  if (!bonuses) return;
  const attrs = u.attributes as unknown as Record<string, number>;
  for (const [key, delta] of Object.entries(bonuses)) {
    if (typeof attrs[key] === 'number') attrs[key] = clamp100(attrs[key] + delta);
  }
}

// Pick two DISTINCT entries from a pool with exactly two seeded draws (no retry
// loop, so the rng-draw count is fixed → determinism-stable).
function pickTwoDistinct<T>(rng: Rng, pool: readonly T[]): T[] {
  const n = pool.length;
  if (n <= 1) return pool.slice(0, n);
  const i = rng.int(n);
  let j = rng.int(n - 1);
  if (j >= i) j++;
  return [pool[i], pool[j]];
}

export type AttributeOverride = Partial<
  Pick<Unit, 'tacticalTraits' | 'personality' | 'role' | 'preferredRole' | 'hero'>
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
  // An override key that is *present* is honored literally — even when empty/null
  // (meaning "no traits"); only an absent key randomizes. This keeps A/B tests
  // clean (e.g. "vanilla" = explicit []/null).
  // v0.29.0 — draw TWO distinct tactical traits (from the 8-pool) + ONE
  // personality (from the 4 quadrants).
  u.tacticalTraits = 'tacticalTraits' in override
    ? override.tacticalTraits!
    : pickTwoDistinct(rng, TACTICALS);
  u.personality = 'personality' in override
    ? override.personality!
    : rng.pick(PERSONALITIES_LIST);

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
    baseAggression: ROLE_AGGRESSION[role],
    offPosition: role !== preferred,
    retreatThresholdMod: 0,
  };

  // Pass A1 / H1 — roll the 10 sub-attributes. Pass E m5: rangeOverride
  // flattens generation to a uniform window for randomize/draft modes.
  const generated = generateAttributes(rng, rangeOverride);
  u.attributes = { ...generated };

  // v0.29.0 — apply tactical-trait + personality sub-attribute bonuses on top of
  // the random roll. Order: tactical traits (in draw order) → personality (stacks
  // compose). Each clamps to [0, 100] so a stacked bonus can't escape the scale.
  for (const t of u.tacticalTraits) applyAttrBonuses(u, TACTICAL_TRAITS[t]?.attrBonuses);
  applyAttrBonuses(u, u.personality ? PERSONALITIES[u.personality]?.attrBonuses : undefined);

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
