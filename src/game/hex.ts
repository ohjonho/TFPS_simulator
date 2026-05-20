// Hex coordinate math. Flat-top hexes, odd-q offset for map sources.
// Algorithms from https://www.redblobgames.com/grids/hexagons/

import type { Axial } from './types.ts';
import { HEX } from './config.ts';

const SQRT3 = Math.sqrt(3);

export type OffsetCoord = { col: number; row: number };

// odd-q: odd columns are pushed down by half a hex.
export function offsetToAxial(col: number, row: number): Axial {
  const q = col;
  const r = row - (col - (col & 1)) / 2;
  return { q, r };
}

export function axialToOffset(hex: Axial): OffsetCoord {
  const col = hex.q;
  const row = hex.r + (hex.q - (hex.q & 1)) / 2;
  return { col, row };
}

// Pixel position of the hex CENTER, given the top-left of the grid at (0,0).
// Includes a half-hex padding so the leftmost / topmost hexes aren't clipped.
export function axialToPixel(hex: Axial): { x: number; y: number } {
  const size = HEX.size;
  const { col, row } = axialToOffset(hex);
  const x = size * 1.5 * col + size;
  const y = size * SQRT3 * (row + 0.5 * (col & 1)) + size * SQRT3 * 0.5;
  return { x, y };
}

// Inverse of axialToPixel. Used for hover -> hex lookup.
export function pixelToAxial(x: number, y: number): Axial {
  const size = HEX.size;
  // Undo the half-hex padding before fractional conversion.
  const px = x - size;
  const py = y - size * SQRT3 * 0.5;
  const qf = (2 / 3) * px / size;
  const rf = (-1 / 3 * px + (SQRT3 / 3) * py) / size;
  return cubeRoundToAxial(qf, rf);
}

function cubeRoundToAxial(qf: number, rf: number): Axial {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) {
    q = -r - s;
  } else if (dr > ds) {
    r = -q - s;
  }
  return { q, r };
}

// Manhattan distance on a hex grid (cube coords).
export function hexDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

// 6 corner offsets relative to a hex center, in drawing order.
// Flat-top: corners at 0°, 60°, 120°, 180°, 240°, 300°.
export function hexCorners(cx: number, cy: number): Array<{ x: number; y: number }> {
  const size = HEX.size;
  const corners: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    corners.push({
      x: cx + size * Math.cos(angle),
      y: cy + size * Math.sin(angle),
    });
  }
  return corners;
}

// Total pixel extents of a `cols × rows` flat-top odd-q grid.
// Width: leftmost corner at x=0, rightmost corner at x = size*1.5*(cols-1) + 2*size.
// Height: topmost corner at y=0 (even col, row 0), bottommost corner at
//   y = size*sqrt(3)*(rows + 0.5) (odd col, last row, shifted down ½ hex).
export function gridPixelSize(cols: number, rows: number): { width: number; height: number } {
  const size = HEX.size;
  const width = size * 1.5 * (cols - 1) + size * 2;
  const height = size * SQRT3 * (rows + 0.5);
  return { width, height };
}
