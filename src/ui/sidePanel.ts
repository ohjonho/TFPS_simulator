// Side panel content depends on phase:
//   planning   → roster summary for both teams + strategy menu (player's side)
//   resolution → hovered-unit info
// Kill feed is always shown below.

import type { GameState, Side, Unit } from '../game/types.ts';
import { UNIT_DEFAULTS } from '../game/config.ts';
import { killFeedLines } from './killFeed.ts';
import { strategiesFor } from '../game/strategies.ts';
import { cardById } from '../game/cardData.ts';

export type SidePanelCallbacks = {
  onPickStrategy: (id: string) => void;
  // Pass 8: toggle card selection. Pass null to clear. Returns true if the
  // selection actually changed (so the caller knows to re-render the preview).
  onPickCard: (defId: string | null) => void;
  // Currently-selected card def id for the player (null = no card). Read so
  // the UI can highlight the active card; lives in main.ts UI state, not state.
  selectedCardId: string | null;
};

export function renderSidePanel(
  host: HTMLElement,
  hoveredUnit: Unit | null,
  state: GameState,
  cb: SidePanelCallbacks,
): void {
  const main =
    state.phase === 'planning' ? planningHtml(state, cb.selectedCardId) : unitInfoOrHint(hoveredUnit, state);
  host.innerHTML = main + killFeedHtml(state);

  if (state.phase === 'planning') {
    host.querySelectorAll<HTMLButtonElement>('button[data-strategy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-strategy');
        if (id) cb.onPickStrategy(id);
      });
    });
    host.querySelectorAll<HTMLButtonElement>('button[data-card]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-card');
        // Card buttons toggle: clicking the active card again clears it.
        cb.onPickCard(id === cb.selectedCardId ? null : id);
      });
    });
    const skipBtn = host.querySelector<HTMLButtonElement>('button[data-card-skip]');
    if (skipBtn) skipBtn.addEventListener('click', () => cb.onPickCard(null));
  }
}

// --- Planning phase: rosters + strategy menu ------------------------------

function planningHtml(state: GameState, selectedCardId: string | null): string {
  const playerSide = state.teamSide[state.playerTeam];
  const opp = state.playerTeam === 'defenders' ? 'attackers' : 'defenders';
  return `
    <h2>Planning — Round ${state.round}</h2>
    ${rosterHtml(state, state.playerTeam, 'You')}
    ${rosterHtml(state, opp, 'Opponent')}
    ${strategyMenuHtml(state, playerSide)}
    ${cardMenuHtml(state, selectedCardId)}
  `;
}

function rosterHtml(state: GameState, team: 'defenders' | 'attackers', label: string): string {
  const teamUnits = state.units.filter((u) => u.team === team);
  const side = state.teamSide[team] === 'defender' ? 'DEF' : 'ATK';
  const rows = teamUnits.map((u) => {
    const off = u.modifiers.offPosition ? ' <span class="warn">⚠off-pos</span>' : '';
    const dead = u.state === 'dead' ? ' DEAD' : '';
    return `<li><strong>${u.id}</strong> ${u.weapon} · ${u.role}${off} · ${u.skillTrait ?? '—'}/${u.behavioralTrait ?? '—'} · HP ${u.hp}/${UNIT_DEFAULTS.maxHp}${dead}</li>`;
  }).join('');
  return `<div class="roster"><h3>${label} (${side})</h3><ul>${rows}</ul></div>`;
}

function strategyMenuHtml(state: GameState, side: Side): string {
  const options = strategiesFor(side, state.map);
  const sel = state.playerStrategy;
  const items = options.map((s) => {
    const cls = sel === s.id ? 'strategy selected' : 'strategy';
    return `<button class="${cls}" data-strategy="${s.id}">
      <div class="s-name">${s.name}</div>
      <div class="s-desc">${s.description}</div>
    </button>`;
  }).join('');
  return `<h3>Strategy (${side}) — required</h3><div class="strategy-menu">${items}</div>`;
}

// Pass 8 — hand UI. Cards are OPTIONAL: the player can leave it unselected and
// hit Begin Round. Targeted cards (Mark Target / Setup Play / Hold the Line /
// Adapt) auto-target in v0 (see main.ts.onPickCard); a future milestone adds
// the click-target flow on the canvas.
function cardMenuHtml(state: GameState, selectedCardId: string | null): string {
  const hand = state.cards[state.playerTeam].hand;
  if (hand.length === 0) {
    return `<h3>Card (optional)</h3><p class="hint">Hand empty.</p>`;
  }
  const items = hand.map((c) => {
    const def = cardById(c.defId);
    if (!def) return '';
    const cls = selectedCardId === c.defId ? 'card selected' : 'card';
    const sourceLabel = `From: ${def.source} (${c.contributor})`;
    const targetingNote = def.targeting === 'none'
      ? ''
      : ` <span class="warn">(auto-targets)</span>`;
    return `<button class="${cls}" data-card="${c.defId}">
      <div class="c-name">${def.name}${targetingNote}</div>
      <div class="c-source">${sourceLabel}</div>
      <div class="c-desc">${def.description}</div>
    </button>`;
  }).join('');
  const skipCls = selectedCardId === null ? 'card-skip selected' : 'card-skip';
  return `
    <h3>Card (optional)</h3>
    <div class="card-menu">${items}</div>
    <button class="${skipCls}" data-card-skip>Skip card this round</button>
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
      <dt>Aggr / Hand</dt><dd>${unit.modifiers.aggression} / ${unit.modifiers.weaponHandling}</dd>
      <dt>Hex</dt><dd>(${col}, ${row})</dd>
    </dl>
  `;
}

function killFeedHtml(state: GameState): string {
  const lines = killFeedLines(state);
  if (lines.length === 0) return `<h2>Kill Feed</h2><p class="hint">No combat yet.</p>`;
  const rows = lines.map((l) => `<div class="feed-line">${l}</div>`).join('');
  return `<h2>Kill Feed</h2><div class="kill-feed">${rows}</div>`;
}
