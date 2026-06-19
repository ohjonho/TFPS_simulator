// Draws each unit's pending A* route as a faint breadcrumb polyline through
// hex centers. A dev aid for Pass 2 (verifying pathfinding + arrival); the
// already-traversed portion dims as the unit advances. No waypoints in v0.
//
// Pass 8 — planning-phase preview routes also draw via this module but with a
// dashed style (see drawPreviewRoutes) so they read as "what will happen" not
// "what is happening." Both styles share the same geometry.

import type { GameState, HexCoord, Team } from '../game/types.ts';
import { hexToPixel } from '../game/hex.ts';
import { HEX, ROUTE_STYLE } from '../game/config.ts';

// `showEnemies` (the dev "Enemies" toggle) draws enemy routes too; otherwise only
// the player team's routes show — an enemy's planned path is future intent that
// fog should hide, so revealing it (as it did) gave the player free intel.
export function drawRoutes(ctx: CanvasRenderingContext2D, state: GameState, playerTeam: Team, showEnemies: boolean): void {
  for (const unit of state.units) {
    if (unit.state !== 'alive') continue;
    if (unit.team !== playerTeam && !showEnemies) continue;
    const move = state.moves[unit.id];
    if (!move || move.path.length <= 1) continue;

    const traversedThrough = Math.floor(move.progress);

    ctx.lineWidth = ROUTE_STYLE.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 1; i < move.path.length; i++) {
      const from = hexToPixel(move.path[i - 1]);
      const to = hexToPixel(move.path[i]);
      ctx.strokeStyle = i <= traversedThrough ? ROUTE_STYLE.traversed : ROUTE_STYLE.upcoming;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }

    // Destination node.
    const goal = hexToPixel(move.path[move.path.length - 1]);
    ctx.fillStyle = ROUTE_STYLE.upcoming;
    ctx.beginPath();
    ctx.arc(goal.x, goal.y, HEX.size * ROUTE_STYLE.nodeRadiusFactor, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Pass 8 — planning-phase preview routes. Dashed polyline + smaller node so the
// preview reads as advisory. Routes are a Record<unitId, HexCoord[]> computed by
// planningPreview.previewPlayerPlan (no progress/no per-unit movement state).
export function drawPreviewRoutes(
  ctx: CanvasRenderingContext2D,
  routes: Record<string, HexCoord[]>,
): void {
  ctx.save();
  ctx.lineWidth = ROUTE_STYLE.lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = ROUTE_STYLE.upcoming;
  for (const id of Object.keys(routes)) {
    const path = routes[id];
    if (!path || path.length <= 1) continue;
    ctx.beginPath();
    const start = hexToPixel(path[0]);
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i < path.length; i++) {
      const p = hexToPixel(path[i]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    // Goal node.
    const goal = hexToPixel(path[path.length - 1]);
    ctx.fillStyle = ROUTE_STYLE.upcoming;
    ctx.beginPath();
    ctx.arc(goal.x, goal.y, HEX.size * ROUTE_STYLE.nodeRadiusFactor, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
