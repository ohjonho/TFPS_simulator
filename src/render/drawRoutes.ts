// Draws each unit's pending A* route as a faint breadcrumb polyline through
// hex centers. A dev aid for Pass 2 (verifying pathfinding + arrival); the
// already-traversed portion dims as the unit advances. No waypoints in v0.

import type { GameState } from '../game/types.ts';
import { hexToPixel } from '../game/hex.ts';
import { HEX, ROUTE_STYLE } from '../game/config.ts';

export function drawRoutes(ctx: CanvasRenderingContext2D, state: GameState): void {
  for (const unit of state.units) {
    if (unit.state !== 'alive') continue;
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
