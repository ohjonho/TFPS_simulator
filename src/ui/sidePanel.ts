// Side panel: hovered-unit details plus per-unit path actions during planning.

import type { GameState, Unit } from '../game/types.ts';
import { UNIT_DEFAULTS } from '../game/config.ts';

export type SidePanelCallbacks = {
  onClearPath: (unitId: string) => void;
};

export function renderSidePanel(
  host: HTMLElement,
  state: GameState,
  hoveredUnit: Unit | null,
  cb: SidePanelCallbacks,
): void {
  if (!hoveredUnit) {
    host.innerHTML = `
      <h2>Unit Info</h2>
      <p class="hint">Hover a unit on the map.</p>
    `;
    return;
  }

  const path = state.paths[hoveredUnit.id];
  const pathLen = path ? Math.max(0, path.hexes.length - 1) : 0;
  const wpCount = path ? Object.keys(path.waypoints).length : 0;

  host.innerHTML = `
    <h2>Unit Info</h2>
    <dl class="unit-stats">
      <dt>ID</dt><dd>${hoveredUnit.id}</dd>
      <dt>Team</dt><dd>${hoveredUnit.team}</dd>
      <dt>Loadout</dt><dd>${hoveredUnit.weapon}</dd>
      <dt>HP</dt><dd>${hoveredUnit.hp} / ${UNIT_DEFAULTS.maxHp}</dd>
      <dt>Skill trait</dt><dd>—</dd>
      <dt>Behavioral trait</dt><dd>—</dd>
      <dt>Path</dt><dd>${pathLen} hex${pathLen === 1 ? '' : 'es'} • ${wpCount} waypoint${wpCount === 1 ? '' : 's'}</dd>
    </dl>
    ${state.phase === 'planning' && pathLen > 0
      ? `<button class="side-action" data-act="clear">Clear ${hoveredUnit.id} path</button>`
      : ''}
  `;

  const clearBtn = host.querySelector<HTMLButtonElement>('[data-act="clear"]');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => cb.onClearPath(hoveredUnit.id));
  }
}
