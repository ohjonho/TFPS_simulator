// Side panel content depends on phase:
//   planning   → roster summary for both teams + strategy menu (player's side)
//   resolution → hovered-unit info
// Kill feed is always shown below.

import type { GameState, Side, Unit } from '../game/types.ts';
import { UNIT_DEFAULTS } from '../game/config.ts';
import { killFeedLines } from './killFeed.ts';
import { strategiesFor, strategyById } from '../game/strategies.ts';
import { cardById } from '../game/cardData.ts';

export type SidePanelCallbacks = {
  onPickStrategy: (id: string) => void;
  // Pass C — A/B variant pick for multi-variant strategies (Hold/Stack on
  // defender, Execute/Rush on attacker). idx maps to strategy.variants[idx]
  // (0 = A, 1 = B in current authoring).
  onPickVariant: (idx: number) => void;
  // Pass 8: toggle card selection. Pass null to clear. Returns true if the
  // selection actually changed (so the caller knows to re-render the preview).
  onPickCard: (defId: string | null) => void;
  // Currently-selected card def id for the player (null = no card). Read so
  // the UI can highlight the active card; lives in main.ts UI state, not state.
  selectedCardId: string | null;
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
    // Pass C — A/B sub-row buttons (only present under the currently-selected
    // multi-variant strategy).
    host.querySelectorAll<HTMLButtonElement>('button[data-variant]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-variant');
        if (v !== null) cb.onPickVariant(parseInt(v, 10));
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

// Pass 8 — hand UI. Cards are OPTIONAL: the player can leave it unselected and
// hit Begin Round. Targeted cards (Mark Target / Setup Play / Hold the Line /
// Adapt) auto-target in v0 (see main.ts.onPickCard); a future milestone adds
// the click-target flow on the canvas.
function cardMenuHtml(state: GameState, selectedCardId: string | null): string {
  const teamDeck = state.cards[state.playerTeam];
  const hand = teamDeck.hand;
  // Pass C — deck/discard counts so the player sees the cycle (cards
  // discard on round-end, deck reshuffles from discard when empty).
  const cycleLine =
    `<div class="card-cycle">Deck: ${teamDeck.deck.length} · Discard: ${teamDeck.discard.length}</div>`;
  if (hand.length === 0) {
    return `<h3>Card (optional)</h3>${cycleLine}<p class="hint">Hand empty.</p>`;
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
    ${cycleLine}
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
      <dt>Aggr</dt><dd>${unit.modifiers.aggression}</dd>
      <dt>Hex</dt><dd>(${col}, ${row})</dd>
    </dl>
  `;
  // Pass A1: attributes panel renders in its own floating overlay (top-right
  // of canvas area), driven by the same hover state used here. See
  // src/ui/attributesPanel.ts.
}

function killFeedHtml(state: GameState): string {
  const lines = killFeedLines(state);
  if (lines.length === 0) return `<h2>Kill Feed</h2><p class="hint">No combat yet.</p>`;
  const rows = lines.map((l) => `<div class="feed-line">${l}</div>`).join('');
  return `<h2>Kill Feed</h2><div class="kill-feed">${rows}</div>`;
}
