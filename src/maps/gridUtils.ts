/**
 * src/maps/gridUtils.ts
 *
 * Pure grid-building helpers shared by both map files.
 * No DOM / canvas imports — safe to import from src/game/.
 *
 * The fill-order convention used in every map:
 *   1. atk   (painted first — lowest priority)
 *   2. open  (corridors)
 *   3. mid
 *   4. site
 *   5. def   (painted last among terrain — overwrites tops of sites)
 *   6. plant (overwrites subset of site)
 *   7. surgical wall overrides
 *   8. cover objects
 *
 * Later fills overwrite earlier ones, which drives the correct boundary
 * behaviour at zone edges (e.g. defender arm cells overwrite the upper
 * rows of the adjacent site rectangle).
 */

import type { CellType, HexCoord, SiteData } from './types';

export const COLS = 30 as const;
export const ROWS = 40 as const;

// ---------------------------------------------------------------------------
// Grid construction
// ---------------------------------------------------------------------------

/** Return a ROWS × COLS grid initialised to 'wall'. */
export function makeGrid(): CellType[][] {
  return Array.from({ length: ROWS }, () =>
    Array<CellType>(COLS).fill('wall'),
  );
}

/**
 * Fill the rectangle [c1..c2] × [r1..r2] with cell type `t`.
 * Clamps silently to grid bounds.
 */
export function fill(
  G: CellType[][],
  c1: number, c2: number,
  r1: number, r2: number,
  t: CellType,
): void {
  for (let r = Math.max(0, r1); r <= Math.min(ROWS - 1, r2); r++) {
    for (let c = Math.max(0, c1); c <= Math.min(COLS - 1, c2); c++) {
      G[r][c] = t;
    }
  }
}

/**
 * Overwrite a single cell.  No-ops when (c, r) is out of bounds.
 * Used for surgical wall placements and cover objects.
 */
export function set(G: CellType[][], c: number, r: number, t: CellType): void {
  if (c >= 0 && c < COLS && r >= 0 && r < ROWS) G[r][c] = t;
}

// ---------------------------------------------------------------------------
// Region extraction
// ---------------------------------------------------------------------------

/**
 * Return all hexes whose cell type equals `type` within the optional
 * bounding rectangle (defaults to the full grid).
 */
export function hexesOfType(
  G: CellType[][],
  type: CellType,
  c1 = 0,
  c2 = COLS - 1,
  r1 = 0,
  r2 = ROWS - 1,
): HexCoord[] {
  const result: HexCoord[] = [];
  for (let row = Math.max(0, r1); row <= Math.min(ROWS - 1, r2); row++) {
    for (let col = Math.max(0, c1); col <= Math.min(COLS - 1, c2); col++) {
      if (G[row][col] === type) result.push({ col, row });
    }
  }
  return result;
}

/**
 * Filter a coordinate list to only those hexes that units can occupy
 * (i.e. cell type is neither 'wall' nor 'cover').
 * Used when building structural sub-regions like squeezes and connectors,
 * where the raw bounding rectangle may include wall or cover cells.
 */
export function passable(G: CellType[][], coords: HexCoord[]): HexCoord[] {
  return coords.filter(({ col, row }) => {
    const t = G[row][col];
    return t !== 'wall' && t !== 'cover';
  });
}

/**
 * Enumerate every coordinate in the rectangle [c1..c2] × [r1..r2].
 * Useful as input to `passable()` for structural region definitions.
 */
export function rect(
  c1: number, c2: number,
  r1: number, r2: number,
): HexCoord[] {
  const result: HexCoord[] = [];
  for (let row = r1; row <= r2; row++) {
    for (let col = c1; col <= c2; col++) {
      result.push({ col, row });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Char-grid authoring pipeline
// ---------------------------------------------------------------------------

/**
 * Legend for `mapFromCharGrid`. One character per cell encodes geometry AND
 * the named-region contract strategies depend on. `a`/`b` plant cells are also
 * folded into the `a_site`/`b_site` regions. Site-center pillars are just `#`.
 *
 * Exported so the map editor (src/editor) builds its paint palette and cell
 * colors from the same legend the parser consumes — one source of truth.
 */
// Richer vocabulary (locked contract, v1). Coarse parents (a_site/b_site,
// a_main/b_main, mid) stay meaningful via the fold below — each fine sub-zone's
// cells are merged into its parent so strategies referencing the parent see the
// full footprint, while the sub-zones are available as distinct targets +
// watch angles. Numbered variants (entry 1/2 = e/h, anchor 1/2 = n/j, off-angle
// 1/2 = f/g) fold into their unnumbered parent so a generic ref sees both angles
// while each numbered cell stays a distinct round-to-round target. Chokes/
// connectors + lurk pathways (y/Y) are standalone (thin angle/rotate refs, not
// hold zones). Sub-zone CellType is cosmetic (all passable) — picked so the
// editor groups them sensibly: anchors/off-angles read as 'site', entries +
// lane segments + chokes + connectors as 'open', mid sub-zones as 'mid'.
export const CHAR_LEGEND: Record<string, { type: CellType; region?: string }> = {
  '#': { type: 'wall' },
  '.': { type: 'open' },
  o: { type: 'cover' },
  D: { type: 'def', region: 'def_spawn' },
  X: { type: 'atk', region: 'atk_spawn' },

  // A-side cluster.
  A: { type: 'site', region: 'a_site' },
  a: { type: 'plant', region: 'a_plant' },
  e: { type: 'open', region: 'a_entry' },     // entry 1 (doorway attackers push through)
  h: { type: 'open', region: 'a_entry2' },    // entry 2 (alternate push angle)
  n: { type: 'site', region: 'a_anchor' },    // anchor 1 (defender hold pocket, deep/safe)
  j: { type: 'site', region: 'a_anchor2' },   // anchor 2 (alternate hold angle)
  f: { type: 'site', region: 'a_off' },        // off-angle 1
  g: { type: 'site', region: 'a_off2' },       // off-angle 2

  // B-side cluster.
  B: { type: 'site', region: 'b_site' },
  b: { type: 'plant', region: 'b_plant' },
  E: { type: 'open', region: 'b_entry' },
  H: { type: 'open', region: 'b_entry2' },
  N: { type: 'site', region: 'b_anchor' },
  J: { type: 'site', region: 'b_anchor2' },
  F: { type: 'site', region: 'b_off' },
  G: { type: 'site', region: 'b_off2' },

  // Lanes (mains) split near (defender end) / far (attacker end).
  '1': { type: 'open', region: 'a_main' },
  '3': { type: 'open', region: 'a_main_near' },
  '4': { type: 'open', region: 'a_main_far' },
  '2': { type: 'open', region: 'b_main' },
  '5': { type: 'open', region: 'b_main_near' },
  '6': { type: 'open', region: 'b_main_far' },

  // Mid + sub-zones.
  M: { type: 'mid', region: 'mid' },
  l: { type: 'mid', region: 'mid_left' },
  r: { type: 'mid', region: 'mid_right' },
  k: { type: 'mid', region: 'mid_choke' },
  p: { type: 'mid', region: 'mid_off' },       // mid off-angle (pick from mid)
  v: { type: 'mid', region: 'mid_anchor' },    // mid anchor hold (deep mid control)

  // Standalone chokes + rotational connectors (watch angles / rotate targets).
  c: { type: 'open', region: 'a_choke' },
  C: { type: 'open', region: 'b_choke' },
  '7': { type: 'open', region: 'a_connector' },
  '8': { type: 'open', region: 'b_connector' },

  // Lurk pathways — off-path lanes for a late flank/hold (standalone route refs,
  // like chokes: not folded into a site/mid parent).
  y: { type: 'open', region: 'a_lurk' },
  Y: { type: 'open', region: 'b_lurk' },
};

/** Passable-hex nearest the centroid of `pool` (avoids site pillars). */
function centerOf(pool: readonly HexCoord[]): HexCoord {
  if (pool.length === 0) return { col: 15, row: 20 };
  const ac = pool.reduce((s, h) => s + h.col, 0) / pool.length;
  const ar = pool.reduce((s, h) => s + h.row, 0) / pool.length;
  let best = pool[0];
  let bestD = Infinity;
  for (const h of pool) {
    const d = (h.col - ac) ** 2 + (h.row - ar) ** 2;
    if (d < bestD) { bestD = d; best = h; }
  }
  return best;
}

/**
 * Build a map's grid + regions + sites + spawns from a ROWS×COLS character
 * grid (see CHAR_LEGEND). Throws on a wrong row count, wrong row length, or
 * an unknown char — so transcription mistakes name the exact bad cell instead
 * of silently corrupting the map. This is the authoring path for new/organic
 * maps (and the eventual paint editor's export target).
 */
export function mapFromCharGrid(rows: readonly string[]): {
  grid: CellType[][];
  regions: Record<string, HexCoord[]>;
  sites: { A: SiteData; B: SiteData };
  spawns: { defenders: HexCoord[]; attackers: HexCoord[] };
} {
  if (rows.length !== ROWS) {
    throw new Error(`mapFromCharGrid: expected ${ROWS} rows, got ${rows.length}`);
  }
  const grid = makeGrid();
  const regions: Record<string, HexCoord[]> = {};
  for (let r = 0; r < ROWS; r++) {
    const line = rows[r];
    if (line.length !== COLS) {
      throw new Error(`mapFromCharGrid: row ${r} is ${line.length} chars, expected ${COLS}`);
    }
    for (let c = 0; c < COLS; c++) {
      const ch = line[c];
      const entry = CHAR_LEGEND[ch];
      if (!entry) throw new Error(`mapFromCharGrid: unknown char '${ch}' at row ${r}, col ${c}`);
      grid[r][c] = entry.type;
      if (entry.region) (regions[entry.region] ??= []).push({ col: c, row: r });
    }
  }

  // Fold fine sub-zones into their coarse parent so strategies referencing the
  // parent (a_site / a_main / mid) still see the full footprint, while the
  // sub-zones remain available as distinct targets + watch angles. Chokes and
  // connectors are intentionally NOT folded — they're thin standalone refs.
  const fold = (parent: string, children: readonly string[]): void => {
    const merged = [...(regions[parent] ?? [])];
    for (const c of children) for (const h of regions[c] ?? []) merged.push(h);
    if (merged.length > 0) regions[parent] = merged;
  };
  // Numbered variants fold into their unnumbered parent FIRST so the parent
  // (a_entry / a_anchor) carries both angles; the site fold then picks up the
  // merged parent transitively (no double-count). Each numbered child region
  // stays intact for round-to-round angle targeting.
  fold('a_entry', ['a_entry2']);
  fold('b_entry', ['b_entry2']);
  fold('a_anchor', ['a_anchor2']);
  fold('b_anchor', ['b_anchor2']);
  fold('a_site', ['a_plant', 'a_entry', 'a_anchor', 'a_off', 'a_off2']);
  fold('b_site', ['b_plant', 'b_entry', 'b_anchor', 'b_off', 'b_off2']);
  fold('a_main', ['a_main_near', 'a_main_far']);
  fold('b_main', ['b_main_near', 'b_main_far']);
  fold('mid', ['mid_left', 'mid_right', 'mid_choke', 'mid_off', 'mid_anchor']);

  const aPlant = regions['a_plant'] ?? [];
  const bPlant = regions['b_plant'] ?? [];

  return {
    grid,
    regions,
    sites: {
      A: { hexes: regions['a_site'], plantHexes: aPlant, centerHex: centerOf(aPlant.length ? aPlant : regions['a_site']) },
      B: { hexes: regions['b_site'], plantHexes: bPlant, centerHex: centerOf(bPlant.length ? bPlant : regions['b_site']) },
    },
    spawns: {
      defenders: regions['def_spawn'] ?? [],
      attackers: regions['atk_spawn'] ?? [],
    },
  };
}
