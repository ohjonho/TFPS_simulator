// Pass D — toggleable region-name overlay. Lets the player map "A site",
// "mid", "b_main" back to actual hexes (needed since Pass C2 simplified
// variant labels to just "A"/"B"). Drawn faded above the grid but below
// routes / units / card effects.

import type { MapDefinition } from '../game/types.ts';
import { regionCentroid } from '../game/strategies.ts';
import { hexToPixel } from '../game/hex.ts';
import { REGION_LABEL } from '../game/config.ts';

const SKIP = new Set<string>(REGION_LABEL.skip);

export function drawRegionLabels(ctx: CanvasRenderingContext2D, map: MapDefinition): void {
  ctx.save();
  ctx.font = REGION_LABEL.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = REGION_LABEL.outlineWidth;
  ctx.strokeStyle = REGION_LABEL.outlineColor;
  ctx.fillStyle = REGION_LABEL.color;

  for (const name of Object.keys(map.regions)) {
    if (SKIP.has(name)) continue;
    const centroid = regionCentroid(map, name);
    if (!centroid) continue;
    const { x, y } = hexToPixel(centroid);
    // Outline first (darker, slightly wider) so the label stays legible over
    // any cell color.
    ctx.strokeText(name, x, y);
    ctx.fillText(name, x, y);
  }
  ctx.restore();
}
