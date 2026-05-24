// Draws every hex cell of the map: per-CellType fill + thin stroke. With 8
// distinctly-colored cell types there's no separate spawn tint or stripe layer.

import type { CellType, MapDefinition } from '../game/types.ts';
import { offsetToPixel, hexCorners } from '../game/hex.ts';
import { CELL_COLORS } from '../game/config.ts';

export function drawHexGrid(ctx: CanvasRenderingContext2D, map: MapDefinition): void {
  for (let row = 0; row < map.height; row++) {
    for (let col = 0; col < map.width; col++) {
      const type = map.grid[row][col];
      const { x, y } = offsetToPixel(col, row);
      drawHexCell(ctx, x, y, type);
    }
  }
}

function drawHexCell(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  type: CellType,
): void {
  const corners = hexCorners(cx, cy);
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();

  const { fill, stroke } = CELL_COLORS[type];
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}
