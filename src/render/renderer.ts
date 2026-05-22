// Renders one full frame:
//   background → hex grid → planned paths → fog (resolution) →
//   units (with enemy visibility filter) → ghost markers (resolution) →
//   debug vision overlay (when V toggle is on).
// Called on planning-phase mutations (path draw, waypoint set) and after each
// resolution tick.

import type { GameState, Team } from '../game/types.ts';
import { drawHexGrid } from './drawHexGrid.ts';
import { drawPaths } from './drawPaths.ts';
import { drawUnits } from './drawUnits.ts';
import { drawFog } from './drawFog.ts';
import { drawDebugVision } from './drawDebugVision.ts';
import { axialKey } from '../game/vision.ts';
import { COLORS } from '../game/config.ts';

export type RenderHover = {
  unitId: string | null;
};

export type DebugOverlay = {
  on: boolean;
};

export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  hover: RenderHover,
  debug: DebugOverlay,
  cssWidth: number,
  cssHeight: number,
): void {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  drawHexGrid(ctx, state.map);
  drawPaths(ctx, state);

  const fogActive = state.phase === 'resolution';
  if (fogActive) drawFog(ctx, state);

  const hiddenEnemies = fogActive
    ? hiddenEnemyIdsFor(state, state.playerTeam)
    : new Set<string>();
  drawUnits(ctx, state.units, hover.unitId, state.playerTeam, hiddenEnemies);

  if (debug.on) drawDebugVision(ctx, state);
}

// Enemies on the opposite team whose current hex is NOT in the player team's
// visibility set. Fog hides these units; their last-seen positions appear as
// ghost markers drawn by drawFog.
function hiddenEnemyIdsFor(state: GameState, playerTeam: Team): Set<string> {
  const hidden = new Set<string>();
  const visible = state.visibility[playerTeam];
  for (const u of state.units) {
    if (u.team === playerTeam) continue;
    if (u.state !== 'alive') continue;
    if (!visible.has(axialKey(u.pos))) hidden.add(u.id);
  }
  return hidden;
}
