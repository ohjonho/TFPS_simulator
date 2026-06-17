// Fog of war overlay + persistent ghost markers, drawn from the perspective of
// state.playerTeam. Non-visible hexes get a dark translucent fill; enemies seen
// recently leave a faded ghost square for VISION.ghostTicks ticks after losing
// sight.

import type { GameState } from '../game/types.ts';
import { hexToPixel, hexCorners } from '../game/hex.ts';
import { hexKey } from '../game/vision.ts';
import { shortLabels } from '../game/names.ts';
import { HEX, VISION_COLORS } from '../game/config.ts';

export function drawFog(ctx: CanvasRenderingContext2D, state: GameState): void {
  const visible = state.visibility[state.playerTeam];

  // Shade every non-visible hex.
  ctx.save();
  ctx.fillStyle = VISION_COLORS.fog;
  for (let row = 0; row < state.map.height; row++) {
    for (let col = 0; col < state.map.width; col++) {
      if (visible.has(hexKey({ col, row }))) continue;
      const { x, y } = hexToPixel({ col, row });
      const corners = hexCorners(x, y);
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();

  // Ghost markers for the player team's ghosts (enemies recently seen).
  const ghosts = state.ghosts[state.playerTeam];
  const ghostColor =
    state.playerTeam === 'defenders'
      ? VISION_COLORS.ghostAttacker
      : VISION_COLORS.ghostDefender;
  const side = HEX.size * 1.25;
  const half = side / 2;
  const labelPx = Math.round(HEX.size * 0.62);
  const labels = shortLabels(state.units);

  ctx.save();
  for (const enemyId of Object.keys(ghosts)) {
    const enemy = state.units.find((u) => u.id === enemyId);
    if (!enemy) continue;
    const { x, y } = hexToPixel(ghosts[enemyId].hex);
    ctx.fillStyle = ghostColor;
    ctx.fillRect(x - half, y - half, side, side);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = `bold ${labelPx}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labels[enemy.id] ?? enemy.id, x, y + 1);
  }
  ctx.restore();
}
