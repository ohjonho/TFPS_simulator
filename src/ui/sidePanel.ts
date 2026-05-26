// Right-side panel:
//   planning   → roster summary for both teams + strategy menu
//   resolution → hovered-unit info
// Card hand + cards-this-round live in src/ui/cardPanel.ts (Pass E m4).
// Kill feed lives in src/ui/killFeedOverlay.ts (Pass E m4).

import type { GameState, Side, Unit } from '../game/types.ts';
import { UNIT_DEFAULTS } from '../game/config.ts';
import { strategiesFor, strategyById } from '../game/strategies.ts';

export type SidePanelCallbacks = {
  onPickStrategy: (id: string) => void;
  // Pass C — A/B variant pick for multi-variant strategies (Stack on
  // defender; Execute / Rush on attacker). idx maps to strategy.variants[idx]
  // (0 = A, 1 = B in current authoring).
  onPickVariant: (idx: number) => void;
  // Pass A1: hover-driven attributes panel. Roster `<li>` items emit hover
  // events here so the floating attributes panel can pop in planning phase
  // (canvas hover already covers resolution + planning units on the map).
  onHoverUnit: (unitId: string | null) => void;
};

export function renderSidePanel(
  host: HTMLElement,
  hoveredUnit: Unit | null,
  state: GameState,
  cb: SidePanelCallbacks,
): void {
  host.innerHTML =
    state.phase === 'planning'
      ? planningHtml(state)
      : unitInfoOrHint(hoveredUnit, state);

  if (state.phase === 'planning') {
    host.querySelectorAll<HTMLButtonElement>('button[data-strategy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-strategy');
        if (id) cb.onPickStrategy(id);
      });
    });
    // Pass C — A/B sub-row buttons (only present under the currently-selected
    // multi-variant strategy).
    host.querySelectorAll<HTMLButtonElement>('button[data-variant]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-variant');
        if (v !== null) cb.onPickVariant(parseInt(v, 10));
      });
    });
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

// --- Planning phase: rosters + strategy menu ------------------------------

function planningHtml(state: GameState): string {
  const playerSide = state.teamSide[state.playerTeam];
  const opp = state.playerTeam === 'defenders' ? 'attackers' : 'defenders';
  return `
    <h2>Planning — Round ${state.round}</h2>
    ${rosterHtml(state, state.playerTeam, 'You')}
    ${rosterHtml(state, opp, 'Opponent')}
    ${strategyMenuHtml(state, playerSide)}
  `;
}

function rosterHtml(state: GameState, team: 'defenders' | 'attackers', label: string): string {
  const teamUnits = state.units.filter((u) => u.team === team);
  const side = state.teamSide[team] === 'defender' ? 'DEF' : 'ATK';
  const rows = teamUnits.map((u) => {
    const off = u.modifiers.offPosition ? ' <span class="warn">⚠off-pos</span>' : '';
    const dead = u.state === 'dead' ? ' DEAD' : '';
    return `<li data-roster-unit="${u.id}"><strong>${u.id}</strong> ${u.weapon} · ${u.role}${off} · ${u.skillTrait ?? '—'}/${u.behavioralTrait ?? '—'} · HP ${u.hp}/${UNIT_DEFAULTS.maxHp}${dead}</li>`;
  }).join('');
  return `<div class="roster"><h3>${label} (${side})</h3><ul>${rows}</ul></div>`;
}

// Pass C — variant labels are just the letter ("A", "B", …). Region nicknames
// were noisy; the label is contextual to the parent strategy already.
const VARIANT_LETTERS = ['A', 'B', 'C', 'D'];
function variantLabel(_strat: ReturnType<typeof strategyById>, idx: number): string {
  return VARIANT_LETTERS[idx] ?? `V${idx + 1}`;
}

function strategyMenuHtml(state: GameState, side: Side): string {
  const options = strategiesFor(side, state.map);
  const sel = state.playerStrategy;
  const variantChoice = state.playerVariantChoice;
  const items = options.map((s) => {
    const isSelected = sel === s.id;
    const cls = isSelected ? 'strategy selected' : 'strategy';
    let variantRow = '';
    if (isSelected && s.variants.length > 1) {
      // Pass C — sub-row for A/B variant pick. Only rendered for the
      // currently-selected multi-variant strategy.
      const buttons = s.variants.map((_v, idx) => {
        const vcls = variantChoice === idx ? 'variant selected' : 'variant';
        return `<button class="${vcls}" data-variant="${idx}">${variantLabel(s, idx)}</button>`;
      }).join('');
      const hint = variantChoice === null
        ? `<div class="variant-hint">Pick a site:</div>`
        : '';
      variantRow = `<div class="variant-row">${hint}${buttons}</div>`;
    }
    return `<button class="${cls}" data-strategy="${s.id}">
      <div class="s-name">${s.name}</div>
      <div class="s-desc">${s.description}</div>
    </button>${variantRow}`;
  }).join('');
  return `<h3>Strategy (${side}) — required</h3><div class="strategy-menu">${items}</div>`;
}

// --- Resolution phase: hovered-unit info ----------------------------------

function unitInfoOrHint(unit: Unit | null, state: GameState): string {
  if (!unit) return `<h2>Unit Info</h2><p class="hint">Hover a unit on the map.</p>`;
  const { col, row } = unit.pos;
  const ai = state.ai[unit.id];
  const mode = unit.state === 'dead' ? 'dead' : ai?.mode ?? '—';
  const tgt = ai?.firingTarget ? ` → ${ai.firingTarget}` : '';
  const roleLabel = unit.modifiers.offPosition ? `${unit.role} (off-pos)` : unit.role;
  return `
    <h2>Unit Info</h2>
    <dl class="unit-stats">
      <dt>ID</dt><dd>${unit.id}</dd>
      <dt>Team</dt><dd>${unit.team}</dd>
      <dt>Loadout</dt><dd>${unit.weapon}</dd>
      <dt>HP</dt><dd>${unit.hp} / ${UNIT_DEFAULTS.maxHp}</dd>
      <dt>AI mode</dt><dd>${mode}${tgt}</dd>
      <dt>Role</dt><dd>${roleLabel}</dd>
      <dt>Hero</dt><dd>${unit.hero}</dd>
      <dt>Skill trait</dt><dd>${unit.skillTrait ?? '—'}</dd>
      <dt>Behavioral</dt><dd>${unit.behavioralTrait ?? '—'}</dd>
      <dt>Aggr</dt><dd>${unit.modifiers.aggression}</dd>
      <dt>Hex</dt><dd>(${col}, ${row})</dd>
    </dl>
  `;
  // Pass A1: attributes panel renders in its own floating overlay (top-right
  // of canvas area), driven by the same hover state used here. See
  // src/ui/attributesPanel.ts.
}

// (Cards-this-round summary + kill feed moved to src/ui/cardPanel.ts and
// src/ui/killFeedOverlay.ts respectively in Pass E m4.)
