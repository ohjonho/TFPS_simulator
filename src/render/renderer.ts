// Renders one full frame:
//   background → hex grid → region labels (toggle) → routes → fog (resolution)
//   → engagements (resolution) → units (enemy-visibility filtered) → card
//   effects (resolution) → debug vision overlay (when V toggle on).

import type { GameState, HexCoord, Team } from '../game/types.ts';
import { drawHexGrid } from './drawHexGrid.ts';
import { drawPreviewRoutes, drawRoutes } from './drawRoutes.ts';
import type { DragState } from './drawUnits.ts';
import { drawUnits } from './drawUnits.ts';
import { drawFog } from './drawFog.ts';
import { drawEngagements } from './drawEngagements.ts';
import { drawDebugVision } from './drawDebugVision.ts';
import { drawCardEffects } from './drawCardEffects.ts';
import { drawRegionLabels } from './drawRegionLabels.ts';
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
  previewRoutes: Record<string, HexCoord[]> | null = null,
  showRegionLabels = false,
  dragState: DragState = null,
): void {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  // Pass G — during the pre-match draft phase, leave the canvas as a clean
  // dark background. The draft panel overlay covers the canvas area, so any
  // grid/units drawn here would just bleed through the panel's translucent
  // background. Skipping the full pipeline also avoids running per-tick
  // helpers (visibility / routes) against the empty draft state.
  if (state.phase === 'draft') return;
  drawHexGrid(ctx, state.map);
  // Pass D — region labels drawn after grid (so background) but before
  // anything player-actionable so they don't fight routes/units for attention.
  if (showRegionLabels) drawRegionLabels(ctx, state.map);
  if (state.phase === 'resolution') {
    drawRoutes(ctx, state);
  } else if (previewRoutes) {
    // Pass 8 — dashed advisory routes for the player's currently-selected
    // strategy + card during planning. Updates whenever selection changes.
    drawPreviewRoutes(ctx, previewRoutes);
  }

  // Fog is on during resolution; in planning, fog respects the dev toggle so
  // builders can see enemy positions. Production defaults this to off in Pass 9.
  const fogActive = state.phase === 'resolution' || !showEnemiesPlanning;
  if (fogActive) drawFog(ctx, state);
  if (state.phase === 'resolution') drawEngagements(ctx, state);

  const hiddenEnemies = fogActive
    ? hiddenEnemyIdsFor(state, state.playerTeam)
    : new Set<string>();
  drawUnits(ctx, state.units, hover.unitId, selection.unitId, hiddenEnemies, dragState);

  // Pass D — card-effect visuals layer on top of units so the player sees
  // active marks / auras / anchors mid-round.
  drawCardEffects(ctx, state);

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
