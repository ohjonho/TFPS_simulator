// Strategy-menu helper (decoupled from traits as of v0.28.0). Pure: no DOM,
// no rendering, deterministic.

import type { MapDefinition, Side, Unit } from './types.ts';
import { strategiesFor, strategyById } from './strategies.ts';

// v0.28.0 (Pass 2a) — the strategy menu is DECOUPLED from traits. Traits now
// only modulate units; they no longer gate the strategy list. Every roster sees
// the same menu: all strategies that aren't `requiresUnlock` (the consolidated
// set in strategies.ts — the retired trait-unlock strategies were removed). The
// `requiresUnlock` seam stays so the future management layer can gate strategies
// via progression instead of "which traits you happened to roll".
export function availableStrategies(
  units: readonly Unit[],
  side: Side,
  map: MapDefinition,
): ReturnType<typeof strategiesFor> {
  void units; // roster no longer affects the menu (kept for signature stability)
  void strategyById; // id-only lookup escape hatch (AI opponent / __sim)
  return strategiesFor(side, map).filter((s) => !s.requiresUnlock);
}

// Diagnostic: for each unlocked strategy id, return the contributor units
// (unit id + trait id) so the UI / draft preview can show "available because
// of: Lurker (D2)" tooltips. H4 consumes this.
export type UnlockContributor = { unitId: string; traitId: string };

export function unlockContributors(units: readonly Unit[]): Record<string, UnlockContributor[]> {
  // v0.28.0 — strategies are no longer trait-unlocked (the menu is decoupled),
  // so there's nothing to attribute. Kept as a `{}`-returning seam for the UI +
  // the future management/progression layer.
  void units;
  return {};
}
