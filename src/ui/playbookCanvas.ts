// Map-canvas play editor (Stage 2). Renders the season map and lets the manager
// drag unit tokens onto exact hexes — the visual replacement for the abstract
// slot-grid. 2a = placement (pinHex); watch arrows (2b) + routes (2c) layer on
// via the mode toolbar. Pure DOM/canvas; reuses the in-match renderer primitives.

import type { HexCoord, MapDefinition } from '../game/types.ts';
import { setupCanvas } from '../render/canvas.ts';
import { drawHexGrid } from '../render/drawHexGrid.ts';
import { drawRegionLabels } from '../render/drawRegionLabels.ts';
import { offsetToPixel, pixelToOffset } from '../game/hex.ts';
import { passableAt } from '../game/pathfind.ts';
import { HEX } from '../game/config.ts';

export type EditorToken = { id: string; weapon: 'rifle' | 'sniper'; pinHex: HexCoord };

export type PlaybookCanvasState = {
  tokens: () => EditorToken[];
  selectedId: () => string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, hex: HexCoord) => void;
};

export type PlaybookCanvasHandle = { redraw: () => void; destroy: () => void };

export function createPlaybookCanvas(
  host: HTMLElement,
  map: MapDefinition,
  s: PlaybookCanvasState,
): PlaybookCanvasHandle {
  host.innerHTML = '';
  const { canvas, ctx, cssWidth, cssHeight } = setupCanvas(host);
  let drag: { id: string; px: { x: number; y: number } } | null = null;

  // Pointer → native canvas pixels (scale-correct: the canvas may be CSS-shrunk
  // to fit the overlay, so divide by the rendered/native ratio).
  const evPx = (ev: MouseEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return { x: (ev.clientX - rect.left) * (cssWidth / rect.width), y: (ev.clientY - rect.top) * (cssHeight / rect.height) };
  };
  const evHex = (ev: MouseEvent): HexCoord => { const p = evPx(ev); return pixelToOffset(p.x, p.y); };
  const tokenAt = (hex: HexCoord): EditorToken | null =>
    s.tokens().find((t) => t.pinHex.col === hex.col && t.pinHex.row === hex.row) ?? null;
  const occupiedByOther = (id: string, hex: HexCoord): boolean =>
    s.tokens().some((t) => t.id !== id && t.pinHex.col === hex.col && t.pinHex.row === hex.row);

  canvas.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    const t = tokenAt(evHex(ev));
    if (t) { s.onSelect(t.id); drag = { id: t.id, px: evPx(ev) }; }
    else s.onSelect(null);
    redraw();
    ev.preventDefault();
  });
  canvas.addEventListener('mousemove', (ev) => { if (drag) { drag.px = evPx(ev); redraw(); } });
  function onUp(ev: MouseEvent): void {
    if (!drag || ev.button !== 0) return;
    const hex = evHex(ev);
    const id = drag.id;
    drag = null;
    if (passableAt(map, hex) && !occupiedByOther(id, hex)) s.onMove(id, hex);
    redraw();
  }
  document.addEventListener('mouseup', onUp);

  function drawToken(t: EditorToken, p: { x: number; y: number }, selected: boolean): void {
    ctx.beginPath();
    ctx.arc(p.x, p.y, HEX.size * 0.72, 0, Math.PI * 2);
    ctx.fillStyle = t.weapon === 'sniper' ? '#3b82c4' : '#46a758';
    ctx.fill();
    ctx.lineWidth = selected ? 3 : 1.5;
    ctx.strokeStyle = selected ? '#e0b13a' : '#0b0e14';
    ctx.stroke();
    ctx.fillStyle = '#0b0e14';
    ctx.font = `bold ${HEX.size}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t.weapon === 'sniper' ? 'S' : 'R', p.x, p.y);
  }

  function redraw(): void {
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    drawHexGrid(ctx, map);
    drawRegionLabels(ctx, map);
    const sel = s.selectedId();
    for (const t of s.tokens()) {
      if (drag && drag.id === t.id) continue; // drawn as a ghost below
      const { x, y } = offsetToPixel(t.pinHex.col, t.pinHex.row);
      drawToken(t, { x, y }, t.id === sel);
    }
    if (drag) {
      const t = s.tokens().find((x) => x.id === drag!.id);
      if (t) { ctx.save(); ctx.globalAlpha = 0.6; drawToken(t, drag.px, true); ctx.restore(); }
    }
  }

  redraw();
  return { redraw, destroy: () => { document.removeEventListener('mouseup', onUp); host.innerHTML = ''; } };
}
