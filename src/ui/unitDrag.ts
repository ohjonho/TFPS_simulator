// Pass E3 — drag player units within their starting zone during planning.
// Click-and-hold a player-team alive unit on the canvas → drag to a new hex
// in the team's CURRENT-side spawn region → release. The caller validates
// (in-zone, passable, unoccupied) and commits the move; the drag module
// just emits start / end events and tracks the active drag for cursor state.
//
// Resolution-phase drags are blocked at the source (`shouldStart` returns
// false). Esc cancels mid-drag.

import type { HexCoord, Unit } from '../game/types.ts';
import { pixelToOffset } from '../game/hex.ts';

export type UnitDragCallbacks = {
  // True iff a drag is permitted right now (e.g. planning phase). Checked
  // on mousedown so resolution clicks fall through to selection.
  canDrag: () => boolean;
  // Find a draggable unit at the given hex (caller filters to alive +
  // player team). Returns null when nothing to drag.
  unitAt: (hex: HexCoord) => Unit | null;
  // Commit the drag. Caller validates spawn-zone / passable / unoccupied.
  // Returns true if the move was accepted (used purely for diagnostics).
  onCommit: (unitId: string, target: HexCoord) => boolean;
  // Optional hover-tracking during drag (used by main.ts to update the
  // hex highlight while dragging).
  onHover?: (hex: HexCoord | null) => void;
  // F1 — drag state callback. Called on mousedown (start) with the cursor
  // pixel + unit id; on every mousemove with the updated pixel; on commit
  // / cancel with null. The renderer reads this to draw a "ghost" unit
  // following the cursor so the player can SEE what they're dragging
  // (pre-fix the unit was invisibly attached to the cursor).
  onDragState?: (state: { unitId: string; pixel: { x: number; y: number } } | null) => void;
};

type Active = { unitId: string };
let active: Active | null = null;

export function attachUnitDrag(
  canvas: HTMLCanvasElement,
  cb: UnitDragCallbacks,
): void {
  function pixelFromEvent(ev: MouseEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  canvas.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;            // left button only
    if (!cb.canDrag()) return;
    const hex = canvasHexFromEvent(canvas, ev);
    const u = cb.unitAt(hex);
    if (!u) return;
    active = { unitId: u.id };
    canvas.classList.add('dragging-unit');
    cb.onDragState?.({ unitId: u.id, pixel: pixelFromEvent(ev) });
    // Prevent the canvas-area click handler from also firing (otherwise
    // mousedown→click on the same hex would also select).
    ev.preventDefault();
  });

  canvas.addEventListener('mousemove', (ev) => {
    if (!active) return;
    const hex = canvasHexFromEvent(canvas, ev);
    cb.onHover?.(hex);
    cb.onDragState?.({ unitId: active.unitId, pixel: pixelFromEvent(ev) });
  });

  // Document-level mouseup so a release outside the canvas still cleans up.
  document.addEventListener('mouseup', (ev) => {
    if (!active || ev.button !== 0) return;
    const hex = canvasHexFromEvent(canvas, ev);
    const id = active.unitId;
    active = null;
    canvas.classList.remove('dragging-unit');
    cb.onHover?.(null);
    cb.onDragState?.(null);
    cb.onCommit(id, hex);
  });

  // Esc cancels an in-progress drag.
  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !active) return;
    active = null;
    canvas.classList.remove('dragging-unit');
    cb.onHover?.(null);
    cb.onDragState?.(null);
  });
}

function canvasHexFromEvent(canvas: HTMLCanvasElement, ev: MouseEvent): HexCoord {
  const rect = canvas.getBoundingClientRect();
  return pixelToOffset(ev.clientX - rect.left, ev.clientY - rect.top);
}

// Public predicate the caller uses to decide whether a target hex is valid
// for the dragged unit. Kept here so the validation rule lives next to the
// drag module's intent: "within the unit's team-side spawn region, passable,
// not occupied by another alive unit." The spawn-region lookup uses
// state.teamSide so the post-halftime defender team correctly drops onto
// the attacker-side spawn zone.
export function isValidDropHex(
  unit: Unit,
  target: HexCoord,
  spawnRegion: readonly HexCoord[],
  units: readonly Unit[],
  isPassable: (hex: HexCoord) => boolean,
): boolean {
  if (!isPassable(target)) return false;
  if (!spawnRegion.some((h) => h.col === target.col && h.row === target.row)) return false;
  // Allow dropping onto own hex (no-op) but not onto another alive unit.
  for (const u of units) {
    if (u.id === unit.id) continue;
    if (u.state !== 'alive') continue;
    if (u.pos.col === target.col && u.pos.row === target.row) return false;
  }
  return true;
}
