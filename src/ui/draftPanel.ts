// Pass G — Draft phase UI. Rendered as an overlay inside the canvas area
// while `phase === 'draft'`. Shows the pool + pick progress + roster previews +
// auto-draft toggle + Confirm button (enabled once every slot is filled).
// Two shapes, detected from the pick order: the standard alternating snake
// (player + AI pick 5 each) and the campaign's player-only draft (build your own
// squad, 5 of 8 — the opponent column is hidden, labels go season-flavoured).
//
// Renders via plain HTML/CSS (no canvas). Pure-DOM module that takes a
// callback bundle from main.ts to commit picks / toggle auto / finalize.

import type { DraftState, GameState, Team, Unit, Weapon } from '../game/types.ts';
import { visibleAttributeBlockHtml } from './attributesPanel.ts';
import { traitSpan } from './traitChip.ts';
import { roleChip, heroChip } from './unitMetaChip.ts';
import { draftCardLegendHtml } from './draftHelpModal.ts';

// H3.fix3 — full weapon name for the draft scouting view (single-letter
// glyph forces memorization across 8 unknown units). Canvas overlay still
// uses WEAPON_GLYPH for the spatial hex marker.
const WEAPON_NAME: Record<Weapon, string> = {
  shotgun: 'Shotgun',
  rifle: 'Rifle',
  sniper: 'Sniper',
};

export type DraftPanelCallbacks = {
  onPick: (unitId: string) => void;
  onAutoToggle: () => void;
  onConfirm: () => void;
};

const PANEL_ID = 'draft-panel';

export function renderDraftPanel(
  host: HTMLElement,
  state: GameState,
  cb: DraftPanelCallbacks,
): void {
  // Remove any prior panel (cheap; one re-render per pick).
  const existing = host.querySelector(`#${PANEL_ID}`);
  if (existing) existing.remove();

  if (state.phase !== 'draft' || !state.draft) return;

  const panel = document.createElement('div');
  panel.id = PANEL_ID;

  const draft = state.draft;
  const pickedIds = new Set(draft.picks.map((p) => p.unitId));
  const pickerByUnit = new Map(draft.picks.map((p) => [p.unitId, p.pickerTeam]));
  const playerTeam = state.playerTeam;
  const aiTeam: Team = playerTeam === 'defenders' ? 'attackers' : 'defenders';
  const finished = draft.currentPickIdx >= draft.pickOrder.length;
  const currentPicker = finished ? null : draft.pickOrder[draft.currentPickIdx];
  const playerTurn = currentPicker === playerTeam;
  // Campaign (season) draft is player-only — every pick slot is the player's, no
  // AI co-draft. Detected from the pick order so this UI needs no extra wiring.
  const playerOnly = draft.pickOrder.every((t) => t === playerTeam);
  const remaining = draft.pickOrder.length - draft.currentPickIdx;
  const confirmLabel = finished
    ? (playerOnly ? 'Confirm — enter the season' : 'Confirm — Begin Match')
    : (playerOnly ? `Pick ${remaining} more` : 'Complete the draft to continue');

  panel.innerHTML = `
    <div class="draft-header">
      <h2>${playerOnly ? 'Draft your squad' : 'Draft'}</h2>
      <div class="draft-progress">${progressHtml(draft, playerTeam)}</div>
      <div class="draft-status">${statusLine(finished, playerTurn, draft.autoMode, playerOnly)}</div>
      <label class="draft-auto-toggle">
        <input type="checkbox" data-auto ${draft.autoMode ? 'checked' : ''} />
        Auto-draft my picks
      </label>
    </div>
    ${playerOnly ? `<details class="draft-legend" open><summary>How to read a player card</summary>${draftCardLegendHtml()}</details>` : ''}
    <div class="draft-body">
      <div class="draft-pool">${poolHtml(draft, pickerByUnit, playerTeam, aiTeam)}</div>
      <div class="draft-rosters">
        <div class="draft-roster you">
          <h3>${playerOnly ? 'Your squad' : 'You'} (${playerTeam === 'defenders' ? 'DEF' : 'ATK'})</h3>
          ${rosterHtml(draft, playerTeam, 'You')}
        </div>
        ${playerOnly ? '' : `
        <div class="draft-roster opp">
          <h3>Opponent (${aiTeam === 'defenders' ? 'DEF' : 'ATK'})</h3>
          ${rosterHtml(draft, aiTeam, 'Opp')}
        </div>`}
      </div>
    </div>
    <div class="draft-footer">
      <button data-confirm class="btn-primary" ${finished ? '' : 'disabled'}>
        ${confirmLabel}
      </button>
    </div>
  `;

  host.appendChild(panel);

  // Pool card clicks → if player's turn AND card not yet picked, commit.
  panel.querySelectorAll<HTMLElement>('[data-unit-id]').forEach((el) => {
    const id = el.getAttribute('data-unit-id');
    if (!id) return;
    if (pickedIds.has(id)) return;
    if (!playerTurn) return;
    el.addEventListener('click', () => cb.onPick(id));
  });

  // Auto-draft toggle.
  const auto = panel.querySelector<HTMLInputElement>('input[data-auto]');
  if (auto) auto.addEventListener('change', () => cb.onAutoToggle());

  // Confirm.
  const confirm = panel.querySelector<HTMLButtonElement>('button[data-confirm]');
  if (confirm) confirm.addEventListener('click', () => cb.onConfirm());
}

function progressHtml(draft: DraftState, playerTeam: Team): string {
  return draft.pickOrder
    .map((t, i) => {
      const isPlayer = t === playerTeam;
      const done = i < draft.currentPickIdx;
      const current = i === draft.currentPickIdx;
      const cls = [
        'pick-slot',
        isPlayer ? 'you' : 'opp',
        done ? 'done' : '',
        current ? 'current' : '',
      ].filter(Boolean).join(' ');
      const label = isPlayer ? 'Y' : 'O';
      return `<span class="${cls}">${i + 1}<sub>${label}</sub></span>`;
    })
    .join('');
}

function statusLine(finished: boolean, playerTurn: boolean, autoMode: boolean, playerOnly = false): string {
  if (finished) {
    return playerOnly
      ? '<strong>Squad set</strong> — review and confirm to start the season.'
      : '<strong>Draft complete</strong> — review and confirm.';
  }
  if (autoMode) return 'Auto-drafting…';
  if (playerOnly) return '<strong>Your pick.</strong> Click a unit to add them to your squad.';
  return playerTurn
    ? '<strong>Your pick.</strong> Click any unit in the pool.'
    : 'Opponent is picking…';
}

function poolHtml(
  draft: DraftState,
  pickerByUnit: Map<string, Team>,
  playerTeam: Team,
  _aiTeam: Team,
): string {
  return draft.pool
    .map((u) => poolCardHtml(u, pickerByUnit.get(u.id) ?? null, playerTeam))
    .join('');
}

function poolCardHtml(u: Unit, pickedBy: Team | null, playerTeam: Team): string {
  const picked = pickedBy !== null;
  const byYou = pickedBy === playerTeam;
  const tag = !picked
    ? ''
    : byYou
      ? '<span class="pick-tag you">YOU</span>'
      : '<span class="pick-tag opp">OPP</span>';
  const cls = ['pool-card', picked ? 'picked' : 'available'].join(' ');
  // Trait chips with hover tooltips. v0.29.0 — 2 tactical traits + 1 personality.
  const tacticalChipsHtml = u.tacticalTraits.map((t) => traitSpan(t, 'skill')).join(' ');
  const personalityChipHtml = traitSpan(u.personality, 'personality');
  // Attribute bars: Pass H1 — pool cards show the 5 visible aggregates only,
  // matching the H1 thesis (manager sees the legible scout card, not the
  // sub-attribute breakdown). The floating attributes panel still exposes
  // the 10 hidden subs via its Details toggle.
  const inner = visibleAttributeBlockHtml(u.attributes).replace(/^<div class="attributes visible-attrs">|<\/div>$/g, '');
  return `
    <div class="${cls}" data-unit-id="${u.id}">
      <div class="pool-card-head">
        <span class="pool-card-name">${u.name}</span>
        <span class="pool-card-weapon weapon-${u.weapon}">${WEAPON_NAME[u.weapon]}</span>
        ${roleChip(u.role)}
        ${heroChip(u.hero)}
        ${tag}
      </div>
      <div class="pool-card-traits">
        ${tacticalChipsHtml}
        ${personalityChipHtml}
      </div>
      <div class="pool-card-attrs">${inner}</div>
    </div>
  `;
}

function rosterHtml(draft: DraftState, team: Team, _label: 'You' | 'Opp'): string {
  const rows = draft.picks
    .filter((p) => p.pickerTeam === team)
    .map((p, i) => {
      const u = draft.pool.find((x) => x.id === p.unitId);
      if (!u) return '';
      // H2.2 — trait chips with tooltips here too; visually consistent with
      // the pool cards above + the side-panel roster.
      // H3.fix3 — full weapon name + role/hero as chips with tooltips.
      return `<li>${i + 1}. <strong>${u.name}</strong> <span class="pool-card-weapon weapon-${u.weapon}">${WEAPON_NAME[u.weapon]}</span> ${roleChip(u.role)} ${heroChip(u.hero)} · ${u.tacticalTraits.map((t) => traitSpan(t, 'skill')).join(' ')} ${traitSpan(u.personality, 'personality')}</li>`;
    })
    .join('');
  return `<ul>${rows || '<li class="empty">—</li>'}</ul>`;
}
