// Canvas mousemove → axial hex → unit lookup. Calls back with the unit id
// (or null) whenever it changes. Unit list is read via a getter so updates
// during resolution (movement) immediately reflect in hover state.

import type { Unit } from '../game/types.ts';
import { pixelToAxial } from '../game/hex.ts';

export type HoverCallback = (unitId: string | null) => void;
export type UnitsGetter = () => readonly Unit[];

export function attachHover(
  canvas: HTMLCanvasElement,
  getUnits: UnitsGetter,
  onChange: HoverCallback,
): void {
  let currentId: string | null = null;

  canvas.addEventListener('mousemove', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const hex = pixelToAxial(x, y);

    let foundId: string | null = null;
    for (const unit of getUnits()) {
      if (unit.state !== 'alive') continue;
      if (unit.pos.q === hex.q && unit.pos.r === hex.r) {
        foundId = unit.id;
        break;
      }
    }

    if (foundId !== currentId) {
      currentId = foundId;
      onChange(foundId);
    }
  });

  canvas.addEventListener('mouseleave', () => {
    if (currentId !== null) {
      currentId = null;
      onChange(null);
    }
  });
}
