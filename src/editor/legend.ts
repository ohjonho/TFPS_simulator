// Paint palette + cell colors, derived from the parser's CHAR_LEGEND so the
// editor and mapFromCharGrid can never drift. Each palette entry is one legend
// character; the editor's whole model is a grid of these characters.

import type { CellType } from '../game/types.ts';
import { CELL_COLORS } from '../game/config.ts';
import { CHAR_LEGEND } from '../maps/gridUtils.ts';

export type PaletteEntry = {
  char: string;
  type: CellType;
  region?: string;
  label: string;
  fill: string;
  stroke: string;
};

// Human labels per legend char (the legend itself only carries type + region).
// Must cover every char in CHAR_LEGEND — a missing entry falls back to the bare
// CellType ('site'/'open'/'mid'), which is what made the sub-zone brushes
// indistinguishable. Keep in sync when the vocabulary changes.
const LABELS: Record<string, string> = {
  '#': 'wall',
  '.': 'open',
  o: 'cover',
  D: 'def spawn',
  X: 'atk spawn',

  // A-side site cluster.
  A: 'A site',
  a: 'A plant',
  e: 'A entry',
  n: 'A anchor',
  f: 'A off-angle',
  g: 'A off-angle 2',

  // B-side site cluster.
  B: 'B site',
  b: 'B plant',
  E: 'B entry',
  N: 'B anchor',
  F: 'B off-angle',
  G: 'B off-angle 2',

  // Main lanes (near = defender end, far = attacker end).
  '1': 'A main (whole)',
  '3': 'A main · near',
  '4': 'A main · far',
  '2': 'B main (whole)',
  '5': 'B main · near',
  '6': 'B main · far',

  // Mid + sub-zones.
  M: 'mid (whole)',
  l: 'mid · left',
  r: 'mid · right',
  k: 'mid choke',

  // Standalone chokes + rotational connectors.
  c: 'A choke',
  C: 'B choke',
  '7': 'A connector',
  '8': 'B connector',
};

// Display order for the palette: terrain → spawns → A cluster → B cluster →
// lanes → mid → chokes/connectors. Any legend char missing here is appended so
// a new char in CHAR_LEGEND still shows.
const ORDER = [
  '#', '.', 'o', 'D', 'X',
  'A', 'a', 'e', 'n', 'f', 'g',
  'B', 'b', 'E', 'N', 'F', 'G',
  '1', '3', '4', '2', '5', '6',
  'M', 'l', 'r', 'k',
  'c', 'C', '7', '8',
];

export const ERASER_CHAR = '.';

/** Ordered palette built from CHAR_LEGEND + CELL_COLORS. */
export const PALETTE: readonly PaletteEntry[] = buildPalette();

function buildPalette(): PaletteEntry[] {
  const chars = Object.keys(CHAR_LEGEND);
  const ordered = [
    ...ORDER.filter((c) => chars.includes(c)),
    ...chars.filter((c) => !ORDER.includes(c)),
  ];
  return ordered.map((char) => {
    const { type, region } = CHAR_LEGEND[char];
    const { fill, stroke } = CELL_COLORS[type];
    return { char, type, region, label: LABELS[char] ?? type, fill, stroke };
  });
}

const COLOR_BY_CHAR: Record<string, { fill: string; stroke: string }> = (() => {
  const m: Record<string, { fill: string; stroke: string }> = {};
  for (const e of PALETTE) m[e.char] = { fill: e.fill, stroke: e.stroke };
  return m;
})();

/** Fill + stroke for a legend char (falls back to wall colors if unknown). */
export function charColor(char: string): { fill: string; stroke: string } {
  return COLOR_BY_CHAR[char] ?? CELL_COLORS.wall;
}

/** True when `char` is a known legend character. */
export function isLegendChar(char: string): boolean {
  return char in CHAR_LEGEND;
}
