// Pure builders for the editor's two export outputs:
//   (a) rowsLiteral  — the raw 40-row string[] literal (copy-to-clipboard).
//   (b) mapFileBody   — a complete src/maps/<name>.ts modeled on canyon.ts.
// No DOM; the controls layer copies these strings to the clipboard.

import type { MapDefinition } from '../game/types.ts';

type MapCharacter = MapDefinition['character'];

/** A valid lowercase identifier for the exported const (e.g. "Mirage 2" → "mirage_2"). */
export function constIdent(name: string): string {
  const id = name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (id.length === 0) return 'newMap';
  return /^[0-9]/.test(id) ? `_${id}` : id;
}

/** The raw 40-row `string[]` literal, one quoted row per line with an index comment. */
export function rowsLiteral(rows: readonly string[]): string {
  const lines = rows.map((r, i) => `  '${r}', // ${i}`).join('\n');
  return `[\n${lines}\n]`;
}

/** A complete `src/maps/<name>.ts` file body, shaped like canyon.ts. */
export function mapFileBody(
  name: string,
  character: MapCharacter,
  rows: readonly string[],
): string {
  const ident = constIdent(name);
  const display = name.trim() || 'NewMap';
  return `/**
 * src/maps/${ident}.ts — ${display} (5v5), authored with the hex map editor
 * (src/editor) by tracing a reference drawing onto the 30×40 grid.
 *
 * Legend: # wall · . open · o cover · D def-spawn · X atk-spawn
 *   A/a = a_site / a_plant, B/b = b_site / b_plant (site-center # = pillar)
 *   1 a_main · 2 b_main · M mid
 *
 * To wire this into the game (four edits OUTSIDE this file):
 *   1. add '${display}' to MapDefinition['name'] in src/maps/types.ts
 *   2. select it in src/game/state.ts
 *   3. add a BY_MAP strategy entry in src/game/strategies.ts
 *   4. add the top-bar Map toggle in src/ui/topBar.ts
 */
import type { MapDefinition } from './types';
import { mapFromCharGrid } from './gridUtils';

const ROWS: string[] = ${rowsLiteral(rows)};

const parsed = mapFromCharGrid(ROWS);

export const ${ident}: MapDefinition = {
  name: '${display}',
  width: 30,
  height: 40,
  grid: parsed.grid,
  regions: parsed.regions,
  sites: parsed.sites,
  spawns: parsed.spawns,
  character: '${character}',
};
`;
}
