// Pass E m4 — dedicated left sidebar for the card UI. Pre-m4 the hand,
// targeting hints, and "Cards this round" all lived in the right sidePanel,
// crowding the roster + strategy menu. Now:
//   planning  → deck/discard counts + hand of 3 cards + skip button
//                (+ targeting hint when a hex/role card is pending)
//   resolution → "Cards this round" with both teams' picks + duration timers
//
// Card titles are bold (`.c-name` weight 700) for at-a-glance scan.

import type { ActiveCardEffect, GameState } from '../game/types.ts';
import { cardById } from '../game/cardData.ts';

export type CardPanelCallbacks = {
  // Pick (or clear with null) a card from the player's hand.
  onPickCard: (defId: string | null) => void;
  // Currently-selected card def id (null = no pick); mirrors main.ts UI state.
  selectedCardId: string | null;
  // True while a hex/role-targeted card is selected but not yet targeted.
  // Highlights the active card pill with the targeting hint.
  cardTargetingPending: boolean;
};

export function renderCardPanel(
  host: HTMLElement,
  state: GameState,
  cb: CardPanelCallbacks,
): void {
  if (state.phase === 'planning') {
    host.innerHTML = planningHtml(state, cb.selectedCardId, cb.cardTargetingPending);
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

// --- Planning phase: card hand + skip button ------------------------------

function planningHtml(state: GameState, selectedCardId: string | null, targetingPending: boolean): string {
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
