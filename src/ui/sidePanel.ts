// Right-side panel:
//   planning   → roster summary for both teams (+ seed input in randomize mode)
//   resolution → hovered-unit info
//
// Pass E3 — the strategy menu moved to the left panel (cardPanel.ts) so this
// side is purely "who's playing + who am I looking at." Card hand + kill
// feed also moved out (cardPanel + killFeedOverlay).

import type { GameState, Unit } from '../game/types.ts';
import { UNIT_DEFAULTS } from '../game/config.ts';
import { traitSpan } from './traitChip.ts';

export type SidePanelCallbacks = {
  // Pass A1: hover-driven attributes panel. Roster `<li>` items emit hover
  // events here so the floating attributes panel can pop in planning phase
  // (canvas hover already covers resolution + planning units on the map).
  onHoverUnit: (unitId: string | null) => void;
  // Pass E m5 — Randomize Units: regenerate the match with a new (or typed)
  // seed. Only visible in randomize mode.
  onRegenerate: (seed: number) => void;
};

export function renderSidePanel(
  host: HTMLElement,
  hoveredUnit: Unit | null,
  state: GameState,
  cb: SidePanelCallbacks,
): void {
  // Pass G — the right sidebar stays empty during the draft phase; the draft
  // panel overlay covers the canvas area and surfaces its own roster preview.
  if (state.phase === 'draft') {
    host.innerHTML = '<h2>Draft</h2><p class="hint">Pool of 8 — pick 3 to build your team.</p>';
    return;
  }

  host.innerHTML =
    state.phase === 'planning'
      ? planningHtml(state)
      : unitInfoOrHint(hoveredUnit, state);

  if (state.phase === 'planning') {
    // Pass E m5 — Randomize seed input + Regenerate. Only rendered in
    // randomize mode (see planningHtml).
    const regenBtn = host.querySelector<HTMLButtonElement>('button[data-regenerate]');
    const seedInput = host.querySelector<HTMLInputElement>('input[data-seed]');
    if (regenBtn && seedInput) {
      const submit = () => {
        const v = parseInt(seedInput.value, 10);
        if (Number.isFinite(v) && v >= 0) cb.onRegenerate(v);
      };
      regenBtn.addEventListener('click', submit);
      seedInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') submit();
      });
    }
  }

  // Pass A1: roster-row hover → drive the floating attributes panel. Works in
  // both phases (the planning roster lives in this panel; in resolution the
  // selector finds nothing and the listeners are simply absent).
  host.querySelectorAll<HTMLElement>('li[data-roster-unit]').forEach((li) => {
    const id = li.getAttribute('data-roster-unit');
    if (!id) return;
    li.addEventListener('mouseenter', () => cb.onHoverUnit(id));
    li.addEventListener('mouseleave', () => cb.onHoverUnit(null));
  });
}

// --- Planning phase: rosters ----------------------------------------------

function planningHtml(state: GameState): string {
  const opp = state.playerTeam === 'defenders' ? 'attackers' : 'defenders';
  return `
    <h2>Planning — Round ${state.round}</h2>
    ${seedRowHtml(state)}
    ${rosterHtml(state, state.playerTeam, 'You')}
    ${rosterHtml(state, opp, 'Opponent')}
    <p class="hint hint-drag">Tip: drag your units to reposition within the spawn zone.</p>
  `;
}

function rosterHtml(state: GameState, team: 'defenders' | 'attackers', label: string): string {
  const teamUnits = state.units.filter((u) => u.team === team);
  const side = state.teamSide[team] === 'defender' ? 'DEF' : 'ATK';
  // H2.1 — two-row layout per unit: top row = identity (id + weapon + role
  // + HP + off-pos warning); bottom row = three trait chips visually
  // grouped. Avoids the run-on single-line mess that 3 traits + role + HP
  // + warnings created.
  const rows = teamUnits.map((u) => {
    const off = u.modifiers.offPosition ? '<span class="warn" title="Off preferred role (−10pp HR)">⚠off-pos</span>' : '';
    const dead = u.state === 'dead' ? '<span class="warn">DEAD</span>' : '';
    return `
      <li data-roster-unit="${u.id}">
        <div class="ru-line1">
          <strong>${u.id}</strong>
          <span class="ru-weapon">${u.weapon}</span>
          <span class="ru-role">${u.role}</span>
          <span class="ru-hp">HP ${u.hp}/${UNIT_DEFAULTS.maxHp}</span>
          ${off}${dead}
        </div>
        <div class="ru-line2">
          ${traitSpan(u.skillTrait, 'skill')}
          ${traitSpan(u.behavioralTrait, 'beh')}
          ${traitSpan(u.personalityTrait, 'personality')}
        </div>
      </li>`;
  }).join('');
  return `<div class="roster"><h3>${label} (${side})</h3><ul>${rows}</ul></div>`;
}

// Pass E m5 / Pass G — discreet seed display + input + Regenerate, only
// visible in Draft mode. The text input is pre-filled with the current seed
// so the player can copy/paste it; submitting (Enter or Regenerate) rebuilds
// the match (and re-rolls the pool) with that exact seed for reproducibility.
function seedRowHtml(state: GameState): string {
  if (state.matchMode !== 'draft') return '';
  return `
    <div class="seed-row">
      <label>Seed:
        <input type="number" data-seed value="${state.seed}" min="0" step="1" />
      </label>
      <button data-regenerate>Regenerate</button>
    </div>
  `;
}

// --- Resolution phase: hovered-unit info ----------------------------------

function unitInfoOrHint(unit: Unit | null, state: GameState): string {
  if (!unit) return `<h2>Unit Info</h2><p class="hint">Hover a unit on the map.</p>`;
  const { col, row } = unit.pos;
  const ai = state.ai[unit.id];
  const mode = unit.state === 'dead' ? 'dead' : ai?.mode ?? '—';
  const tgt = ai?.firingTarget ? ` → ${ai.firingTarget}` : '';
  const roleLabel = unit.modifiers.offPosition ? `${unit.role} (off-pos)` : unit.role;
  // Pass E2 — show team identity AND current side so a "defenders" unit on
  // the attacker side reads "defenders (ATK)" instead of just "defenders".
  const sideTag = state.teamSide[unit.team] === 'defender' ? 'DEF' : 'ATK';
  return `
    <h2>Unit Info</h2>
    <dl class="unit-stats">
      <dt>ID</dt><dd>${unit.id}</dd>
      <dt>Team</dt><dd>${unit.team} <span class="muted">(${sideTag})</span></dd>
      <dt>Loadout</dt><dd>${unit.weapon}</dd>
      <dt>HP</dt><dd>${unit.hp} / ${UNIT_DEFAULTS.maxHp}</dd>
      <dt>AI mode</dt><dd>${mode}${tgt}</dd>
      <dt>Role</dt><dd>${roleLabel}</dd>
      <dt>Hero</dt><dd>${unit.hero}</dd>
      <dt>Skill trait</dt><dd>${traitSpan(unit.skillTrait, 'skill')}</dd>
      <dt>Behavioral</dt><dd>${traitSpan(unit.behavioralTrait, 'beh')}</dd>
      <dt>Personality</dt><dd>${traitSpan(unit.personalityTrait, 'personality')}</dd>
      <dt>Aggr</dt><dd>${unit.modifiers.aggression}</dd>
      <dt>Hex</dt><dd>(${col}, ${row})</dd>
    </dl>
  `;
}
