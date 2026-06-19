// Player + team name generation, and the short map label derived from a handle.
//
// Names are pure flavor — they never touch combat — so `assignNames` is called
// AFTER all sim rolls (attributes/traits/role/hero) in the construction path. It
// draws from the passed rng, but because it runs last it doesn't shift the rolls
// that feed the sim, so a given (map, seed) reproduces the same MATCH it always
// did; only the handles are new. Deterministic given the rng.

import type { Rng } from './rng.ts';
import type { Unit } from './types.ts';

// Esports-style single-word handles. Deliberately avoid role/trait words
// (Warden, Anchor, Hunter, …) so a handle never reads as a mechanic.
const HANDLES: readonly string[] = [
  'Vex', 'Klutch', 'Nyx', 'Riser', 'Specter', 'Crash', 'Volt', 'Zephyr', 'Onyx', 'Blitz',
  'Razor', 'Echo', 'Surge', 'Frost', 'Talon', 'Vapor', 'Quake', 'Drift', 'Striker', 'Cobra',
  'Maverick', 'Saint', 'Hex', 'Rogue', 'Pyro', 'Static', 'Wraith', 'Apex', 'Comet', 'Dagger',
  'Ember', 'Glitch', 'Havoc', 'Ion', 'Jolt', 'Karma', 'Lynx', 'Mako', 'Nova', 'Orbit',
  'Pulse', 'Quill', 'Sable', 'Tempo', 'Umbra', 'Viper', 'Xero', 'Yeti', 'Zen', 'Ace',
  'Bolt', 'Cipher', 'Dash', 'Flux', 'Grit', 'Halo', 'Juno', 'Kilo', 'Loki', 'Mirage',
  'Neon', 'Otto', 'Prism', 'Reef', 'Slate', 'Tundra', 'Vault', 'Wisp', 'Zico', 'Crux',
];

// Team-name fragments — "The <Adj> <Noun>" or "<Noun>" so opponents read as orgs.
const TEAM_PREFIX: readonly string[] = ['Crimson', 'Iron', 'Night', 'Solar', 'Frost', 'Apex', 'Void', 'Wild', 'Storm', 'Ember'];
const TEAM_NOUN: readonly string[] = ['Wreckers', 'Vanguards', 'Reapers', 'Foxes', 'Titans', 'Wolves', 'Circuit', 'Surge', 'Syndicate', 'Dynamo'];

// Pick a handle not already in `used`, biased through the rng. Falls back to a
// numbered handle if the pool is exhausted (won't happen at roster sizes).
function pickHandle(rng: Rng, used: Set<string>): string {
  const free = HANDLES.filter((h) => !used.has(h));
  const pool = free.length > 0 ? free : HANDLES;
  let name = rng.pick(pool);
  if (used.has(name)) name = `${name}${used.size}`;
  used.add(name);
  return name;
}

// Assign a unique handle to each unit. `used` lets a caller keep names distinct
// across several rosters built from one rng (e.g. both teams in standard mode).
export function assignNames(units: readonly Unit[], rng: Rng, used: Set<string> = new Set()): void {
  for (const u of units) u.name = pickHandle(rng, used);
}

// A team/org name for an opponent (campaign). Deterministic given the rng.
export function generateTeamName(rng: Rng): string {
  return `${rng.pick(TEAM_PREFIX)} ${rng.pick(TEAM_NOUN)}`;
}

// Short uppercase label for the unit's hex marker — the shortest prefix of the
// handle (2 chars, 3 on collision) that's unique among the units passed. Pure +
// deterministic. Used by the renderer so the map reads as players, not slots.
export function shortLabels(units: readonly Unit[]): Record<string, string> {
  const base = (n: string, len: number) => (n || '?').slice(0, len).toUpperCase();
  const out: Record<string, string> = {};
  // Start everyone at 2 chars, then bump any colliding group to 3.
  let len = 2;
  let pending = units.slice();
  while (pending.length > 0 && len <= 3) {
    const byLabel = new Map<string, Unit[]>();
    for (const u of pending) {
      const l = base(u.name, len);
      if (!byLabel.has(l)) byLabel.set(l, []);
      byLabel.get(l)!.push(u);
    }
    const next: Unit[] = [];
    for (const [label, group] of byLabel) {
      if (group.length === 1 || len === 3) {
        for (const u of group) out[u.id] = label;
      } else {
        next.push(...group); // collision — retry this group at len+1
      }
    }
    pending = next;
    len++;
  }
  return out;
}
