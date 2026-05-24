// Click-to-select unit info. Clicking a unit on the map sets the selection
// (the side panel reflects unit details during resolution). Esc clears.
//
// Note: target-assign was removed in the Pass 7.5 fix pass — units only get
// targets from the strategy menu now (no per-hex orders).

import type { Unit } from '../game/types.ts';
import { pixelToOffset } from '../game/hex.ts';

export type ClickToCommandOptions = {
  getUnits: () => readonly Unit[];
  onSelect: (unitId: string | null) => void;
};

export function attachClickToCommand(
  canvas: HTMLCanvasElement,
  opts: ClickToCommandOptions,
): void {
  canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const hex = pixelToOffset(ev.clientX - rect.left, ev.clientY - rect.top);
    const hit = aliveUnitAt(opts.getUnits(), hex);
    if (hit) opts.onSelect(hit.id);
  });

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') opts.onSelect(null);
  });
}

function aliveUnitAt(units: readonly Unit[], hex: { col: number; row: number }): Unit | null {
  for (const u of units) {
    if (u.state !== 'alive') continue;
    if (u.pos.col === hex.col && u.pos.row === hex.row) return u;
  }
  return null;
}
