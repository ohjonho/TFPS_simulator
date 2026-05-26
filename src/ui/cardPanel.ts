// Pass E m4 / E3 — left-side "planning actions" panel:
//   planning   → strategy menu (top) + card hand (bottom) + skip button
//   resolution → cards-this-round summary (both teams' picks + timers)
//
// Card titles are bold (.c-name font-weight 700) for at-a-glance scan.
// Pass E3 swapped the strategy menu in from the right sidePanel and moved
// the card hand DOWN to share this panel — gives the player a single column
// of "what am I committing this round" + frees the right panel for unit
// info / roster.

import type { ActiveCardEffect, GameState, Side } from '../game/types.ts';
import { cardById } from '../game/cardData.ts';
import { strategiesFor, strategyById } from '../game/strategies.ts';

export type CardPanelCallbacks = {
  // Pick (or clear with null) a card from the player's hand.
  onPickCard: (defId: string | null) => void;
  // Currently-selected card def id (null = no pick); mirrors main.ts UI state.
  selectedCardId: string | null;
  // True while a hex/role-targeted card is selected but not yet targeted.
  // Highlights the active card pill with the targeting hint.
  cardTargetingPending: boolean;
  // Pass E3 — strategy menu now lives in this panel.
  onPickStrategy: (id: string) => void;
  onPickVariant: (idx: number) => void;
};

export function renderCardPanel(
  host: HTMLElement,
  state: GameState,
  cb: CardPanelCallbacks,
): void {
  if (state.phase === 'planning') {
    const playerSide = state.teamSide[state.playerTeam];
    host.innerHTML =
      strategyMenuHtml(state, playerSide) +
      handHtml(state, cb.selectedCardId, cb.cardTargetingPending);

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
    host.querySelectorAll<HTMLButtonElement>('button[data-card]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-card');
        // Toggle: clicking the active card again clears it.
        cb.onPickCard(id === cb.selectedCardId ? null : id);
      });
    });
    const skipBtn = host.querySelector<HTMLButtonElement>('button[data-card-skip]');
    if (skipBtn) skipBtn.addEventListener('click', () => cb.onPickCard(null));
  } else {
    host.innerHTML = resolutionHtml(state);
  }
}

// --- Planning phase: strategy menu (top of panel) -------------------------

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

// --- Planning phase: card hand + skip button (below strategy) -------------

function handHtml(state: GameState, selectedCardId: string | null, targetingPending: boolean): string {
  const teamDeck = state.cards[state.playerTeam];
  const hand = teamDeck.hand;
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
    let targetingNote = '';
    if (def.targeting === 'hex') {
      targetingNote = selectedCardId === c.defId && targetingPending
        ? ` <span class="warn">— click a hex on the map</span>`
        : ` <span class="muted">(click to target)</span>`;
    } else if (def.targeting === 'role') {
      targetingNote = selectedCardId === c.defId && targetingPending
        ? ` <span class="warn">— pick a role</span>`
        : ` <span class="muted">(pick role)</span>`;
    }
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

// --- Resolution phase: "Cards this round" with duration timers -----------

function resolutionHtml(state: GameState): string {
  const teams: Array<{ team: 'defenders' | 'attackers'; label: string }> = [
    { team: state.playerTeam, label: 'You' },
    { team: state.playerTeam === 'defenders' ? 'attackers' : 'defenders', label: 'Opp' },
  ];
  const rows = teams.map(({ team, label }) => {
    const played = state.playedCard[team];
    if (!played) return `<div class="card-active none">${label}: <em>no card</em></div>`;
    const def = cardById(played.defId);
    if (!def) return '';
    const contributor = state.units.find((u) => u.id === played.contributor);
    const dead = contributor && contributor.state === 'dead' ? ' <span class="warn">contributor dead</span>' : '';
    const duration = durationLineFor(state, played.defId, team);
    return `<div class="card-active"><div class="c-name">«${def.name}»</div><div class="c-source">${label} · ${def.source} (${played.contributor})${duration}${dead}</div></div>`;
  }).join('');
  return `<h3>Cards this round</h3><div class="cards-active">${rows}</div>`;
}

function durationLineFor(state: GameState, defId: string, team: 'defenders' | 'attackers'): string {
  let match: ActiveCardEffect | null = null;
  for (const e of state.cardEffects) {
    if (e.team !== team) continue;
    if (defId === 'tactical_scan' && e.kind === 'tactical_scan') { match = e; break; }
    if (defId === 'setup_play' && e.kind === 'setup_play') { match = e; break; }
    if (defId === 'trade_window' && e.kind === 'mark_target' && e.expiresAtTick !== undefined) { match = e; break; }
  }
  if (match && 'expiresAtTick' in match && typeof match.expiresAtTick === 'number') {
    const remaining = Math.max(0, match.expiresAtTick - state.tick);
    if (remaining <= 0) return ` <span class="muted">— expired</span>`;
    return ` <span class="muted">— ${remaining}t left</span>`;
  }
  return ` <span class="muted">— round</span>`;
}
