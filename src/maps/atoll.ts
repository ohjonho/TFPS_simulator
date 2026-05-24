/**
 * src/maps/atoll.ts — Atoll v2 (Pass 7.6: same redesign principles as Foundry,
 * preserving Atoll's defining character).
 *
 * Character: wide B dock with long sniper sightline, tight A labyrinth.
 *   - Spawns shrunk to compact central strips like Foundry.
 *   - Former def arms + atk lobbies → neutral 'open'.
 *   - **B Main long lane preserved** (deliberately not broken by mid walls —
 *     the long sightline is Atoll's defining feature). Cover added along it.
 *   - **A Site labyrinth preserved** (internal wall pattern unchanged).
 *   - Smaller central mid pillar (the wide B dock + long B main already do the
 *     sightline-breaking work for Atoll; mid courtyard stays open-ish).
 *
 * Regions (Appendix B):
 *   def_spawn, b_site, b_plant, b_dock, a_site, a_plant, a_maze,
 *   mid, mid_courtyard, b_main, b_lobby, a_main, a_lobby, atk_spawn
 */

import type { CellType, HexCoord, MapDefinition } from './types';
import {
  fill,
  hexesOfType,
  makeGrid,
  passable,
  rect,
  set,
} from './gridUtils';

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

function buildGrid(): CellType[][] {
  const G = makeGrid();

  // ── 1. Mid (wide central courtyard) ─────────────────────────────────────
  fill(G, 10, 19, 4, 35, 'mid');

  // ── 2. Sites ─────────────────────────────────────────────────────────────
  fill(G,  1, 12, 5, 13, 'site'); // B site (wide dock)
  fill(G, 18, 28, 5, 13, 'site'); // A site (labyrinth)

  // ── 3. Upper neutral corridor ────────────────────────────────────────────
  fill(G,  3, 26, 3, 3, 'open');
  fill(G,  3, 12, 4, 4, 'open');
  fill(G, 18, 26, 4, 4, 'open');

  // ── 4. Lower neutral corridor ────────────────────────────────────────────
  fill(G,  3, 26, 36, 36, 'open');
  fill(G,  5, 12, 35, 35, 'open');
  fill(G, 18, 23, 35, 35, 'open');

  // ── 5. Long B-main sniper lane + A-main lane ─────────────────────────────
  // B Main is intentionally long (~16 rows) — Atoll's defining sniper sightline.
  fill(G,  1,  6, 14, 35, 'open');
  fill(G, 23, 28, 14, 35, 'open');

  // ── 6. Compact spawns ────────────────────────────────────────────────────
  fill(G, 11, 18,  0,  2, 'def');
  fill(G, 11, 18, 37, 39, 'atk');

  // ── 7. Plant zones ───────────────────────────────────────────────────────
  fill(G,  3,  7,  9, 12, 'plant');
  fill(G, 20, 24,  9, 12, 'plant');

  // ── 8. Surgical walls ────────────────────────────────────────────────────
  // 8a. Close site/mid borders except connector openings.
  //     B connector: 4-hex opening at rows 8–11 on col 13 (preserved from v1).
  for (const r of [5, 6, 7, 12, 13]) set(G, 13, r, 'wall');
  //     A connector: wider 6-hex opening at rows 7–12 on cols 17–18.
  for (const r of [5, 6]) { set(G, 17, r, 'wall'); set(G, 18, r, 'wall'); }
  set(G, 17, 13, 'wall'); set(G, 18, 13, 'wall');

  // 8b. A Site labyrinth — preserved internal walls (Atoll's signature).
  const labyrinthWalls: [number, number][] = [
    [21, 6], [22, 6],          // top inner room divider
    [19, 9], [20, 9],          // middle cross-wall
    [25, 8], [26, 8], [26, 9], // east alcove wall
    [22, 11], [23, 11],        // lower room divider
    [20, 12],                  // SW cubby block
  ];
  for (const [c, r] of labyrinthWalls) set(G, c, r, 'wall');

  // 8c. Mid sightline-breaking walls — DELIBERATELY MINIMAL. Atoll's long B
  //     main + wide mid courtyard already provide depth; just a single 2×2
  //     central pillar + two side bumps to disrupt straight def→atk shots.
  for (const [c, r] of [[14, 18], [15, 18], [14, 19], [15, 19], [12, 24], [17, 24]]) {
    set(G, c, r, 'wall');
  }

  // ── 9. Cover ─────────────────────────────────────────────────────────────
  const coverCells: [number, number][] = [
    // B site (wide dock needs scattered cover)
    [4, 9], [8, 9], [11, 9],
    [5, 12], [9, 12],
    [7, 13],
    // A site (labyrinth alcoves)
    [25, 13], [26, 12],
    // Mid courtyard around the pillar
    [12, 17], [17, 17], [13, 22], [16, 22], [14, 28], [15, 28],
    // B-main long sniper lane — cover staggered down its length
    [3, 18], [5, 22], [2, 25], [4, 30],
    // A-main lane
    [25, 18], [26, 22], [27, 26], [26, 30],
    // Upper / lower neutral corridors
    [7, 3], [22, 3],
    [7, 36], [22, 36],
  ];
  for (const [c, r] of coverCells) set(G, c, r, 'cover');

  return G;
}

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

function buildRegions(G: CellType[][]): Record<string, HexCoord[]> {
  const bDock = passable(G, rect(1, 12, 5, 8));
  const aMaze = passable(G, rect(18, 28, 5, 13));
  const midCourtyard = hexesOfType(G, 'mid', 10, 19, 7, 30);

  return {
    def_spawn: hexesOfType(G, 'def'),

    b_site: [
      ...hexesOfType(G, 'site',  1, 12, 5, 13),
      ...hexesOfType(G, 'plant', 3,  7,  9, 12),
    ],
    b_plant: hexesOfType(G, 'plant', 3, 7, 9, 12),
    b_dock:  bDock,

    a_site: [
      ...hexesOfType(G, 'site',  18, 28, 5, 13),
      ...hexesOfType(G, 'plant', 20, 24, 9, 12),
    ],
    a_plant: hexesOfType(G, 'plant', 20, 24, 9, 12),
    a_maze:  aMaze,

    mid:           hexesOfType(G, 'mid'),
    mid_courtyard: midCourtyard,

    b_main:  hexesOfType(G, 'open', 1, 6, 14, 35),
    a_main:  hexesOfType(G, 'open', 23, 28, 14, 35),
    b_lobby: hexesOfType(G, 'open', 1, 10, 33, 36),
    a_lobby: hexesOfType(G, 'open', 19, 28, 33, 36),

    atk_spawn: hexesOfType(G, 'atk', 11, 18, 37, 39),
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const _grid = buildGrid();

export const atoll: MapDefinition = {
  name:   'Atoll',
  width:  30,
  height: 40,
  grid:   _grid,

  regions: buildRegions(_grid),

  sites: {
    A: {
      hexes: [
        ...hexesOfType(_grid, 'site',  18, 28, 5, 13),
        ...hexesOfType(_grid, 'plant', 20, 24, 9, 12),
      ],
      plantHexes: hexesOfType(_grid, 'plant', 20, 24, 9, 12),
      centerHex: { col: 23, row: 10 },
    },
    B: {
      hexes: [
        ...hexesOfType(_grid, 'site',  1, 12, 5, 13),
        ...hexesOfType(_grid, 'plant', 3,  7,  9, 12),
      ],
      plantHexes: hexesOfType(_grid, 'plant', 3, 7, 9, 12),
      centerHex: { col: 7, row: 10 },
    },
  },

  spawns: {
    defenders: [
      { col: 12, row: 1 },
      { col: 14, row: 1 },
      { col: 17, row: 1 },
    ],
    attackers: [
      { col: 12, row: 38 },
      { col: 14, row: 38 },
      { col: 17, row: 38 },
    ],
  },

  character: 'open_sightlines',
};
