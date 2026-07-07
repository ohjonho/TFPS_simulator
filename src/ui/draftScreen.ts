// The season draft — a BG3/DOS2-style roster browser for picking 5 of the 12
// authored Origins. Left: the 12 as a list. Centre: the selected character's big
// portrait. Right: a spoiler-free intro + zoomed stat bars + their hero's ability.
// Top: your 5 picks + confirm. Pure UI over the existing draft state machine
// (commit/undo/finalize via the shared opts); reuses ui/characterVisual for faces.

import type { GameState, Unit } from '../game/types.ts';
import { castVisual, silhouetteSvg } from './characterVisual.ts';
import { characterById, draftIntro } from '../game/story/characters.ts';
import { aggregateVisible } from '../game/attributes.ts';
import { HERO_DESCRIPTIONS, ROLE_DESCRIPTIONS, PERSONALITIES, DRAFT } from '../game/config.ts';
import { recruitLegendHtml, WEAPON_BLURB, AGG_BLURB } from './draftHelpModal.ts';

export interface DraftScreenOpts {
  onPick: (unitId: string) => void;
  onUnpick: (unitId: string) => void;
  onConfirm: () => void;
  onAutoToggle?: () => void; // unused here; keeps the opts shape shared with draftPanel
}

let selectedId: string | null = null;
let legendOpen = false; // the "how to read a recruit" strip — collapsed by default (the draft walkthrough teaches first-time); an openable reference thereafter

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
// Escape for a title="…" attribute (also handles the double-quote esc() skips).
function attr(s: string): string { return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

const AGG_LABEL: [string, string][] = [
  ['mechanics', 'Mechanics'], ['gameSense', 'Game Sense'], ['discipline', 'Discipline'],
  ['improvisation', 'Improvisation'], ['leadership', 'Leadership'],
];
// Zoomed: the ~35–70 band fills the bar, so spiky profiles read at a glance.
function barPct(v: number): number { return Math.max(4, Math.min(100, ((v - 35) / 35) * 100)); }

const cidOf = (u: Unit): string => u.characterId ?? u.id;

export function renderDraftScreen(host: HTMLElement, state: GameState, opts: DraftScreenOpts): void {
  const draft = state.draft;
  if (!draft) return;
  const pool = draft.pool;
  const pickedIds = new Set(draft.picks.map((p) => p.unitId));
  const picks = DRAFT.picksPerTeam;
  if (!selectedId || !pool.some((u) => u.id === selectedId)) {
    selectedId = pool.find((u) => !pickedIds.has(u.id))?.id ?? pool[0]?.id ?? null;
  }
  const sel = pool.find((u) => u.id === selectedId) ?? null;
  const remaining = picks - draft.picks.length;

  const row = (u: Unit): string => {
    const { tint } = castVisual(cidOf(u));
    const cls = `ds-row${u.id === selectedId ? ' ds-active' : ''}${pickedIds.has(u.id) ? ' ds-picked' : ''}`;
    return `<button class="${cls}" data-row="${u.id}" type="button">
      <span class="ds-thumb" style="--tint:${tint}">${silhouetteSvg(tint)}</span>
      <span class="ds-row-info"><span class="ds-row-name">${esc(u.name)}</span>
        <span class="ds-row-sub">${esc(u.role)} · ${esc(u.weapon)}</span></span>
      ${pickedIds.has(u.id) ? '<span class="ds-check">✓</span>' : ''}
    </button>`;
  };

  const slots = (): string => {
    const filled = draft.picks.map((p) => {
      const u = pool.find((x) => x.id === p.unitId);
      const tint = u ? castVisual(cidOf(u)).tint : '#555';
      return `<button class="ds-slot ds-slot-filled" data-remove="${p.unitId}" type="button" title="Remove">
        <span class="ds-slot-sil" style="--tint:${tint}">${silhouetteSvg(tint)}</span>
        <span class="ds-slot-name">${esc(u?.name ?? '')}</span></button>`;
    });
    while (filled.length < picks) filled.push('<div class="ds-slot ds-slot-empty"><span>+</span></div>');
    return filled.join('');
  };

  const detail = (u: Unit): string => {
    const cid = cidOf(u);
    const { tint } = castVisual(cid);
    const agg = aggregateVisible(u.attributes) as unknown as Record<string, number>;
    const bars = AGG_LABEL.map(([k, label]) =>
      `<div class="ds-stat"><span class="ds-stat-l" title="${attr(`${label} — ${AGG_BLURB[k] ?? ''}`)}">${label}</span>
        <span class="ds-stat-bar"><span class="ds-stat-fill" style="width:${barPct(agg[k] ?? 50)}%;background:${tint}"></span></span></div>`).join('');
    const btn = pickedIds.has(u.id)
      ? `<button class="ds-draftbtn ds-remove" data-draft="${u.id}" type="button">Remove from squad</button>`
      : remaining > 0
        ? `<button class="ds-draftbtn" data-draft="${u.id}" type="button">Draft ${esc(u.name)}</button>`
        : '<button class="ds-draftbtn" disabled type="button">Squad full</button>';
    return `<div class="ds-detail-in">
      <div class="ds-chips"><span class="ds-chip" title="${attr(`${u.role} — ${ROLE_DESCRIPTIONS[u.role] ?? ''}`)}">${esc(u.role)}</span><span class="ds-chip" title="${attr(`${u.hero} — ${HERO_DESCRIPTIONS[u.hero] ?? ''}`)}">${esc(u.hero)}</span>
        <span class="ds-chip" title="${attr(WEAPON_BLURB[u.weapon] ?? '')}">${esc(u.weapon)}</span>${u.personality ? `<span class="ds-chip" title="${attr(`${u.personality} — ${PERSONALITIES[u.personality]?.description ?? ''}`)}">${esc(u.personality)}</span>` : ''}</div>
      <p class="ds-intro">${esc(draftIntro(cid) || characterById(cid)?.bio || '')}</p>
      <div class="ds-stats">${bars}</div>
      <p class="ds-hero"><b>${esc(u.hero)}</b> — ${esc(HERO_DESCRIPTIONS[u.hero] ?? '')}</p>
      ${btn}
    </div>`;
  };

  const centerTint = sel ? castVisual(cidOf(sel)).tint : '#555';
  // Render into an appended #draft-panel overlay (NOT host.innerHTML) so we don't
  // wipe the canvas that lives in the same canvasArea — and so the phase-change
  // teardown in renderDraftPanel (which removes #draft-panel) actually finds us.
  host.querySelector('#draft-panel')?.remove();
  const panel = document.createElement('div');
  panel.id = 'draft-panel';
  panel.innerHTML = `<div class="ds-root">
    <div class="ds-picktray">
      <div class="ds-tray-head">Your squad — <b>${draft.picks.length}/${picks}</b></div>
      <div class="ds-slots">${slots()}</div>
      <button class="ds-confirm" data-confirm ${draft.picks.length < picks ? 'disabled' : ''} type="button">Confirm &mdash; enter the season</button>
    </div>
    <details class="ds-legend"${legendOpen ? ' open' : ''}>
      <summary>How to read a recruit</summary>
      ${recruitLegendHtml()}
    </details>
    <div class="ds-body">
      <div class="ds-list">${pool.map(row).join('')}</div>
      <div class="ds-center">${sel ? `<div class="ds-bigportrait" style="--tint:${centerTint}">${silhouetteSvg(centerTint)}</div><div class="ds-bigname">${esc(sel.name)}</div>` : ''}</div>
      <div class="ds-detail">${sel ? detail(sel) : ''}</div>
    </div>
  </div>`;
  host.appendChild(panel);

  panel.querySelectorAll<HTMLButtonElement>('[data-row]').forEach((b) => b.addEventListener('click', () => {
    selectedId = b.getAttribute('data-row');
    renderDraftScreen(host, state, opts);
  }));
  panel.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    opts.onUnpick(b.getAttribute('data-remove') ?? '');
  }));
  const draftBtn = panel.querySelector<HTMLButtonElement>('[data-draft]');
  draftBtn?.addEventListener('click', () => {
    const id = draftBtn.getAttribute('data-draft') ?? '';
    if (pickedIds.has(id)) opts.onUnpick(id);
    else if (remaining > 0) opts.onPick(id);
  });
  panel.querySelector<HTMLButtonElement>('[data-confirm]')?.addEventListener('click', () => opts.onConfirm());
  // Preserve the legend's open/closed state across the board's frequent re-renders.
  const legendEl = panel.querySelector<HTMLDetailsElement>('.ds-legend');
  legendEl?.addEventListener('toggle', () => { legendOpen = legendEl.open; });
}
