// Parses a map source (string rows) into a GameMap with axial spawn lists.
// Source format uses the symbols defined in spec §4.2. Whitespace is ignored
// so the source can be visually aligned with spaces.

import type { GameMap, Terrain } from './types.ts';
import { offsetToAxial } from './hex.ts';
import { GRID } from './config.ts';

const SYMBOL_TO_TERRAIN: Record<string, Terrain> = {
  '.': 'open',
  '#': 'fullWall',
  '=': 'halfWall',
  'D': 'defenderSpawn',
  'A': 'attackerSpawn',
};

export function parseMap(rows: readonly string[]): GameMap {
  if (rows.length !== GRID.rows) {
    throw new Error(
      `Map source has ${rows.length} rows but config expects ${GRID.rows}`,
    );
  }

  const cells: Terrain[][] = [];
  const defenderSpawns = [];
  const attackerSpawns = [];

  for (let r = 0; r < rows.length; r++) {
    const stripped = rows[r].replace(/\s+/g, '');
    if (stripped.length !== GRID.cols) {
      throw new Error(
        `Row ${r} has ${stripped.length} cells (after stripping whitespace); ` +
          `expected ${GRID.cols}`,
      );
    }
    const rowCells: Terrain[] = [];
    for (let c = 0; c < stripped.length; c++) {
      const symbol = stripped[c];
      const terrain = SYMBOL_TO_TERRAIN[symbol];
      if (!terrain) {
        throw new Error(`Unknown map symbol "${symbol}" at row ${r}, col ${c}`);
      }
      rowCells.push(terrain);
      if (terrain === 'defenderSpawn') {
        defenderSpawns.push(offsetToAxial(c, r));
      } else if (terrain === 'attackerSpawn') {
        attackerSpawns.push(offsetToAxial(c, r));
      }
    }
    cells.push(rowCells);
  }

  return {
    cols: GRID.cols,
    rows: GRID.rows,
    cells,
    defenderSpawns,
    attackerSpawns,
  };
}
