// Draws each alive unit as a team-colored square with a single weapon glyph.
// A hovered unit gets a yellow highlight outline.

import type { Unit } from '../game/types.ts';
import { axialToPixel } from '../game/hex.ts';
import { COLORS, HEX, WEAPON_GLYPH } from '../game/config.ts';

export function drawUnits(
  ctx: CanvasRenderingContext2D,
  units: readonly Unit[],
  highlightedId: string | null,
): void {
  // Square fits inside the hex flat-to-flat (size * √3 ≈ 1.73 * size).
  // 1.35 * size gives comfortable padding while staying readable.
  const side = HEX.size * 1.35;
  const half = side / 2;
  const glyphPx = Math.round(HEX.size * 0.85);

  for (const unit of units) {
    if (unit.state !== 'alive') continue;
    const { x, y } = axialToPixel(unit.pos);

    // Body.
    ctx.fillStyle =
      unit.team === 'defenders' ? COLORS.defenderUnit : COLORS.attackerUnit;
    ctx.fillRect(x - half, y - half, side, side);

    // Weapon glyph.
    ctx.fillStyle = COLORS.unitLabel;
    ctx.font = `bold ${glyphPx}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(WEAPON_GLYPH[unit.weapon], x, y + 1);

    if (unit.id === highlightedId) {
      ctx.strokeStyle = COLORS.highlight;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - half - 1, y - half - 1, side + 2, side + 2);
    }
  }
}
