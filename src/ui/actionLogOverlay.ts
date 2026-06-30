// Pass E m4 — Action Log: a semi-transparent overlay anchored top-left inside
// #canvas-area, showing the round's shots / plants / defuses / detonations.
// Always rendered as a titled panel (with a placeholder before the round runs)
// so it reads as a clear, visible box — including during the tutorial. Uses the
// `actionLogLines(state)` formatter — pure read.

import type { GameState } from '../game/types.ts';
import { actionLogLines } from './actionLog.ts';

export function renderActionLogOverlay(host: HTMLElement, state: GameState): void {
  // During the draft the canvas (and this overlay) is covered by the draft panel.
  if (state.phase === 'draft') { host.innerHTML = ''; return; }
  const lines = actionLogLines(state, 10);
  const body = lines.length
    ? lines.map((l) => `<div class="al-line">${l}</div>`).join('')
    : '<div class="al-empty">Shots, plants and kills appear here once the round runs.</div>';
  host.innerHTML = `<div class="al-title">Action Log</div><div class="al-body">${body}</div>`;
  // Auto-scroll to bottom so the newest line is visible.
  const bodyEl = host.querySelector<HTMLElement>('.al-body');
  if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
}
