// Renders one full frame:
//   background → hex grid → routes → fog (resolution) → units (enemy-visibility
//   filtered) → debug vision overlay (when V toggle on).

import type { GameState, Team } from '../game/types.ts';
import { drawHexGrid } from './drawHexGrid.ts';
import { drawRoutes } from './drawRoutes.ts';
import { drawUnits } from './drawUnits.ts';
import { drawFog } from './drawFog.ts';
import { drawEngagements } from './drawEngagements.ts';
import { drawDebugVision } from './drawDebugVision.ts';
import { hexKey } from '../game/vision.ts';
import { COLORS } from '../game/config.ts';

export type RenderHover = {
  unitId: string | null;
};

export type Selection = {
  unitId: string | null;
};

export type DebugOverlay = {
  on: boolean;
};

export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  hover: RenderHover,
  selection: Selection,
  debug: DebugOverlay,
  cssWidth: number,
  cssHeight: number,
  showEnemiesPlanning = true,
): void {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  drawHexGrid(ctx, state.map);
  drawRoutes(ctx, state);

  // Fog is on during resolution; in planning, fog respects the dev toggle so
  // builders can see enemy positions. Production defaults this to off in Pass 9.
  const fogActive = state.phase === 'resolution' || !showEnemiesPlanning;
  if (fogActive) drawFog(ctx, state);
  if (state.phase === 'resolution') drawEngagements(ctx, state);

  const hiddenEnemies = fogActive
    ? hiddenEnemyIdsFor(state, state.playerTeam)
    : new Set<string>();
  drawUnits(ctx, state.units, hover.unitId, selection.unitId, hiddenEnemies);

  if (debug.on) drawDebugVision(ctx, state);
}

// Alive enemies whose current hex is NOT in the player team's visibility set.
function hiddenEnemyIdsFor(state: GameState, playerTeam: Team): Set<string> {
  const hidden = new Set<string>();
  const visible = state.visibility[playerTeam];
  for (const u of state.units) {
    if (u.team === playerTeam || u.state !== 'alive') continue;
    if (!visible.has(hexKey(u.pos))) hidden.add(u.id);
  }
  return hidden;
}
