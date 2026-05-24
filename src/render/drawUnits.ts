// Draws each alive unit as a team-colored square with a single weapon glyph.
// A hovered unit gets a yellow highlight outline.

import type { Unit } from '../game/types.ts';
import { hexToPixel } from '../game/hex.ts';
import { COLORS, HEX, SELECTION_COLOR, WEAPON_GLYPH } from '../game/config.ts';

export function drawUnits(
  ctx: CanvasRenderingContext2D,
  units: readonly Unit[],
  highlightedId: string | null,
  selectedId: string | null = null,
  hiddenEnemyIds: ReadonlySet<string> = new Set(),
): void {
  // Square fits inside the pointy-top hex (flat-to-flat = size*√3).
  const side = HEX.size * 1.25;
  const half = side / 2;
  const glyphPx = Math.round(HEX.size * 0.85);

  for (const unit of units) {
    const { x, y } = hexToPixel(unit.pos);

    // Dead units remain as greyed-out markers for the round (spec §7.2). They
    // ignore fog (their death position is known) and skip hover/selection chrome.
    if (unit.state !== 'alive') {
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#555b66';
      ctx.fillRect(x - half, y - half, side, side);
      ctx.fillStyle = '#9aa1ad';
      ctx.font = `bold ${glyphPx}px ui-monospace, Consolas, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('×', x, y + 1);
      ctx.globalAlpha = 1;
      continue;
    }
    if (hiddenEnemyIds.has(unit.id)) continue;

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

    // Selection outline sits just outside the body; hover highlight on top.
    if (unit.id === selectedId) {
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - half - 3, y - half - 3, side + 6, side + 6);
    }
    if (unit.id === highlightedId) {
      ctx.strokeStyle = COLORS.highlight;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - half - 1, y - half - 1, side + 2, side + 2);
    }
  }
}
