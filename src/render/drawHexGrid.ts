// Draws every hex cell of the map: terrain fill, spawn tint, half-wall stripes,
// and a thin border.

import type { GameMap, Terrain } from '../game/types.ts';
import { axialToPixel, hexCorners, offsetToAxial } from '../game/hex.ts';
import { COLORS, HEX } from '../game/config.ts';

const TERRAIN_FILL: Record<Terrain, string> = {
  open: COLORS.open,
  fullWall: COLORS.fullWall,
  halfWall: COLORS.halfWall,
  defenderSpawn: COLORS.open, // base layer, tint is overlaid
  attackerSpawn: COLORS.open,
};

export function drawHexGrid(ctx: CanvasRenderingContext2D, map: GameMap): void {
  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      const terrain = map.cells[row][col];
      const center = axialToPixel(offsetToAxial(col, row));
      drawHexCell(ctx, center.x, center.y, terrain);
    }
  }
}

function drawHexCell(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  terrain: Terrain,
): void {
  const corners = hexCorners(cx, cy);

  // Base fill.
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();
  ctx.fillStyle = TERRAIN_FILL[terrain];
  ctx.fill();

  // Spawn tint overlay.
  if (terrain === 'defenderSpawn' || terrain === 'attackerSpawn') {
    ctx.fillStyle =
      terrain === 'defenderSpawn'
        ? COLORS.defenderSpawnTint
        : COLORS.attackerSpawnTint;
    ctx.fill();
  }

  // Half-wall: add diagonal stripes inside the hex so it reads differently
  // from full walls at a glance.
  if (terrain === 'halfWall') {
    drawHalfWallStripes(ctx, corners, cx, cy);
  }

  // Border.
  ctx.lineWidth = 1;
  ctx.strokeStyle = COLORS.hexBorder;
  ctx.stroke();
}

function drawHalfWallStripes(
  ctx: CanvasRenderingContext2D,
  corners: Array<{ x: number; y: number }>,
  cx: number,
  cy: number,
): void {
  ctx.save();
  // Clip subsequent draws to the hex outline.
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();
  ctx.clip();

  ctx.strokeStyle = COLORS.halfWallStripe;
  ctx.lineWidth = 2;
  const size = HEX.size;
  const step = 6;
  // Stripes go from upper-left to lower-right, spanning a bounding box of 2*size.
  for (let offset = -size; offset <= size; offset += step) {
    ctx.beginPath();
    ctx.moveTo(cx - size + offset, cy - size);
    ctx.lineTo(cx + size + offset, cy + size);
    ctx.stroke();
  }
  ctx.restore();
}
