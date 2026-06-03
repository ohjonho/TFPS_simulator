// Pass A1 / Pass H1 — Floating attributes panel.
//
// H1 rewrite: shows the 5 visible aggregate attributes by default; a native
// <details> element exposes the 10 hidden sub-attributes that combat/vision
// math actually reads. This matches the H1 thesis — manager-game players see
// a legible 5-bar scout card, not a 14-row spreadsheet, with the depth a
// click away.
//
// Rendered as an overlay in the top-right corner of the canvas area, visible
// in both planning and resolution phases. Driven by the same hover state that
// the side panel uses. Empty when no unit is hovered.
//
// Re-used by draftPanel.ts (per pool card). For that use case the visible-5
// block is enough; the sub-attribute details are skipped to keep cards
// compact.

import type { Attributes, Unit, VisibleAttributes } from '../game/types.ts';
import { aggregateVisible } from '../game/attributes.ts';

// HTML-escape strings stuffed into title="..." tooltips.
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// --- Visible aggregates (the 5 primaries the player actually sees) -------

type VisibleRow = {
  key: keyof VisibleAttributes;
  label: string;
  desc: string;
};

const VISIBLE_ROWS: readonly VisibleRow[] = [
  { key: 'mechanics', label: 'Mechanics',
    desc: 'Shooting skill: aim + headshot + reflexes + weapon affinity.' },
  { key: 'gameSense', label: 'Game Sense',
    desc: 'What they see + understand: vision cone width + map knowledge.' },
  { key: 'discipline', label: 'Discipline',
    desc: 'How reliably they follow assigned strategy / directives (gates strategy compliance — H3).' },
  { key: 'improvisation', label: 'Improvisation',
    desc: 'Quality of off-plan play + composure under pressure (last-alive / damaged).' },
  { key: 'leadership', label: 'Leadership',
    desc: 'Team coordination — a hit-rate bonus when a teammate just fired (trading); high Leadership converts trades.' },
];

// Active visible aggregates. H1 wired Mechanics + Game Sense + Improvisation;
// H3 wired Discipline (Tenacity → per-tick compliance roll); Phase 3 wired
// Leadership (Comms → team-trade HR bonus, see combat.ts / config.COMMS). All
// five aggregates are now live.
const V0_VISIBLE: ReadonlySet<keyof VisibleAttributes> = new Set([
  'mechanics', 'gameSense', 'discipline', 'improvisation', 'leadership',
]);

// --- Hidden sub-attributes (the 10 that feed combat/vision math) ---------

type SubRow = {
  key: keyof Attributes;
  label: string;
  desc: string;
  group: 'Mechanics' | 'Game Sense' | 'Discipline' | 'Improvisation' | 'Leadership';
  active: boolean;        // false → still inert (planned), renders greyed
};

const SUB_ROWS: readonly SubRow[] = [
  // Mechanics
  { key: 'aim',            label: 'Aim',             group: 'Mechanics',     active: true,
    desc: 'Base hit-rate modifier across all weapons (±8pp at the tails).' },
  { key: 'headshot',       label: 'Headshot',        group: 'Mechanics',     active: true,
    desc: 'Modifies headshot chance on every hit (±8pp at the tails).' },
  { key: 'reflexes',       label: 'Reflexes',        group: 'Mechanics',     active: true,
    desc: 'Scales the First Shot trait magnitude (0.6× to 1.4× at the tails).' },
  { key: 'weaponAffinity', label: 'Weapon Affinity', group: 'Mechanics',     active: true,
    desc: 'HR modifier applied regardless of weapon (±4pp at the tails).' },
  // Game Sense
  { key: 'vision',         label: 'Vision',          group: 'Game Sense',    active: true,
    desc: 'Widens the vision cone (±20°) and adjusts team ghost duration.' },
  { key: 'mapIQ',          label: 'Map IQ',          group: 'Game Sense',    active: true,
    desc: 'Cover-seek search radius when settling into hold (0–2 hex).' },
  // Discipline
  { key: 'tenacity',       label: 'Tenacity',        group: 'Discipline',    active: true,
    desc: 'Drives the per-tick strategy-compliance roll (high Tenacity = unit stays on plan under fire).' },
  // Improvisation
  { key: 'composure',      label: 'Composure',       group: 'Improvisation', active: true,
    desc: 'Scales last-alive HR/HS bonus (with or without Clutch trait).' },
  { key: 'adaptability',   label: 'Adaptability',    group: 'Improvisation', active: false,
    desc: 'Quality of off-plan fallback decisions — planned, not yet wired.' },
  // Leadership
  { key: 'comms',          label: 'Comms',           group: 'Leadership',    active: true,
    desc: 'Team-trade hit-rate bonus when a teammate fired recently (±12pp at the tails); high Leadership converts trades.' },
];

// --- HTML helpers --------------------------------------------------------

function visibleBarsHtml(attrs: VisibleAttributes): string {
  return VISIBLE_ROWS.map(({ key, label, desc }) => {
    const val = attrs[key];
    const active = V0_VISIBLE.has(key);
    const cls = active ? 'attr-row v0 visible' : 'attr-row v1 visible';
    const badge = active ? '' : '<span class="v1-tag">planned</span>';
    const pct = Math.max(0, Math.min(100, val));
    return `
      <div class="${cls}" title="${esc(desc)}">
        <span class="attr-label">${label}${badge}</span>
        <span class="attr-bar"><span class="attr-fill" style="width:${pct}%"></span></span>
        <span class="attr-val">${val}</span>
      </div>
    `;
  }).join('');
}

function subBarsHtml(attrs: Attributes): string {
  return SUB_ROWS.map(({ key, label, desc, active }) => {
    const val = attrs[key];
    const cls = active ? 'attr-row v0 sub' : 'attr-row v1 sub';
    const badge = active ? '' : '<span class="v1-tag">planned</span>';
    const pct = Math.max(0, Math.min(100, val));
    return `
      <div class="${cls}" title="${esc(desc)}">
        <span class="attr-label">${label}${badge}</span>
        <span class="attr-bar"><span class="attr-fill" style="width:${pct}%"></span></span>
        <span class="attr-val">${val}</span>
      </div>
    `;
  }).join('');
}

// Public — draftPanel reuses this for compact pool cards (no sub-detail).
export function visibleAttributeBlockHtml(attrs: Attributes): string {
  return `<div class="attributes visible-attrs">${visibleBarsHtml(aggregateVisible(attrs))}</div>`;
}

export function renderAttributesPanel(
  host: HTMLElement,
  unit: Unit | null,
  pinned = false,
): void {
  if (!unit) {
    // Empty state: hide the panel entirely so it doesn't block clicks on the
    // canvas behind it.
    host.innerHTML = '';
    host.classList.add('empty');
    host.classList.remove('pinned');
    return;
  }
  host.classList.remove('empty');
  host.classList.toggle('pinned', pinned);
  const pinHint = pinned ? '<span class="attr-panel-pin">📌 pinned</span>' : '';
  const visible = aggregateVisible(unit.attributes);
  host.innerHTML = `
    <div class="attr-panel-header">
      <span class="attr-panel-id">${unit.id}</span>
      <span class="attr-panel-meta">${unit.team} · ${unit.weapon} · ${unit.role}</span>
      ${pinHint}
    </div>
    <div class="attributes visible-attrs">${visibleBarsHtml(visible)}</div>
    <details class="attr-details">
      <summary>Details (sub-attributes)</summary>
      <div class="attributes sub-attrs">${subBarsHtml(unit.attributes)}</div>
    </details>
  `;
}
