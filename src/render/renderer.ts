// Renders one full frame to the canvas: background, hex grid, units.
// Pass 1 has no animation; this is called on initial mount and whenever
// hover state changes.

import type { GameState } from '../game/types.ts';
import { drawHexGrid } from './drawHexGrid.ts';
import { drawUnits } from './drawUnits.ts';
import { COLORS } from '../game/config.ts';

export type RenderHover = {
  unitId: string | null;
};

export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  hover: RenderHover,
  cssWidth: number,
  cssHeight: number,
): void {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  drawHexGrid(ctx, state.map);
  drawUnits(ctx, state.units, hover.unitId);
}
