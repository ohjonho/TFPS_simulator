// Canvas mouse handler for path drawing (planning phase only).
//
// UX:
//  - mousedown on a unit's spawn hex → starts a drag for that unit's path
//  - mousedown on a hex already on a path → starts a drag rooted at that hex
//    (drag forward extends; drag back over earlier hexes truncates)
//  - mouseup with no hex changes → "click" event: opens waypoint modal if the
//    starting hex is a non-spawn hex on a path
//  - mouseup with hex changes → finalizes the drag-edit silently
//
// Disabled during resolution phase.

import type { Axial, GameState, Path, Unit } from '../game/types.ts';
import {
  axialEq,
  canExtendPath,
  extendPath,
  indexOfHexInPath,
  truncatePath,
} from '../game/path.ts';
import { pixelToAxial } from '../game/hex.ts';

export type DrawingCallbacks = {
  getState: () => GameState;
  setPath: (unitId: string, path: Path) => void;
  openWaypointModal: (unitId: string, hexIndex: number, screenXY: { x: number; y: number }) => void;
};

type DragState = {
  unitId: string;
  startedAtHex: Axial;
  movedToOtherHex: boolean;
};

export function attachDrawing(canvas: HTMLCanvasElement, cb: DrawingCallbacks): void {
  let drag: DragState | null = null;

  canvas.addEventListener('mousedown', (ev) => {
    const state = cb.getState();
    if (state.phase !== 'planning') return;
    if (ev.button !== 0) return; // left button only

    const hex = hexAtEvent(canvas, ev);
    const ctx = findUnitAndPath(state, hex);
    if (!ctx) return;

    drag = {
      unitId: ctx.unit.id,
      startedAtHex: hex,
      movedToOtherHex: false,
    };

    // If we started on a hex INSIDE the path (not at the tail), retract the
    // path to that hex on mouse down. This lets users grab the middle of a
    // path and start re-drawing from there.
    if (ctx.startedHexIndex >= 0 && ctx.startedHexIndex < ctx.path.hexes.length - 1) {
      cb.setPath(ctx.unit.id, truncatePath(ctx.path, ctx.startedHexIndex));
    }
  });

  canvas.addEventListener('mousemove', (ev) => {
    if (!drag) return;
    const state = cb.getState();
    if (state.phase !== 'planning') {
      drag = null;
      return;
    }
    const hex = hexAtEvent(canvas, ev);
    const path = state.paths[drag.unitId];
    if (!path) return;

    const idx = indexOfHexInPath(path, hex);
    if (idx >= 0) {
      // Hovering an existing path hex → truncate to that hex (allows
      // dragging back to shorten before re-extending).
      if (idx < path.hexes.length - 1) {
        cb.setPath(drag.unitId, truncatePath(path, idx));
        drag.movedToOtherHex = true;
      }
      return;
    }
    // New hex → try to extend.
    if (canExtendPath(state.map, path, hex)) {
      cb.setPath(drag.unitId, extendPath(path, hex));
      drag.movedToOtherHex = true;
    }
  });

  const endDrag = (ev: MouseEvent) => {
    if (!drag) return;
    const state = cb.getState();
    const finished = drag;
    drag = null;
    if (state.phase !== 'planning') return;

    // Pure-click on an existing waypoint-eligible hex → open modal.
    if (!finished.movedToOtherHex) {
      const path = state.paths[finished.unitId];
      if (!path) return;
      const idx = indexOfHexInPath(path, finished.startedAtHex);
      if (idx > 0) {
        // Position modal near the cursor (canvas-relative client coords).
        cb.openWaypointModal(finished.unitId, idx, { x: ev.clientX, y: ev.clientY });
      }
    }
  };

  canvas.addEventListener('mouseup', endDrag);
  // If the cursor leaves the canvas while dragging, end the drag cleanly.
  canvas.addEventListener('mouseleave', (ev) => {
    if (drag) endDrag(ev);
  });
}

function hexAtEvent(canvas: HTMLCanvasElement, ev: MouseEvent): Axial {
  const rect = canvas.getBoundingClientRect();
  return pixelToAxial(ev.clientX - rect.left, ev.clientY - rect.top);
}

type DrawingTarget = {
  unit: Unit;
  path: Path;
  startedHexIndex: number;
};

// The hex must lie on exactly one unit's path (or on a unit's spawn hex,
// which is hexes[0] of that unit's path). Returns the matching unit/path.
function findUnitAndPath(state: GameState, hex: Axial): DrawingTarget | null {
  for (const unit of state.units) {
    const path = state.paths[unit.id];
    if (!path) continue;
    // Path's spawn hex matches the unit's pos in planning phase.
    if (axialEq(unit.pos, hex)) {
      return { unit, path, startedHexIndex: 0 };
    }
    const idx = indexOfHexInPath(path, hex);
    if (idx >= 0) {
      return { unit, path, startedHexIndex: idx };
    }
  }
  return null;
}
