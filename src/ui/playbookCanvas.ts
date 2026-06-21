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

export type EditorToken = { id: string; weapon: 'rifle' | 'sniper'; pinHex: HexCoord; watchHex?: HexCoord; route?: HexCoord[] };
export type EditorMode = 'move' | 'watch' | 'route';

export type PlaybookCanvasState = {
  tokens: () => EditorToken[];
  selectedId: () => string | null;
  mode: () => EditorMode;
  onSelect: (id: string | null) => void;
  onMove: (id: string, hex: HexCoord) => void;
  onSetWatch: (id: string, hex: HexCoord) => void;
  onAddWaypoint: (id: string, hex: HexCoord) => void;
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
    const hex = evHex(ev);
    const t = tokenAt(hex);
    if (s.mode() === 'watch') {
      // Watch mode: click a unit to select it, or click any hex to point the
      // selected unit's cone there (a watch angle can aim anywhere, even a wall).
      if (t) s.onSelect(t.id);
      else { const sel = s.selectedId(); if (sel) s.onSetWatch(sel, hex); }
      redraw();
      ev.preventDefault();
      return;
    }
    if (s.mode() === 'route') {
      // Route mode: click a unit to select it, or click passable hexes in sequence
      // to append the selected unit's flank waypoints (it pathfinds between them).
      if (t) s.onSelect(t.id);
      else { const sel = s.selectedId(); if (sel && passableAt(map, hex)) s.onAddWaypoint(sel, hex); }
      redraw();
      ev.preventDefault();
      return;
    }
    // Move mode (default): select + drag a token to reposition its hold.
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

  function drawArrow(from: HexCoord, to: HexCoord, color: string): void {
    const a = offsetToPixel(from.col, from.row);
    const b = offsetToPixel(to.col, to.row);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const head = HEX.size * 0.6;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - head * Math.cos(ang - 0.4), b.y - head * Math.sin(ang - 0.4));
    ctx.lineTo(b.x - head * Math.cos(ang + 0.4), b.y - head * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function redraw(): void {
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    drawHexGrid(ctx, map);
    drawRegionLabels(ctx, map);
    const sel = s.selectedId();
    // Routes under everything: a polyline through the drawn waypoints, ending at
    // the unit's pin (its hold). Dots mark each waypoint.
    for (const t of s.tokens()) {
      if (!t.route || t.route.length === 0) continue;
      const pts = [...t.route, t.pinHex].map((h) => offsetToPixel(h.col, h.row));
      ctx.save();
      ctx.strokeStyle = t.id === sel ? '#2bb3c4' : 'rgba(43,179,196,0.45)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const wp of t.route) {
        const p = offsetToPixel(wp.col, wp.row);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = t.id === sel ? '#2bb3c4' : 'rgba(43,179,196,0.5)';
        ctx.fill();
      }
      ctx.restore();
    }
    // Watch arrows under the tokens (selected one brighter).
    for (const t of s.tokens()) {
      if (t.watchHex) drawArrow(t.pinHex, t.watchHex, t.id === sel ? '#e0b13a' : 'rgba(224,177,58,0.45)');
    }
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
