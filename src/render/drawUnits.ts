// Draws each alive unit as a team-colored square labelled with its id (D1/A1…)
// so the player can tell which player is where at a glance — weapon/role/etc.
// live in the side panels + on hover. A hovered unit gets a yellow outline.

import type { Unit } from '../game/types.ts';
import { hexToPixel } from '../game/hex.ts';
import { shortLabels } from '../game/names.ts';
import { COLORS, HEX, SELECTION_COLOR } from '../game/config.ts';

export type DragState = { unitId: string; pixel: { x: number; y: number } } | null;

export function drawUnits(
  ctx: CanvasRenderingContext2D,
  units: readonly Unit[],
  highlightedId: string | null,
  selectedId: string | null = null,
  hiddenEnemyIds: ReadonlySet<string> = new Set(),
  dragState: DragState = null,
): void {
  // Square fits inside the pointy-top hex (flat-to-flat = size*√3).
  const side = HEX.size * 1.25;
  const half = side / 2;
  const glyphPx = Math.round(HEX.size * 0.85);
  // The label is 2–3 chars (handle initials), so it needs a smaller font than
  // the single '×' dead-marker glyph to fit inside the square.
  const labelPx = Math.round(HEX.size * 0.62);
  // Handle-initial labels (team-unique), so the map reads as players not slots.
  const labels = shortLabels(units);

  // F1 — find the dragged unit so we can draw it at the cursor pixel
  // instead of its hex (skipped in the main pass; drawn as a "ghost"
  // after the loop).
  const draggedUnit = dragState ? units.find((u) => u.id === dragState.unitId) : null;

  for (const unit of units) {
    if (draggedUnit && unit.id === draggedUnit.id) continue;
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

    // Handle-initial label — identity at a glance.
    ctx.fillStyle = COLORS.unitLabel;
    ctx.font = `bold ${labelPx}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labels[unit.id] ?? unit.id, x, y + 1);

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

  // F1 — dragging "ghost": render the dragged unit at the cursor pixel with
  // reduced opacity + a yellow outline. Skips the body fill in the main pass
  // above so the unit appears to follow the cursor. On drop (mouseup), the
  // caller updates state.units[id].pos and the next render frame draws the
  // unit at its new hex normally.
  if (draggedUnit && dragState) {
    const { x, y } = dragState.pixel;
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle =
      draggedUnit.team === 'defenders' ? COLORS.defenderUnit : COLORS.attackerUnit;
    ctx.fillRect(x - half, y - half, side, side);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.unitLabel;
    ctx.font = `bold ${labelPx}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labels[draggedUnit.id] ?? draggedUnit.id, x, y + 1);
    // Drag halo so the ghost reads clearly even over dark map cells.
    ctx.strokeStyle = COLORS.highlight;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - half - 2, y - half - 2, side + 4, side + 4);
    ctx.restore();
  }
}
