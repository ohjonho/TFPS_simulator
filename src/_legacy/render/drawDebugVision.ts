// V-key debug overlay: for every alive unit, draws the cone edges, the cone
// hex set (faint tint), the visible hex set (stronger tint), and a trace line
// from the unit to its currently-tracked enemy. Cone edges use team color so
// it's easy to tell which cone belongs to which side when both overlap.

import type { GameState, HexKey } from '../game/types.ts';
import {
  axialToPixel,
  gridPixelSize,
  hexCorners,
  offsetToAxial,
} from '../game/hex.ts';
import { axialKey, computePerUnitDebug, parseAxialKey } from '../game/vision.ts';
import { VISION_COLORS } from '../game/config.ts';

export function drawDebugVision(ctx: CanvasRenderingContext2D, state: GameState): void {
  const debug = computePerUnitDebug(state);
  const unitsById: Record<string, (typeof state.units)[number]> = {};
  for (const u of state.units) unitsById[u.id] = u;

  // Layer 1: fill cone hexes (per-unit, accumulated). Drawn first so the
  // brighter "visible" tint overlays it cleanly. Iterate by hex so the fill
  // for any hex accumulates from every unit that includes it.
  ctx.save();
  ctx.fillStyle = VISION_COLORS.coneHex;
  for (let row = 0; row < state.map.rows; row++) {
    for (let col = 0; col < state.map.cols; col++) {
      const hex = offsetToAxial(col, row);
      const key = axialKey(hex);
      if (!anyUnitHasInCone(debug, key)) continue;
      fillHexPolygon(ctx, hex);
    }
  }
  ctx.restore();

  // Layer 2: fill visible hexes (cone ∩ unoccluded), stronger tint.
  ctx.save();
  ctx.fillStyle = VISION_COLORS.visibleHex;
  for (let row = 0; row < state.map.rows; row++) {
    for (let col = 0; col < state.map.cols; col++) {
      const hex = offsetToAxial(col, row);
      const key = axialKey(hex);
      if (!anyUnitHasVisible(debug, key)) continue;
      fillHexPolygon(ctx, hex);
    }
  }
  ctx.restore();

  // Layer 3: cone edge rays + tracking lines. Drawn on top so they're always
  // visible over the hex tints.
  const { width, height } = gridPixelSize(state.map.cols, state.map.rows);
  const rayLen = Math.hypot(width, height);
  for (const unitId of Object.keys(debug)) {
    const u = unitsById[unitId];
    if (!u) continue;
    const info = debug[unitId];
    const { x, y } = axialToPixel(u.pos);
    const edgeColor =
      u.team === 'defenders'
        ? VISION_COLORS.coneEdgeDefender
        : VISION_COLORS.coneEdgeAttacker;

    ctx.save();
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    drawRay(ctx, x, y, info.coneCenterRad - info.halfRad, rayLen);
    drawRay(ctx, x, y, info.coneCenterRad + info.halfRad, rayLen);
    ctx.restore();

    // Tracking line to the last-known hex of the tracked enemy.
    const track = state.tracking[u.id];
    if (track) {
      const target = axialToPixel(track.lastKnownHex);
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

function anyUnitHasInCone(
  debug: ReturnType<typeof computePerUnitDebug>,
  key: HexKey,
): boolean {
  for (const id of Object.keys(debug)) {
    if (debug[id].cone.has(key)) return true;
  }
  return false;
}

function anyUnitHasVisible(
  debug: ReturnType<typeof computePerUnitDebug>,
  key: HexKey,
): boolean {
  for (const id of Object.keys(debug)) {
    if (debug[id].visible.has(key)) return true;
  }
  return false;
}

function fillHexPolygon(
  ctx: CanvasRenderingContext2D,
  hex: ReturnType<typeof parseAxialKey>,
): void {
  const { x, y } = axialToPixel(hex);
  const corners = hexCorners(x, y);
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
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
