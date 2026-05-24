// Thin fire-lines between each engaged shooter and its target. A dev-aid for
// Pass 4 legibility; Pass 9 replaces it with proper shot-flash + damage popups.

import type { GameState } from '../game/types.ts';
import { hexToPixel } from '../game/hex.ts';

export function drawEngagements(ctx: CanvasRenderingContext2D, state: GameState): void {
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  for (const u of state.units) {
    if (u.state !== 'alive') continue;
    const ai = state.ai[u.id];
    if (!ai || ai.mode !== 'engaged' || !ai.firingTarget) continue;
    const target = state.units.find((t) => t.id === ai.firingTarget);
    if (!target || target.state !== 'alive') continue;
    const a = hexToPixel(u.pos);
    const b = hexToPixel(target.pos);
    ctx.strokeStyle = u.team === 'defenders' ? 'rgba(147,197,253,0.8)' : 'rgba(252,165,165,0.8)';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}
