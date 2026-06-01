// Editor state: the char grid (the single source of truth — identical in shape
// to what mapFromCharGrid consumes), the active brush, the backdrop-image
// transform, and undo/redo. No DOM here; the view/controls read this and the
// callbacks below mutate it.

import { COLS, ROWS } from '../maps/gridUtils.ts';

/** Backdrop reference-image alignment (all in CSS pixels except opacity 0..1). */
export type ImageTransform = {
  opacity: number;
  scale: number;
  offsetX: number;
  offsetY: number;
};

const UNDO_LIMIT = 100;
const DEFAULT_FILL = '#'; // grid starts as solid wall — carve open space out of it.

function blankGrid(): string[][] {
  return Array.from({ length: ROWS }, () => Array<string>(COLS).fill(DEFAULT_FILL));
}

function cloneGrid(grid: string[][]): string[][] {
  return grid.map((row) => row.slice());
}

export class EditorModel {
  grid: string[][] = blankGrid();
  /** Active paint character (a legend char). */
  brush = '.';
  /** Grid-fill alpha (hex outlines always draw opaque) so the backdrop shows through. */
  gridOpacity = 0.85;
  /** Overlay each cell's legend char as faint text (the palette has too few
   *  distinct colors to read region sub-zones apart by color alone). */
  showLabels = true;
  image: ImageTransform = { opacity: 0.5, scale: 1, offsetX: 0, offsetY: 0 };

  private undoStack: string[][][] = [];
  private redoStack: string[][][] = [];

  /** Join the grid into the 40-row string[] that mapFromCharGrid expects. */
  toRows(): string[] {
    return this.grid.map((row) => row.join(''));
  }

  /** Push the current grid onto the undo stack (call once per stroke / bulk op). */
  snapshot(): void {
    this.undoStack.push(cloneGrid(this.grid));
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Paint one cell with `char` (defaults to the active brush). Returns true if it changed. */
  paintCell(col: number, row: number, char: string = this.brush): boolean {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return false;
    if (this.grid[row][col] === char) return false;
    this.grid[row][col] = char;
    return true;
  }

  /** Replace every cell with `char` (snapshots first). */
  fillAll(char: string): void {
    this.snapshot();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) this.grid[r][c] = char;
    }
  }

  /**
   * Replace the grid from a validated 40×30 row list (snapshots first).
   * Throws on a wrong shape — callers run mapFromCharGrid first so this only
   * guards against a programming mistake.
   */
  loadRows(rows: readonly string[]): void {
    if (rows.length !== ROWS) {
      throw new Error(`loadRows: expected ${ROWS} rows, got ${rows.length}`);
    }
    this.snapshot();
    for (let r = 0; r < ROWS; r++) {
      const line = rows[r];
      if (line.length !== COLS) {
        throw new Error(`loadRows: row ${r} is ${line.length} chars, expected ${COLS}`);
      }
      this.grid[r] = line.split('');
    }
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(cloneGrid(this.grid));
    this.grid = prev;
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(cloneGrid(this.grid));
    this.grid = next;
  }
}
