// Top bar: phase indicator + tick counter + Begin Round / Reset buttons.
// In Pass 2 this is the planning↔resolution flow control. Round score and
// half indicator come in Pass 6.

import type { GameState } from '../game/types.ts';
import { pathIsBlank } from '../game/path.ts';

export type TopBarCallbacks = {
  onBeginRound: () => void;
  onResetToPlanning: () => void;
};

export function renderTopBar(host: HTMLElement, state: GameState, cb: TopBarCallbacks): void {
  host.innerHTML = '';

  const phaseLabel = document.createElement('span');
  phaseLabel.className = 'phase-label';
  phaseLabel.textContent =
    state.phase === 'planning' ? 'Planning' : `Resolution — tick ${state.tick}`;

  const spacer = document.createElement('div');
  spacer.className = 'spacer';

  host.appendChild(phaseLabel);
  host.appendChild(spacer);

  if (state.phase === 'planning') {
    const drawn = countDrawnPaths(state);
    const total = state.units.length;
    const status = document.createElement('span');
    status.className = 'path-status';
    status.textContent = `${drawn} / ${total} paths drawn`;
    host.appendChild(status);

    const begin = document.createElement('button');
    begin.className = 'btn-primary';
    begin.textContent = 'Begin Round';
    begin.disabled = drawn < total;
    begin.addEventListener('click', cb.onBeginRound);
    host.appendChild(begin);
  } else {
    const back = document.createElement('button');
    back.textContent = 'Back to Planning';
    back.addEventListener('click', cb.onResetToPlanning);
    host.appendChild(back);
  }
}

function countDrawnPaths(state: GameState): number {
  let n = 0;
  for (const u of state.units) {
    const p = state.paths[u.id];
    if (p && !pathIsBlank(p)) n++;
  }
  return n;
}
