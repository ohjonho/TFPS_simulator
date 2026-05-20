// Creates the <canvas> element sized to the grid and mounts it into a host.
// Handles devicePixelRatio so lines stay crisp on HiDPI displays.

import { GRID } from '../game/config.ts';
import { gridPixelSize } from '../game/hex.ts';

export type CanvasHandle = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cssWidth: number;
  cssHeight: number;
};

export function setupCanvas(host: HTMLElement): CanvasHandle {
  const { width, height } = gridPixelSize(GRID.cols, GRID.rows);
  const dpr = window.devicePixelRatio || 1;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * dpr);
  canvas.height = Math.ceil(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.display = 'block';

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas context unavailable');
  }
  // Scale once so all drawing uses CSS pixels.
  ctx.scale(dpr, dpr);

  host.appendChild(canvas);

  return { canvas, ctx, cssWidth: width, cssHeight: height };
}
