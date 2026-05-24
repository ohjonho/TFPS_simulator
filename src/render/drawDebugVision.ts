// V-key debug overlay: for every alive unit, draws cone edges, the cone hex set
// (faint tint), the visible hex set (stronger tint), and a trace line from the
// unit to its currently-tracked enemy. Cone edges use team color.

import type { GameState, HexKey } from '../game/types.ts';
import { gridPixelSize, hexToPixel, hexCorners } from '../game/hex.ts';
import { computePerUnitDebug, hexKey } from '../game/vision.ts';
import { GRID, VISION_COLORS } from '../game/config.ts';

export function drawDebugVision(ctx: CanvasRenderingContext2D, state: GameState): void {
  const debug = computePerUnitDebug(state);
  const unitsById: Record<string, (typeof state.units)[number]> = {};
  for (const u of state.units) unitsById[u.id] = u;

  // Layer 1: cone hexes (faint).
  ctx.save();
  ctx.fillStyle = VISION_COLORS.coneHex;
  forEachHex(state, (key, col, row) => {
    if (anyHas(debug, key, 'cone')) fillHex(ctx, col, row);
  });
  ctx.restore();

  // Layer 2: visible hexes (stronger).
  ctx.save();
  ctx.fillStyle = VISION_COLORS.visibleHex;
  forEachHex(state, (key, col, row) => {
    if (anyHas(debug, key, 'visible')) fillHex(ctx, col, row);
  });
  ctx.restore();

  // Layer 3: cone-edge rays + tracking lines.
  const { width, height } = gridPixelSize(GRID.cols, GRID.rows);
  const rayLen = Math.hypot(width, height);
  for (const unitId of Object.keys(debug)) {
    const u = unitsById[unitId];
    if (!u) continue;
    const info = debug[unitId];
    const { x, y } = hexToPixel(u.pos);
    const edgeColor =
      u.team === 'defenders' ? VISION_COLORS.coneEdgeDefender : VISION_COLORS.coneEdgeAttacker;

    ctx.save();
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    drawRay(ctx, x, y, info.coneCenterRad - info.halfRad, rayLen);
    drawRay(ctx, x, y, info.coneCenterRad + info.halfRad, rayLen);
    ctx.restore();

    const track = state.tracking[u.id];
    if (track) {
      const target = hexToPixel(track.lastKnownHex);
      ctx.save();
      ctx.strokeStyle = VISION_COLORS.traceLine;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function forEachHex(
  state: GameState,
  fn: (key: HexKey, col: number, row: number) => void,
): void {
  for (let row = 0; row < state.map.height; row++) {
    for (let col = 0; col < state.map.width; col++) fn(hexKey({ col, row }), col, row);
  }
}

function anyHas(
  debug: ReturnType<typeof computePerUnitDebug>,
  key: HexKey,
  field: 'cone' | 'visible',
): boolean {
  for (const id of Object.keys(debug)) {
    if (debug[id][field].has(key)) return true;
  }
  return false;
}

function fillHex(ctx: CanvasRenderingContext2D, col: number, row: number): void {
  const { x, y } = hexToPixel({ col, row });
  const corners = hexCorners(x, y);
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.fill();
}

function drawRay(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angleRad: number,
  length: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(angleRad) * length, y + Math.sin(angleRad) * length);
  ctx.stroke();
}
