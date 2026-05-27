// Pass G — Draft phase UI. Rendered as an overlay inside the canvas area
// while `phase === 'draft'`. Shows the 8-unit pool + pick progress + roster
// previews + auto-draft toggle + Confirm button (once all 6 picks are in).
//
// Renders via plain HTML/CSS (no canvas). Pure-DOM module that takes a
// callback bundle from main.ts to commit picks / toggle auto / finalize.

import type { DraftState, GameState, Team, Unit } from '../game/types.ts';
import { WEAPON_GLYPH } from '../game/config.ts';
import { visibleAttributeBlockHtml } from './attributesPanel.ts';

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

  panel.innerHTML = `
    <div class="draft-header">
      <h2>Draft</h2>
      <div class="draft-progress">${progressHtml(draft, playerTeam)}</div>
      <div class="draft-status">${statusLine(finished, playerTurn, draft.autoMode)}</div>
      <label class="draft-auto-toggle">
        <input type="checkbox" data-auto ${draft.autoMode ? 'checked' : ''} />
        Auto-draft my picks
      </label>
    </div>
    <div class="draft-body">
      <div class="draft-pool">${poolHtml(draft, pickerByUnit, playerTeam, aiTeam)}</div>
      <div class="draft-rosters">
        <div class="draft-roster you">
          <h3>You (${playerTeam === 'defenders' ? 'DEF' : 'ATK'})</h3>
          ${rosterHtml(draft, playerTeam, 'You')}
        </div>
        <div class="draft-roster opp">
          <h3>Opponent (${aiTeam === 'defenders' ? 'DEF' : 'ATK'})</h3>
          ${rosterHtml(draft, aiTeam, 'Opp')}
        </div>
      </div>
    </div>
    <div class="draft-footer">
      <button data-confirm class="btn-primary" ${finished ? '' : 'disabled'}>
        ${finished ? 'Confirm — Begin Match' : 'Pick all 6 to continue'}
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

function statusLine(finished: boolean, playerTurn: boolean, autoMode: boolean): string {
  if (finished) return '<strong>Draft complete</strong> — review and confirm.';
  if (autoMode) return 'Auto-drafting…';
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
  const glyph = WEAPON_GLYPH[u.weapon];
  const picked = pickedBy !== null;
  const byYou = pickedBy === playerTeam;
  const tag = !picked
    ? ''
    : byYou
      ? '<span class="pick-tag you">YOU</span>'
      : '<span class="pick-tag opp">OPP</span>';
  const cls = ['pool-card', picked ? 'picked' : 'available'].join(' ');
  const skill = u.skillTrait ?? '—';
  const beh = u.behavioralTrait ?? '—';
  const personality = u.personalityTrait ?? '—';
  // Attribute bars: Pass H1 — pool cards show the 5 visible aggregates only,
  // matching the H1 thesis (manager sees the legible scout card, not the
  // sub-attribute breakdown). The floating attributes panel still exposes
  // the 10 hidden subs via its Details toggle.
  const inner = visibleAttributeBlockHtml(u.attributes).replace(/^<div class="attributes visible-attrs">|<\/div>$/g, '');
  return `
    <div class="${cls}" data-unit-id="${u.id}">
      <div class="pool-card-head">
        <span class="weapon-glyph weapon-${u.weapon}">${glyph}</span>
        <span class="pool-card-id">${u.id}</span>
        <span class="pool-card-role">${u.role}</span>
        <span class="pool-card-hero">${u.hero}</span>
        ${tag}
      </div>
      <div class="pool-card-traits">
        <span class="trait skill">${skill}</span>
        <span class="trait beh">${beh}</span>
        <span class="trait personality">${personality}</span>
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
      const glyph = WEAPON_GLYPH[u.weapon];
      return `<li>${i + 1}. <span class="weapon-glyph weapon-${u.weapon}">${glyph}</span> ${u.role} · ${u.skillTrait ?? '—'}/${u.behavioralTrait ?? '—'}/${u.personalityTrait ?? '—'}</li>`;
    })
    .join('');
  return `<ul>${rows || '<li class="empty">—</li>'}</ul>`;
}
