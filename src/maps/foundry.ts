/**
 * src/maps/foundry.ts — Foundry v2 (Pass 7.6 redesign per user sketch).
 *
 * Character: tight B squeeze, open A site, contested central mid with
 * staggered sightline-breaking walls. Compared to v1:
 *   - Defender and attacker spawns shrunk to compact central strips at the
 *     very top / very bottom (cols 11–18, 3 rows each).
 *   - Former def arms + atk lobbies → neutral 'open' corridors. Sites are
 *     the only "controlled" territory above the neutral mid.
 *   - Mid corridor (cols 10–19, rows 4–35) gets multiple staggered wall
 *     scatters to break the long defender→attacker sightline; each row
 *     still has navigable openings, but no straight columns.
 *   - More cover (half-walls) at site entries, along main lanes, and in mid
 *     so units have meaningful "hold strong defensive position" hexes.
 *
 * Fill order matters; later fills overwrite earlier ones.
 *
 * Regions (Appendix B — names unchanged from v1, hex membership shifts):
 *   def_spawn, b_site, b_plant, b_squeeze, a_site, a_plant, a_connector,
 *   mid, mid_pillar, b_main, b_lobby, a_main, a_lobby, atk_spawn
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
  const G = makeGrid(); // 40 × 30, all 'wall'

  // ── 1. Mid (large central vertical corridor) ─────────────────────────────
  fill(G, 10, 19, 4, 35, 'mid');

  // ── 2. Sites (upper corners) ─────────────────────────────────────────────
  fill(G,  1,  9, 5, 13, 'site'); // B site
  fill(G, 20, 28, 5, 13, 'site'); // A site

  // ── 3. Upper neutral corridor (former def arms — now contested) ──────────
  // One continuous strip at row 3 between def spawn and sites/mid, plus a row
  // 4 connector on each side so units can enter sites from the corridor.
  fill(G,  4, 25, 3, 3, 'open');
  fill(G,  4,  9, 4, 4, 'open');
  fill(G, 20, 25, 4, 4, 'open');

  // ── 4. Lower neutral corridor (former atk lobbies — now contested) ───────
  fill(G,  4, 25, 36, 36, 'open');
  fill(G,  6,  9, 35, 35, 'open');
  fill(G, 20, 23, 35, 35, 'open');

  // ── 5. B-main / A-main long lanes ────────────────────────────────────────
  fill(G,  1,  5, 14, 35, 'open');
  fill(G, 24, 28, 14, 35, 'open');

  // ── 6. Compact spawns (very top / very bottom) ───────────────────────────
  fill(G, 11, 18,  0,  2, 'def');
  fill(G, 11, 18, 37, 39, 'atk');

  // ── 7. Plant zones (subset of sites) ─────────────────────────────────────
  fill(G,  3,  7,  9, 12, 'plant');
  fill(G, 22, 26,  9, 12, 'plant');

  // ── 8. Surgical walls ────────────────────────────────────────────────────
  // 8a. Close site/mid borders (col 10 east of B; col 19 west of A) except
  //     the 3-hex squeeze opening at rows 9–11.
  for (const r of [5, 6, 7, 8, 12, 13]) {
    set(G, 10, r, 'wall');
    set(G, 19, r, 'wall');
  }
  // 8b. Sightline-breaking walls in mid (staggered — each row keeps openings).
  //     Upper mid scatter (between def spawn and the central pillar):
  for (const [c, r] of [[12, 7], [16, 7], [13, 9], [17, 9]]) set(G, c, r, 'wall');
  //     Central pillar (2×2 expanded with two side bumps):
  for (const [c, r] of [[14, 14], [15, 14], [14, 15], [15, 15], [12, 16], [17, 16]]) {
    set(G, c, r, 'wall');
  }
  //     Lower mid scatter (between pillar and atk spawn):
  for (const [c, r] of [[12, 22], [16, 22], [13, 25], [17, 25], [14, 28], [15, 28]]) {
    set(G, c, r, 'wall');
  }

  // ── 9. Cover (half-walls) at defensive holding angles ────────────────────
  const coverCells: [number, number][] = [
    // Mid around upper walls
    [11, 8], [18, 8], [13, 11], [16, 11],
    // Mid around central pillar
    [11, 16], [18, 16], [12, 19], [17, 19],
    // Mid around lower walls
    [11, 24], [18, 24], [14, 31], [15, 31],
    // B-site defensive holds
    [5, 11], [8, 10], [4, 8],
    // A-site defensive holds
    [22, 11], [25, 11], [24, 8],
    // B-main long lane
    [3, 18], [3, 25], [4, 30],
    // A-main long lane
    [26, 18], [26, 25], [25, 30],
    // Upper neutral corridors
    [7, 3], [22, 3],
    // Lower neutral corridors
    [7, 36], [22, 36],
  ];
  for (const [c, r] of coverCells) set(G, c, r, 'cover');

  return G;
}

// ---------------------------------------------------------------------------
// Regions  (Appendix B — same names; hex membership shifts with the new grid)
// ---------------------------------------------------------------------------

function buildRegions(G: CellType[][]): Record<string, HexCoord[]> {
  const bSqueeze = passable(G, rect(9, 11, 9, 11));
  const aConnector = passable(G, rect(17, 21, 9, 11));

  return {
    def_spawn: hexesOfType(G, 'def'),

    b_site: [
      ...hexesOfType(G, 'site',  1, 9, 5, 13),
      ...hexesOfType(G, 'plant', 3, 7, 9, 12),
    ],
    b_plant:   hexesOfType(G, 'plant', 3, 7, 9, 12),
    b_squeeze: bSqueeze,

    a_site: [
      ...hexesOfType(G, 'site',  20, 28, 5, 13),
      ...hexesOfType(G, 'plant', 22, 26, 9, 12),
    ],
    a_plant:     hexesOfType(G, 'plant', 22, 26, 9, 12),
    a_connector: aConnector,

    mid: hexesOfType(G, 'mid'),
    // Expanded central wall cluster (Pass 7.6).
    mid_pillar: [
      { col: 14, row: 14 }, { col: 15, row: 14 },
      { col: 14, row: 15 }, { col: 15, row: 15 },
      { col: 12, row: 16 }, { col: 17, row: 16 },
    ],

    // Lanes (long open corridors).
    b_main: hexesOfType(G, 'open', 1, 5, 14, 35),
    a_main: hexesOfType(G, 'open', 24, 28, 14, 35),
    // "Lobby" regions now refer to the neutral lower corridors near atk spawn.
    b_lobby: hexesOfType(G, 'open', 1, 10, 33, 36),
    a_lobby: hexesOfType(G, 'open', 19, 28, 33, 36),

    atk_spawn: hexesOfType(G, 'atk', 11, 18, 37, 39),
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const _grid = buildGrid();

export const foundry: MapDefinition = {
  name:   'Foundry',
  width:  30,
  height: 40,
  grid:   _grid,

  regions: buildRegions(_grid),

  sites: {
    A: {
      hexes: [
        ...hexesOfType(_grid, 'site',  20, 28, 5, 13),
        ...hexesOfType(_grid, 'plant', 22, 26, 9, 12),
      ],
      plantHexes: hexesOfType(_grid, 'plant', 22, 26, 9, 12),
      centerHex: { col: 24, row: 10 },
    },
    B: {
      hexes: [
        ...hexesOfType(_grid, 'site',  1, 9, 5, 13),
        ...hexesOfType(_grid, 'plant', 3, 7, 9, 12),
      ],
      plantHexes: hexesOfType(_grid, 'plant', 3, 7, 9, 12),
      centerHex: { col: 5, row: 10 },
    },
  },

  spawns: {
    // Compact central strips (Pass 7.6).
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

  character: 'tight_corridors_asymmetric',
};
