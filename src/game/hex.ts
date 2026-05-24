// Hex coordinate math. Pointy-top hexes, odd-row offset — matching the
// hex_maps_foundry_atoll.html prototype (row%2===1 shifts right by ½ column).
// Algorithms adapted from https://www.redblobgames.com/grids/hexagons/

import type { Axial, HexCoord } from './types.ts';
import { HEX } from './config.ts';

const SQRT3 = Math.sqrt(3);

// Pixel position of a hex CENTER for the given offset (col,row).
// Mirrors the prototype's hctr(): x = MX + col*W + (odd row ? W/2 : 0).
export function offsetToPixel(col: number, row: number): { x: number; y: number } {
  const x = HEX.mx + col * HEX.w + (row % 2 === 1 ? HEX.w / 2 : 0);
  const y = HEX.my + row * HEX.vs;
  return { x, y };
}

export function hexToPixel(hex: HexCoord): { x: number; y: number } {
  return offsetToPixel(hex.col, hex.row);
}

// Inverse of offsetToPixel — used for hover. Converts to fractional axial,
// rounds via cube rounding, then back to offset for an exact cell hit.
export function pixelToOffset(x: number, y: number): HexCoord {
  const px = x - HEX.mx;
  const py = y - HEX.my;
  const qf = (px * (SQRT3 / 3) - py / 3) / HEX.size;
  const rf = (py * (2 / 3)) / HEX.size;
  const axial = cubeRoundToAxial(qf, rf);
  return axialToOffset(axial);
}

// 6 corner offsets relative to a hex center, in drawing order.
// Pointy-top: corners at angle = π/3*i − π/6 (matches prototype drawHex).
export function hexCorners(cx: number, cy: number): Array<{ x: number; y: number }> {
  const corners: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    corners.push({ x: cx + HEX.size * Math.cos(a), y: cy + HEX.size * Math.sin(a) });
  }
  return corners;
}

// Total pixel extents of a cols × rows pointy-top odd-row grid.
// Matches the prototype canvas sizing: width accounts for the ½-col shift on
// odd rows; height spans the last row's bottom corner.
export function gridPixelSize(cols: number, rows: number): { width: number; height: number } {
  const width = HEX.mx * 2 + (cols - 1) * HEX.w + HEX.w;
  const height = HEX.my * 2 + (rows - 1) * HEX.vs + HEX.size * 2;
  return { width, height };
}

// --- Offset <-> axial + distance (odd-row "odd-r" convention) --------------

export function offsetToAxial(col: number, row: number): Axial {
  const q = col - (row - (row & 1)) / 2;
  const r = row;
  return { q, r };
}

export function axialToOffset(hex: Axial): HexCoord {
  const col = hex.q + (hex.r - (hex.r & 1)) / 2;
  const row = hex.r;
  return { col, row };
}

// Ordered hexes along the line from `from` to `to` (inclusive of both),
// de-duplicated. Supercover double-sampling so the line catches hexes it merely
// grazes at boundaries. Shared by vision occlusion and combat cover checks.
export function hexLine(from: HexCoord, to: HexCoord): HexCoord[] {
  if (from.col === to.col && from.row === to.row) return [from];
  const a = offsetToAxial(from.col, from.row);
  const b = offsetToAxial(to.col, to.row);
  const n = hexDistance(from, to);
  const steps = 2 * n;
  const out: HexCoord[] = [];
  let lastCol = Number.NaN;
  let lastRow = Number.NaN;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const hex = cubeRoundToAxial(a.q + (b.q - a.q) * t, a.r + (b.r - a.r) * t);
    const h = axialToOffset(hex);
    if (h.col === lastCol && h.row === lastRow) continue;
    lastCol = h.col;
    lastRow = h.row;
    out.push(h);
  }
  return out;
}

// Hex distance between two offset coords (via cube coords).
export function hexDistance(a: HexCoord, b: HexCoord): number {
  const aa = offsetToAxial(a.col, a.row);
  const ba = offsetToAxial(b.col, b.row);
  const dq = aa.q - ba.q;
  const dr = aa.r - ba.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
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
