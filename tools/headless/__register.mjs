// Headless validation harness — register the .ts resolver shim, then run any
// runner that imports from src/game/batch.ts under Node v24 (type-stripping is
// on by default; erasableSyntaxOnly guarantees the graph is strippable).
//
// USAGE (from the project root, tactical-fps-sim/):
//   node --import ./tools/headless/__register.mjs <runner>.ts
//
// A runner imports the harness, e.g.:
//   import { runStrategyRound, determinismCheck } from './src/game/batch.ts';
//   import { setHeroAbilitiesEnabled } from './src/game/config.ts';
//   // runStrategyRound(seed, { defenderStrategy, attackerStrategy, mapName,
//   //   overrides, attackerVariantIdx }) → { winner, events, defAlive, atkAlive }
//   // overrides: per-unit AttributeOverride keyed D1..D5 / A1..A5 (standard
//   //   roster, flat attrs): { tacticalTraits:[2], personality, role, hero }.
//   // setHeroAbilitiesEnabled(false) → hero-neutral structural-floor measurement.
//   // determinismCheck(seeds, map) must report seeds/seeds — the hard gate.
//
// Notes: maps are 'Foundryv2' | 'Atoll_v2' | 'Canyon' | 'Foundryv3'. Strategy
// A/B variant is a blind seeded coin-flip; pass attackerVariantIdx (0=A,1=B) to
// force it (Control is single-variant, can't be forced). The sim runs ~0.5s/round
// under this loader — size boards Foundry-only + low seeds to iterate, confirm on
// all 3 maps. Write temp runners/outputs at the project root and delete them
// before committing (they're untracked junk); this shim is the only tracked part.
import { register } from 'node:module';
register('./__loader.mjs', import.meta.url);
