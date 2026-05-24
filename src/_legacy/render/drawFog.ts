// Fog of war overlay + persistent ghost markers, drawn from the perspective
// of state.playerTeam. Hexes not in the player team's visibility set get a
// dark translucent fill; enemies seen recently leave a faded ghost square
// for VISION.ghostTicks ticks after losing sight.

import type { GameState } from '../game/types.ts';
import { axialToPixel, hexCorners, offsetToAxial } from '../game/hex.ts';
import { axialKey } from '../game/vision.ts';
import { HEX, VISION_COLORS, WEAPON_GLYPH } from '../game/config.ts';

export function drawFog(ctx: CanvasRenderingContext2D, state: GameState): void {
  const visible = state.visibility[state.playerTeam];

  // Pass 1: shade every non-visible hex with the fog color.
  ctx.save();
  ctx.fillStyle = VISION_COLORS.fog;
  for (let row = 0; row < state.map.rows; row++) {
    for (let col = 0; col < state.map.cols; col++) {
      const hex = offsetToAxial(col, row);
      if (visible.has(axialKey(hex))) continue;
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
  }
  ctx.restore();

  // Pass 2: ghost markers for the player team's ghosts (enemies recently seen).
  const ghosts = state.ghosts[state.playerTeam];
  const ghostColor =
    state.playerTeam === 'defenders'
      ? VISION_COLORS.ghostAttacker
      : VISION_COLORS.ghostDefender;
  const side = HEX.size * 1.35;
  const half = side / 2;
  const glyphPx = Math.round(HEX.size * 0.85);

  ctx.save();
  for (const enemyId of Object.keys(ghosts)) {
    const entry = ghosts[enemyId];
    const enemy = state.units.find((u) => u.id === enemyId);
    if (!enemy) continue;
    const { x, y } = axialToPixel(entry.hex);
    ctx.fillStyle = ghostColor;
    ctx.fillRect(x - half, y - half, side, side);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = `bold ${glyphPx}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(WEAPON_GLYPH[enemy.weapon], x, y + 1);
  }
  ctx.restore();
}
