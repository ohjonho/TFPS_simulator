// Draws planned movement paths: per-unit colored polyline through hex centers,
// numbered waypoint circles with a small facing arrow, and a faded breadcrumb
// effect on already-traversed hexes during resolution.

import type { GameState, Path } from '../game/types.ts';
import { axialToPixel } from '../game/hex.ts';
import { neighborInDirection } from '../game/path.ts';
import { HEX, PATH_COLORS, PATH_STYLE } from '../game/config.ts';

export function drawPaths(ctx: CanvasRenderingContext2D, state: GameState): void {
  // Render in a stable order so the colors stack consistently.
  const unitIds = state.units.map((u) => u.id);
  for (const id of unitIds) {
    const path = state.paths[id];
    if (!path || path.hexes.length <= 1) continue;
    const color = PATH_COLORS[id] ?? '#ffffff';
    drawSinglePath(ctx, path, state, id, color);
  }
}

function drawSinglePath(
  ctx: CanvasRenderingContext2D,
  path: Path,
  state: GameState,
  unitId: string,
  color: string,
): void {
  const cursor = state.cursors[unitId];
  // In resolution, fade the segment already traversed.
  const traversedThrough =
    state.phase === 'resolution' && cursor ? Math.floor(cursor.progress) : -1;

  ctx.lineWidth = PATH_STYLE.lineWidth;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 1; i < path.hexes.length; i++) {
    const from = axialToPixel(path.hexes[i - 1]);
    const to = axialToPixel(path.hexes[i]);
    ctx.save();
    ctx.globalAlpha = i <= traversedThrough ? PATH_STYLE.trailedOpacity : 1;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  }

  // Waypoint markers — drawn last so they sit on top of the lines.
  for (const k of Object.keys(path.waypoints)) {
    const idx = Number(k);
    if (idx <= 0 || idx >= path.hexes.length) continue;
    const wp = path.waypoints[idx];
    const center = axialToPixel(path.hexes[idx]);
    const faded = idx <= traversedThrough;
    drawWaypoint(ctx, center.x, center.y, color, idx, wp.facing, wp.holdTicks, faded);
  }
}

function drawWaypoint(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: string,
  index: number,
  facing: number,
  holdTicks: number,
  faded: boolean,
): void {
  const radius = HEX.size * PATH_STYLE.waypointRadiusFactor;

  ctx.save();
  ctx.globalAlpha = faded ? PATH_STYLE.trailedOpacity : 1;

  // Filled circle.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  // Index label (or hold ticks if > 0).
  ctx.fillStyle = '#0e1116';
  ctx.font = `bold ${Math.round(radius * 1.1)}px ui-monospace, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = holdTicks > 0 ? String(holdTicks) : String(index);
  ctx.fillText(label, cx, cy + 1);

  // Facing arrow — short stick from the waypoint center in the facing direction.
  const tipHex = neighborInDirection({ q: 0, r: 0 }, facing as 0 | 1 | 2 | 3 | 4 | 5);
  const tipPx = axialToPixel(tipHex);
  const originPx = axialToPixel({ q: 0, r: 0 });
  const dx = tipPx.x - originPx.x;
  const dy = tipPx.y - originPx.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const startR = radius + 2;
  const endR = radius + HEX.size * PATH_STYLE.facingArrowLengthFactor;

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx + ux * startR, cy + uy * startR);
  ctx.lineTo(cx + ux * endR, cy + uy * endR);
  ctx.stroke();

  // Arrowhead.
  const headSize = 4;
  const perpX = -uy;
  const perpY = ux;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx + ux * endR, cy + uy * endR);
  ctx.lineTo(cx + ux * (endR - headSize) + perpX * headSize * 0.6, cy + uy * (endR - headSize) + perpY * headSize * 0.6);
  ctx.lineTo(cx + ux * (endR - headSize) - perpX * headSize * 0.6, cy + uy * (endR - headSize) - perpY * headSize * 0.6);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}
