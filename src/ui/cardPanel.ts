// Pass E m4 / E3 / H3.4 — left-side "planning actions" panel.
//
// H3.4 — card hand + cards-this-round sections removed (card system deleted).
// The panel now carries only the strategy menu. File name is historical;
// kept for layout-grid stability. A future rename to `strategyPanel.ts`
// would be cosmetic.

import type { GameState, Side } from '../game/types.ts';
import { strategyById } from '../game/strategies.ts';
import { availableStrategies } from '../game/traits.ts';
import { liveTeamStatsHtml } from './unitStatsPanel.ts';
import { scoutReportHtml } from './scoutPanel.ts';

export type CardPanelCallbacks = {
  onPickStrategy: (id: string) => void;
  onPickVariant: (idx: number) => void;
};

export function renderCardPanel(
  host: HTMLElement,
  state: GameState,
  cb: CardPanelCallbacks,
): void {
  // During the match (resolution) the left gutter shows YOUR team's live unit
  // stats; empty during draft (the draft overlay covers the screen).
  if (state.phase === 'resolution') {
    host.innerHTML = liveTeamStatsHtml(state, state.playerTeam, 'Your Team');
    return;
  }
  if (state.phase !== 'planning') {
    host.innerHTML = '';
    return;
  }

  const playerSide = state.teamSide[state.playerTeam];
  host.innerHTML = scoutReportHtml(state) + strategyMenuHtml(state, playerSide);

  host.querySelectorAll<HTMLButtonElement>('button[data-strategy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-strategy');
      if (id) cb.onPickStrategy(id);
    });
  });
  host.querySelectorAll<HTMLButtonElement>('button[data-variant]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.getAttribute('data-variant');
      if (v !== null) cb.onPickVariant(parseInt(v, 10));
    });
  });
}

// --- Planning phase: strategy menu ----------------------------------------

const VARIANT_LETTERS = ['A', 'B', 'C', 'D'];
function variantLabel(_strat: ReturnType<typeof strategyById>, idx: number): string {
  return VARIANT_LETTERS[idx] ?? `V${idx + 1}`;
}

function strategyMenuHtml(state: GameState, side: Side): string {
  // H3 — show baseline + roster-unlocked strategies only.
  const teamUnits = state.units.filter((u) => u.team === state.playerTeam);
  const options = availableStrategies(teamUnits, side, state.map);
  const sel = state.playerStrategy;
  const variantChoice = state.playerVariantChoice;
  const items = options.map((s) => {
    const isSelected = sel === s.id;
    const cls = isSelected ? 'strategy selected' : 'strategy';
    let variantRow = '';
    if (isSelected && s.variants.length > 1) {
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
