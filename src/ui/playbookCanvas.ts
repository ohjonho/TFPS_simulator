// Map-canvas play editor (Stage 2). Renders the season map and lets the manager
// drag unit tokens onto exact hexes — the visual replacement for the abstract
// slot-grid. 2a = placement (pinHex); watch arrows (2b) + routes (2c) layer on
// via the mode toolbar. Pure DOM/canvas; reuses the in-match renderer primitives.

import type { HexCoord, MapDefinition, RouteStep, Unit, Weapon } from '../game/types.ts';
import { setupCanvas } from '../render/canvas.ts';
import { drawHexGrid } from '../render/drawHexGrid.ts';
import { drawRegionLabels } from '../render/drawRegionLabels.ts';
import { offsetToPixel, pixelToOffset, hexDistance } from '../game/hex.ts';
import { passableAt, findPath } from '../game/pathfind.ts';
import { hexesInCone, isVisibleAlongLine, facingBearingRad } from '../game/vision.ts';
import { nearestFacing } from '../game/unit-ai.ts';
import { HEX, VISION } from '../game/config.ts';

export type EditorToken = { id: string; weapon: Weapon; pinHex: HexCoord; watchHex?: HexCoord; route?: RouteStep[] };

const WEAPON_COLOR: Record<Weapon, string> = { rifle: '#46a758', sniper: '#3b82c4', shotgun: '#d4843a' };
const WEAPON_LETTER: Record<Weapon, string> = { rifle: 'R', sniper: 'S', shotgun: 'G' };
export type EditorMode = 'move' | 'watch' | 'route';

export type PlaybookCanvasState = {
  tokens: () => EditorToken[];
  selectedId: () => string | null;
  mode: () => EditorMode;
  showVision: () => boolean;        // overlay the team's combined view cones
  spawnCells: () => HexCoord[];     // own-side spawn cells (path/start origin)
  approachHex: () => HexCoord | null; // enemy direction (default watch when none set)
  selectedWaypoint: () => number | null; // index of the route step being edited
  armWatch: () => boolean;          // next route-mode click sets the selected step's watch
  onSelect: (id: string | null) => void;
  onMove: (id: string, hex: HexCoord) => void;
  onSetWatch: (id: string, hex: HexCoord) => void;
  onAddWaypoint: (id: string, hex: HexCoord) => void;
  onSetWaypointWatch: (id: string, idx: number, hex: HexCoord) => void;
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
      // Route mode: click a unit to select it; otherwise, if "set watch" is armed
      // aim the selected waypoint's cone, else append the next sequential waypoint.
      // (Waypoint selection + wait/watch editing live in the side panel.)
      if (t) s.onSelect(t.id);
      else {
        const sel = s.selectedId();
        const wp = s.selectedWaypoint();
        if (sel && s.armWatch() && wp != null) s.onSetWaypointWatch(sel, wp, hex);
        else if (sel && passableAt(map, hex)) s.onAddWaypoint(sel, hex);
      }
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

  function drawToken(t: EditorToken, p: { x: number; y: number }, selected: boolean, unreachable = false): void {
    ctx.beginPath();
    ctx.arc(p.x, p.y, HEX.size * 0.72, 0, Math.PI * 2);
    ctx.fillStyle = WEAPON_COLOR[t.weapon] ?? '#46a758';
    ctx.fill();
    ctx.lineWidth = unreachable || selected ? 3 : 1.5;
    ctx.strokeStyle = unreachable ? '#c4453b' : selected ? '#e0b13a' : '#0b0e14';
    ctx.stroke();
    ctx.fillStyle = '#0b0e14';
    ctx.font = `bold ${HEX.size}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(WEAPON_LETTER[t.weapon] ?? 'R', p.x, p.y);
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

  // Nearest own spawn cell to a hold — mirrors optimizeSpawns' "start closest to
  // your target" for the path preview.
  function startCellFor(pin: HexCoord): HexCoord | null {
    let best: HexCoord | null = null;
    let bd = Infinity;
    for (const c of s.spawnCells()) { const d = hexDistance(c, pin); if (d < bd) { bd = d; best = c; } }
    return best;
  }
  // The full path a unit walks: start → each route waypoint → pin. null if any
  // leg is unreachable (drives the reachability warning).
  function pathFor(t: EditorToken): HexCoord[] | null {
    const start = startCellFor(t.pinHex);
    if (!start) return null;
    const full: HexCoord[] = [start];
    let from = start;
    for (const stop of [...(t.route ?? []).map((st) => st.hex), t.pinHex]) {
      const leg = findPath(map, from, stop);
      if (!leg) return null;
      for (let i = 1; i < leg.length; i++) full.push(leg[i]);
      from = stop;
    }
    return full;
  }
  // Union of every token's visible cells (cone + LoS), facing its watch (or the
  // enemy approach when none set).
  function visionUnion(): Set<string> {
    const seen = new Set<string>();
    const half = (VISION.defaultConeHalfDeg * Math.PI) / 180;
    for (const t of s.tokens()) {
      const watch = t.watchHex ?? s.approachHex();
      if (!watch || (watch.col === t.pinHex.col && watch.row === t.pinHex.row)) continue;
      const facing = nearestFacing(t.pinHex, watch);
      const viewer = { pos: t.pinHex, facing } as Unit;
      for (const key of hexesInCone(viewer, map, facingBearingRad(t.pinHex, facing), half)) {
        const [c, r] = key.split(',').map(Number);
        if (isVisibleAlongLine(t.pinHex, { col: c, row: r }, map)) seen.add(key);
      }
    }
    return seen;
  }
  function drawPath(path: HexCoord[], bright: boolean): void {
    if (path.length < 2) return;
    ctx.save();
    ctx.strokeStyle = bright ? 'rgba(220,220,230,0.85)' : 'rgba(180,185,200,0.3)';
    ctx.lineWidth = bright ? 2 : 1.25;
    ctx.beginPath();
    const p0 = offsetToPixel(path[0].col, path[0].row);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < path.length; i++) { const p = offsetToPixel(path[i].col, path[i].row); ctx.lineTo(p.x, p.y); }
    ctx.stroke();
    // Spawn marker (a small square at the start).
    ctx.fillStyle = bright ? 'rgba(220,220,230,0.9)' : 'rgba(180,185,200,0.45)';
    ctx.fillRect(p0.x - 3, p0.y - 3, 6, 6);
    ctx.restore();
  }

  function redraw(): void {
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    drawHexGrid(ctx, map);
    drawRegionLabels(ctx, map);
    const sel = s.selectedId();
    const unreachable = new Set<string>();
    // Overlays (vision + paths) are skipped mid-drag for a smooth drag.
    if (!drag) {
      if (s.showVision()) {
        ctx.save();
        ctx.fillStyle = 'rgba(224,192,80,0.13)';
        for (const key of visionUnion()) {
          const [c, r] = key.split(',').map(Number);
          const p = offsetToPixel(c, r);
          ctx.beginPath();
          ctx.arc(p.x, p.y, HEX.size * 0.95, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      for (const t of s.tokens()) {
        const path = pathFor(t);
        if (!path) { unreachable.add(t.id); continue; }
        drawPath(path, t.id === sel);
      }
    }
    // Routes under everything: a polyline through the drawn waypoints, ending at
    // the unit's pin (its hold). Dots mark each waypoint.
    for (const t of s.tokens()) {
      if (!t.route || t.route.length === 0) continue;
      const bright = t.id === sel;
      const pts = [...t.route.map((st) => st.hex), t.pinHex].map((h) => offsetToPixel(h.col, h.row));
      ctx.save();
      ctx.strokeStyle = bright ? '#2bb3c4' : 'rgba(43,179,196,0.45)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.setLineDash([]);
      t.route.forEach((st, i) => {
        const p = offsetToPixel(st.hex.col, st.hex.row);
        const wpSel = bright && i === s.selectedWaypoint();
        ctx.beginPath();
        ctx.arc(p.x, p.y, wpSel ? 5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = bright ? '#2bb3c4' : 'rgba(43,179,196,0.5)';
        ctx.fill();
        if (wpSel) { ctx.lineWidth = 2; ctx.strokeStyle = '#e0b13a'; ctx.stroke(); }
        if (st.watchHex) drawArrow(st.hex, st.watchHex, bright ? 'rgba(43,179,196,0.85)' : 'rgba(43,179,196,0.4)');
        if (st.waitTicks) {
          ctx.fillStyle = '#cfe8ee';
          ctx.font = `bold ${HEX.size * 0.85}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${st.waitTicks}`, p.x + HEX.size * 0.7, p.y - HEX.size * 0.7);
        }
      });
      ctx.restore();
    }
    // Watch arrows under the tokens (selected one brighter).
    for (const t of s.tokens()) {
      if (t.watchHex) drawArrow(t.pinHex, t.watchHex, t.id === sel ? '#e0b13a' : 'rgba(224,177,58,0.45)');
    }
    for (const t of s.tokens()) {
      if (drag && drag.id === t.id) continue; // drawn as a ghost below
      const { x, y } = offsetToPixel(t.pinHex.col, t.pinHex.row);
      drawToken(t, { x, y }, t.id === sel, unreachable.has(t.id));
    }
    if (drag) {
      const t = s.tokens().find((x) => x.id === drag!.id);
      if (t) { ctx.save(); ctx.globalAlpha = 0.6; drawToken(t, drag.px, true); ctx.restore(); }
    }
  }

  redraw();
  return { redraw, destroy: () => { document.removeEventListener('mouseup', onUp); host.innerHTML = ''; } };
}
