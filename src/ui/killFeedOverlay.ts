// Pass E m4 — kill feed as a small semi-transparent overlay anchored
// bottom-left inside #canvas-area. Pre-m4 the feed lived in the right
// sidePanel which was crowded after the cards-this-round section landed.
// Uses the existing `killFeedLines(state)` formatter — pure read.

import type { GameState } from '../game/types.ts';
import { killFeedLines } from './killFeed.ts';

export function renderKillFeedOverlay(host: HTMLElement, state: GameState): void {
  const lines = killFeedLines(state, 10);
  if (lines.length === 0) {
    host.innerHTML = '';
    return;
  }
  const rows = lines.map((l) => `<div class="kfo-line">${l}</div>`).join('');
  host.innerHTML = rows;
  // Auto-scroll to bottom so the newest line is visible.
  host.scrollTop = host.scrollHeight;
}
