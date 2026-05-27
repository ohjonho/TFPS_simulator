// Pass H2 — trait → strategy unlock helpers.
//
// Each `TraitDef` (in config.TRAITS_BY_ID) carries an `unlocks: string[]`
// list of strategy ids. A roster's available strategies = the baseline 3
// (always present per side) + the deduped union of every alive unit's three
// traits' unlocks (filtered to strategies that actually exist for the side).
//
// H2 wires the helper but H3 builds the actual unlocked strategies — so
// today this returns "baseline + nothing-extra" until strategy ids matching
// the unlock strings start to exist. The filter step (`actualUnlocks`) keeps
// the system forward-compatible: future H3 strategies appear automatically
// without rewiring this module.
//
// Pure: no DOM, no rendering, deterministic.

import type { MapDefinition, Side, Unit } from './types.ts';
import { TRAITS_BY_ID } from './config.ts';
import { strategiesFor, strategyById } from './strategies.ts';

// Read every alive unit's three traits and collect the deduped union of all
// strategy unlock ids. Includes ids that don't yet match any strategy — the
// caller is responsible for filtering against the side-relevant strategy list.
export function rosterUnlocks(units: readonly Unit[]): Set<string> {
  const out = new Set<string>();
  for (const u of units) {
    if (u.state !== 'alive') continue;
    for (const traitId of [u.skillTrait, u.behavioralTrait, u.personalityTrait]) {
      if (!traitId) continue;
      const def = TRAITS_BY_ID[traitId];
      if (!def) continue;
      for (const stratId of def.unlocks) out.add(stratId);
    }
  }
  return out;
}

// The team's full strategy menu = baseline (always available for the side)
// + unlocked variants that match a real strategy id for the side.
// Returns whatever `strategiesFor` returns for an unlocked id (so H3 can
// just add new strategy definitions; this helper picks them up).
export function availableStrategies(
  units: readonly Unit[],
  side: Side,
  map: MapDefinition,
): ReturnType<typeof strategiesFor> {
  const baseline = strategiesFor(side, map);
  const baselineIds = new Set(baseline.map((s) => s.id));
  const unlocks = rosterUnlocks(units);
  const extras = [];
  for (const id of unlocks) {
    if (baselineIds.has(id)) continue;
    const strat = strategyById(id, side, map);
    if (strat) extras.push(strat);
  }
  return [...baseline, ...extras];
}

// Diagnostic: for each unlocked strategy id, return the contributor units
// (unit id + trait id) so the UI / draft preview can show "available because
// of: Lurker (D2)" tooltips. H4 consumes this.
export type UnlockContributor = { unitId: string; traitId: string };

export function unlockContributors(units: readonly Unit[]): Record<string, UnlockContributor[]> {
  const out: Record<string, UnlockContributor[]> = {};
  for (const u of units) {
    if (u.state !== 'alive') continue;
    for (const traitId of [u.skillTrait, u.behavioralTrait, u.personalityTrait]) {
      if (!traitId) continue;
      const def = TRAITS_BY_ID[traitId];
      if (!def) continue;
      for (const stratId of def.unlocks) {
        if (!out[stratId]) out[stratId] = [];
        out[stratId].push({ unitId: u.id, traitId });
      }
    }
  }
  return out;
}
