// Low-opacity "A SITE" / "B SITE" labels on the bomb sites — shown during the
// tutorial match so a new manager can map the lettered sites to the map. Drawn
// after the grid but below routes/units (a faint backdrop). See config.SITE_LABEL.

import type { MapDefinition } from '../game/types.ts';
import { regionCentroid } from '../game/strategies.ts';
import { hexToPixel } from '../game/hex.ts';
import { SITE_LABEL } from '../game/config.ts';

export function drawSiteLabels(ctx: CanvasRenderingContext2D, map: MapDefinition): void {
  ctx.save();
  ctx.font = SITE_LABEL.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = SITE_LABEL.outlineWidth;
  ctx.strokeStyle = SITE_LABEL.outlineColor;
  ctx.fillStyle = SITE_LABEL.color;
  for (const { region, text } of SITE_LABEL.sites) {
    const centroid = regionCentroid(map, region);
    if (!centroid) continue;
    const { x, y } = hexToPixel(centroid);
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  }
  ctx.restore();
}
