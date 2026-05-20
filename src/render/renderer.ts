// Renders one full frame: background → hex grid → planned paths → units.
// Called on planning-phase mutations (path draw, waypoint set) and after each
// resolution tick.

import type { GameState } from '../game/types.ts';
import { drawHexGrid } from './drawHexGrid.ts';
import { drawPaths } from './drawPaths.ts';
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
  drawPaths(ctx, state);
  drawUnits(ctx, state.units, hover.unitId);
}
