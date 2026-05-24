// Random per-unit attribute assignment at match start (spec §10–13): one skill
// trait, one behavioral trait, a role (+ preferred role), a hero, and a
// weapon-handling rating. Deterministic given the seeded RNG. Pure: mutates the
// passed unit objects in place (called on freshly-built units).

import type { BehavioralTrait, Hero, Role, SkillTrait, Unit } from './types.ts';
import type { Rng } from './rng.ts';
import { ROLE_AGGRESSION, WEAPON_HANDLING_RANGE } from './config.ts';

const SKILL_TRAITS: readonly SkillTrait[] = ['Sharp Aim', 'Headhunter', 'Eagle Eye', 'First Shot'];
const BEHAVIORAL_TRAITS: readonly BehavioralTrait[] = [
  'Sentinel', 'Run-n-Gun', 'Lurker', 'Entry', 'Trader', 'Clutch',
];
const ROLES: readonly Role[] = ['Vanguard', 'Tactician', 'Warden', 'Specialist'];
const HEROES: readonly Hero[] = ['Angelic', 'Techy', 'Cursed'];

export type AttributeOverride = Partial<
  Pick<Unit, 'skillTrait' | 'behavioralTrait' | 'role' | 'preferredRole' | 'hero'>
> & { weaponHandling?: number };

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
      weaponHandling:
        'weaponHandling' in o ? o.weaponHandling! : rng.range(WEAPON_HANDLING_RANGE.min, WEAPON_HANDLING_RANGE.max),
      offPosition: role !== preferred,
      retreatThresholdMod: 0,
    };
  }
}
