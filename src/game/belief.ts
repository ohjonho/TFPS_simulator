// Persistent per-team belief store (AI read/adapt substrate, Phase 2).
//
// Fixes perception starvation at the source: the older fair signals (cones,
// ~3-tick ghosts, 1-enemy tracking) meant a team never "knew" more than ~2 of 5
// enemies and forgot in ticks, so any read/fake/bait mechanic was starved at
// the input. This store keeps, per team, a per-cell expectation of where the
// ALIVE enemies are, with the three properties tactical reading needs:
//
//   1. DECAY, NOT DELETION — a sighting fades toward uniform instead of
//      vanishing with the ghost ("they were at A 10 ticks ago" stays a weak
//      A-lean).
//   2. NEGATIVE EVIDENCE — cells the team currently sees with nobody on them
//      are zeroed for unseen mass: CLEARING an area is informative ("we see A
//      is empty → they're B"), the inference every fake/bait rests on.
//   3. REDISTRIBUTION PRIOR — total mass always equals the live enemy count,
//      so "which site is heavier?" is ALWAYS well-defined, not undefined-
//      until-two-sightings.
//
// Fair info only: inputs are the team's own shared visibility + enemy
// positions for enemies that visibility actually contains — the same signals
// ghosts/tracking already use. No omniscient peek at hidden units.
//
// Pure + deterministic: arithmetic only, fixed iteration order, no RNG. The
// store is a flat row-major number[] (width × height) per team, kept on
// GameState (reset each round) so replay/determinism semantics match ghosts.
// CELL-level on purpose — regions overlap (sub-zones fold into parents), so a
// region-level store would double-count; cells are an exact partition and
// region reads are on-demand sums (beliefInRegions).

import type { MapDefinition, Team, Unit, Visibility } from './types.ts';
import { passableAt } from './pathfind.ts';
import { BELIEF } from './config.ts';

// Passable-cell index list, memoized per map (geometry is static).
const passableCache = new Map<string, number[]>();

function passableIndices(map: MapDefinition): number[] {
  const cached = passableCache.get(map.name);
  if (cached) return cached;
  const idx: number[] = [];
  for (let row = 0; row < map.height; row++) {
    for (let col = 0; col < map.width; col++) {
      if (passableAt(map, { col, row })) idx.push(row * map.width + col);
    }
  }
  passableCache.set(map.name, idx);
  return idx;
}

// Advance both teams' belief grids one tick. `units` are the post-move units;
// `visibility` is the same post-move team visibility ghosts/tracking update
// from, so beliefs are consumed (like ghosts) with a one-tick lag by the next
// tick's AI. An empty prev array (round start) is treated as a uniform prior.
export function updateBeliefs(
  prev: Record<Team, number[]>,
  units: readonly Unit[],
  visibility: Visibility,
  map: MapDefinition,
): Record<Team, number[]> {
  const size = map.width * map.height;
  const passable = passableIndices(map);
  const P = passable.length;
  const out: Record<Team, number[]> = { defenders: [], attackers: [] };

  for (const team of ['defenders', 'attackers'] as const) {
    const enemyTeam: Team = team === 'defenders' ? 'attackers' : 'defenders';
    const vis = visibility[team];
    const prevW = prev[team];
    const hasPrev = prevW.length === size;

    let alive = 0;
    const pinned: number[] = [];
    for (const e of units) {
      if (e.team !== enemyTeam || e.state !== 'alive') continue;
      alive++;
      if (vis.has(`${e.pos.col},${e.pos.row}`)) pinned.push(e.pos.row * map.width + e.pos.col);
    }
    const unpinned = alive - pinned.length;
    const uniform = P > 0 ? alive / P : 0;

    const next = new Array<number>(size).fill(0);
    if (unpinned > 0 && P > 0) {
      // Redistribution factors: decayed prior, zeroed where the team can SEE
      // the cell is empty (negative evidence), floored by epsilon elsewhere.
      const factors = new Array<number>(P);
      let norm = 0;
      for (let i = 0; i < P; i++) {
        const idx = passable[i];
        const col = idx % map.width;
        const row = (idx - col) / map.width;
        const prior = hasPrev
          ? (1 - BELIEF.decayLambda) * prevW[idx] + BELIEF.decayLambda * uniform
          : uniform;
        const f = vis.has(`${col},${row}`) ? 0 : prior + BELIEF.epsilon;
        factors[i] = f;
        norm += f;
      }
      if (norm > 0) {
        for (let i = 0; i < P; i++) {
          if (factors[i] > 0) next[passable[i]] = (unpinned * factors[i]) / norm;
        }
      } else {
        // Degenerate: every passable cell visible — spread uniformly anyway.
        for (let i = 0; i < P; i++) next[passable[i]] = unpinned / P;
      }
    }
    // Seen enemies pin a full unit of mass at their true cell.
    for (const idx of pinned) next[idx] += 1;

    out[team] = next;
  }
  return out;
}

// Expected enemies inside the union of the named regions (deduped — regions
// overlap via folds). Returns 0 for an uninitialized store.
export function beliefInRegions(
  weights: number[],
  regions: readonly string[],
  map: MapDefinition,
): number {
  if (weights.length === 0) return 0;
  let sum = 0;
  const counted = new Set<number>();
  for (const name of regions) {
    const cells = map.regions[name];
    if (!cells) continue;
    for (const h of cells) {
      const idx = h.row * map.width + h.col;
      if (counted.has(idx)) continue;
      counted.add(idx);
      sum += weights[idx] ?? 0;
    }
  }
  return sum;
}
