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

import type { CellType, HexCoord } from './types';

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
