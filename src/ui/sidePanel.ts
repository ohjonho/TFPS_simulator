// Side panel content. Renders either a hover prompt or the hovered unit's
// placeholder info. Traits stay '—' until Pass 5.

import type { Unit } from '../game/types.ts';
import { UNIT_DEFAULTS } from '../game/config.ts';

export function renderSidePanel(host: HTMLElement, unit: Unit | null): void {
  if (!unit) {
    host.innerHTML = `
      <h2>Unit Info</h2>
      <p class="hint">Hover a unit on the map.</p>
    `;
    return;
  }
  host.innerHTML = `
    <h2>Unit Info</h2>
    <dl class="unit-stats">
      <dt>ID</dt><dd>${unit.id}</dd>
      <dt>Team</dt><dd>${unit.team}</dd>
      <dt>Loadout</dt><dd>${unit.weapon}</dd>
      <dt>HP</dt><dd>${unit.hp} / ${UNIT_DEFAULTS.maxHp}</dd>
      <dt>Skill trait</dt><dd>—</dd>
      <dt>Behavioral trait</dt><dd>—</dd>
    </dl>
  `;
}
