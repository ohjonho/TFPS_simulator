// The canvas: draws the backdrop image + the char grid + the hover highlight,
// and turns pointer events into paint strokes. Reuses the game's hex geometry
// (offsetToPixel / hexCorners) and its exact pixel→hex inverse (pixelToOffset)
// so the editor grid lines up cell-for-cell with how the sim renders maps.

import type { HexCoord } from '../game/types.ts';
import { COLORS, HEX } from '../game/config.ts';
import { offsetToPixel, hexCorners, pixelToOffset } from '../game/hex.ts';
import { COLS, ROWS } from '../maps/gridUtils.ts';
import { setupCanvas } from '../render/canvas.ts';
import type { CanvasHandle } from '../render/canvas.ts';
import { charColor } from './legend.ts';
import type { EditorModel } from './model.ts';

export type ViewCallbacks = {
  /** Grid changed via the canvas (paint stroke) — revalidate + refresh UI. */
  afterEdit: () => void;
  /** Hovered cell changed — update the {col,row} readout (null = off-grid). */
  onHover: (hex: HexCoord | null) => void;
};

export class EditorView {
  readonly cssWidth: number;
  readonly cssHeight: number;

  private readonly handle: CanvasHandle;
  private readonly model: EditorModel;
  private readonly cb: ViewCallbacks;

  private image: HTMLImageElement | null = null;
  private hover: HexCoord | null = null;
  private painting = false;
  private lastPainted: HexCoord | null = null;
  private rafPending = false;

  constructor(host: HTMLElement, model: EditorModel, cb: ViewCallbacks) {
    this.model = model;
    this.cb = cb;
    this.handle = setupCanvas(host);
    this.cssWidth = this.handle.cssWidth;
    this.cssHeight = this.handle.cssHeight;
    this.attachPointer();
    this.requestRender();
  }

  /** Set (or clear) the backdrop reference image and redraw. */
  setImage(image: HTMLImageElement | null): void {
    this.image = image;
    this.requestRender();
  }

  /** Schedule a redraw (coalesced to one per animation frame). */
  requestRender(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.draw();
    });
  }

  // --- drawing -------------------------------------------------------------

  private draw(): void {
    const { ctx } = this.handle;
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    this.drawImage(ctx);
    this.drawGrid(ctx);
    this.drawLabels(ctx);
    this.drawHover(ctx);
  }

  private drawImage(ctx: CanvasRenderingContext2D): void {
    const img = this.image;
    if (!img) return;
    const { opacity, scale, offsetX, offsetY } = this.model.image;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.drawImage(img, offsetX, offsetY, img.naturalWidth * scale, img.naturalHeight * scale);
    ctx.restore();
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const fillAlpha = this.model.gridOpacity;
    ctx.lineWidth = 0.6;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const { x, y } = offsetToPixel(col, row);
        const corners = hexCorners(x, y);
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();

        const { fill, stroke } = charColor(this.model.grid[row][col]);
        ctx.globalAlpha = fillAlpha;
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = stroke;
        ctx.stroke();
      }
    }
  }

  // Faint per-cell legend char. The palette only has ~7 CellType colors but the
  // vocabulary has ~30 chars (many sub-zones share a color), so the code label
  // is the only way to tell e.g. a_anchor from a_off from a_entry. Walls ('#')
  // are skipped — they're the most numerous and unambiguous from color alone.
  private drawLabels(ctx: CanvasRenderingContext2D): void {
    if (!this.model.showLabels) return;
    ctx.save();
    ctx.font = `${Math.round(HEX.size * 0.8)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 2;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const ch = this.model.grid[row][col];
        if (ch === '#') continue;
        const { x, y } = offsetToPixel(col, row);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.strokeText(ch, x, y);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.fillText(ch, x, y);
      }
    }
    ctx.restore();
  }

  private drawHover(ctx: CanvasRenderingContext2D): void {
    if (!this.hover) return;
    const { x, y } = offsetToPixel(this.hover.col, this.hover.row);
    const corners = hexCorners(x, y);
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.highlight;
    ctx.stroke();
  }

  // --- interaction ---------------------------------------------------------

  private attachPointer(): void {
    const c = this.handle.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e));
    c.addEventListener('pointerleave', () => this.setHover(null));
    // Suppress the context menu so right-drag could be used later if wanted.
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private cellAt(e: PointerEvent): HexCoord | null {
    const hex = pixelToOffset(e.offsetX, e.offsetY);
    if (hex.col < 0 || hex.col >= COLS || hex.row < 0 || hex.row >= ROWS) return null;
    return hex;
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const hex = this.cellAt(e);
    if (!hex) return;
    this.painting = true;
    this.lastPainted = null;
    this.model.snapshot(); // whole stroke is one undo step
    this.handle.canvas.setPointerCapture(e.pointerId);
    this.paintAt(hex);
  }

  private onMove(e: PointerEvent): void {
    const hex = this.cellAt(e);
    this.setHover(hex);
    if (this.painting && hex) this.paintAt(hex);
  }

  private onUp(e: PointerEvent): void {
    if (!this.painting) return;
    this.painting = false;
    this.lastPainted = null;
    if (this.handle.canvas.hasPointerCapture(e.pointerId)) {
      this.handle.canvas.releasePointerCapture(e.pointerId);
    }
  }

  private paintAt(hex: HexCoord): void {
    if (this.lastPainted && this.lastPainted.col === hex.col && this.lastPainted.row === hex.row) {
      return;
    }
    this.lastPainted = hex;
    if (this.model.paintCell(hex.col, hex.row)) this.cb.afterEdit();
  }

  private setHover(hex: HexCoord | null): void {
    const changed =
      (this.hover === null) !== (hex === null) ||
      (hex !== null && this.hover !== null && (hex.col !== this.hover.col || hex.row !== this.hover.row));
    if (!changed) return;
    this.hover = hex;
    this.cb.onHover(hex);
    this.requestRender();
  }
}
