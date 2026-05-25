// Random per-unit attribute assignment at match start (spec §10–13): one skill
// trait, one behavioral trait, a role (+ preferred role), a hero, and a
// weapon-handling rating. Deterministic given the seeded RNG. Pure: mutates the
// passed unit objects in place (called on freshly-built units).
//
// Pass A1 extension (docs/attributes-design.md): also generates the full 14-
// attribute record per unit and writes it to `u.attributes`. v0 sim math only
// consumes 6 of them (Aim, Rifle/Shotgun/Sniper Handling, Awareness, Clutch);
// the others are generated, displayed in the UI, and inert until v1.

import type { Attributes, BehavioralTrait, Hero, Role, SkillTrait, Unit } from './types.ts';
import type { Rng } from './rng.ts';
import { ATTRIBUTES, ROLE_AGGRESSION } from './config.ts';

const SKILL_TRAITS: readonly SkillTrait[] = ['Sharp Aim', 'Headhunter', 'Eagle Eye', 'First Shot'];
const BEHAVIORAL_TRAITS: readonly BehavioralTrait[] = [
  'Sentinel', 'Run-n-Gun', 'Lurker', 'Entry', 'Trader', 'Clutch',
];
const ROLES: readonly Role[] = ['Vanguard', 'Tactician', 'Warden', 'Specialist'];
const HEROES: readonly Hero[] = ['Angelic', 'Techy', 'Cursed'];

export type AttributeOverride = Partial<
  Pick<Unit, 'skillTrait' | 'behavioralTrait' | 'role' | 'preferredRole' | 'hero'>
> & {
  // Pass A1: pin individual attribute ratings for batch/A-B tests. Any key
  // present here is honored literally; absent keys are random-generated.
  // mapIQ overrides accept partial sub-keys (foundry / atoll).
  // (Pass A3 — `weaponHandling` flat override removed; pin per-weapon handling
  // via attributes.{rifleHandling, shotgunHandling, sniperHandling}.)
  attributes?: Partial<Omit<Attributes, 'mapIQ'>> & { mapIQ?: Partial<Attributes['mapIQ']> };
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

function sampleAttribute(rng: Rng): number {
  const g = ATTRIBUTES.generation;
  return g.distribution === 'normal'
    ? sampleNormal(rng, g.mean, g.stdDev, g.min, g.max)
    : sampleUniform(rng, g.min, g.max);
}

// Pure: returns a fresh Attributes record. Deterministic given the RNG.
export function generateAttributes(rng: Rng): Attributes {
  return {
    aim:             sampleAttribute(rng),
    headshot:        sampleAttribute(rng),
    reflexes:        sampleAttribute(rng),
    sprayControl:    sampleAttribute(rng),
    rifleHandling:   sampleAttribute(rng),
    shotgunHandling: sampleAttribute(rng),
    sniperHandling:  sampleAttribute(rng),
    awareness:       sampleAttribute(rng),
    positioning:     sampleAttribute(rng),
    mapIQ: {
      foundry: sampleAttribute(rng),
      atoll:   sampleAttribute(rng),
    },
    clutch:          sampleAttribute(rng),
    composure:       sampleAttribute(rng),
    confidence:      sampleAttribute(rng),
    teamwork:        sampleAttribute(rng),
    discipline:      sampleAttribute(rng),
    communication:   sampleAttribute(rng),
  };
}

// Assign attributes to every unit. `overrides` (keyed by unit id) lets callers
// (tests / the batch harness) pin specific attributes for A/B comparisons.
export function assignAttributes(
  units: Unit[],
  rng: Rng,
  overrides: Record<string, AttributeOverride> = {},
): void {
  for (const u of units) {
    const o = overrides[u.id] ?? {};
    // An override key that is *present* is honored literally — even when null
    // (meaning "no trait"); only an absent key randomizes. This keeps A/B tests
    // clean (e.g. "vanilla" = explicit nulls).
    u.skillTrait = 'skillTrait' in o ? o.skillTrait! : rng.pick(SKILL_TRAITS);
    u.behavioralTrait = 'behavioralTrait' in o ? o.behavioralTrait! : rng.pick(BEHAVIORAL_TRAITS);
    // Default: assigned role == preferred role (no off-position in normal play;
    // off-position is set when a player assigns an off-role — Pass 7 — or via
    // an explicit override here).
    const preferred = 'preferredRole' in o ? o.preferredRole! : rng.pick(ROLES);
    const role = 'role' in o ? o.role! : preferred;
    u.preferredRole = preferred;
    u.role = role;
    u.hero = 'hero' in o ? o.hero! : rng.pick(HEROES);

    u.modifiers = {
      aggression: ROLE_AGGRESSION[role],
      offPosition: role !== preferred,
      retreatThresholdMod: 0,
    };

    // Pass A1: roll the full 14-attribute record. Order of RNG draws is fixed
    // by generateAttributes() so determinism holds across A2+ even after
    // partial-override merges.
    const generated = generateAttributes(rng);
    const ao = o.attributes;
    if (ao) {
      u.attributes = {
        ...generated,
        ...ao,
        mapIQ: { ...generated.mapIQ, ...(ao.mapIQ ?? {}) },
      };
    } else {
      u.attributes = generated;
    }
  }
}
