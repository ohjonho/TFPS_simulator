// Pass A1 — Floating attributes panel.
// Rendered as an overlay in the top-right corner of the canvas area, visible
// in both planning and resolution phases. Driven by the same hover state that
// the side panel uses (canvas hover, plus planning-phase roster hover added in
// sidePanel.ts). Empty when no unit is hovered.
//
// Lives separately from sidePanel.ts so it can render in planning phase where
// the side panel is occupied by the roster / strategy / cards UI.

import type { Attributes, Unit } from '../game/types.ts';

// v0-active attribute keys (combat/vision integration in A2-A4 + F2 wired
// headshot/reflexes/positioning). Everything not in this set renders
// greyed with a "v1" tag.
const V0_ATTRIBUTES: ReadonlySet<string> = new Set([
  'aim', 'headshot', 'reflexes',
  'rifleHandling', 'shotgunHandling', 'sniperHandling',
  'awareness', 'positioning', 'clutch',
]);

// Display order matches the four design-doc categories so the UI mirrors §3.
// `desc` is a one-sentence hover tooltip explaining what each attribute affects
// (rendered via the native `title` attribute).
const ATTR_ROWS: ReadonlyArray<{
  key: string;
  label: string;
  getter: (a: Attributes) => number;
  desc: string;
}> = [
  // Mechanical
  { key: 'aim',             label: 'Aim',              getter: (a) => a.aim,
    desc: 'Base hit-rate modifier across all weapons (±8pp at the tails).' },
  { key: 'headshot',        label: 'Headshot',         getter: (a) => a.headshot,
    desc: 'Modifies headshot chance on every hit (±8pp at the tails).' },
  { key: 'reflexes',        label: 'Reflexes',         getter: (a) => a.reflexes,
    desc: 'Scales the First Shot trait magnitude (0.6× to 1.4× at the tails).' },
  { key: 'sprayControl',    label: 'Spray Control',    getter: (a) => a.sprayControl,
    desc: 'v1+ — HR retention past tick 5 of a sustained engagement.' },
  { key: 'rifleHandling',   label: 'Rifle Handling',   getter: (a) => a.rifleHandling,
    desc: 'HR modifier applied only when this unit is using a rifle.' },
  { key: 'shotgunHandling', label: 'Shotgun Handling', getter: (a) => a.shotgunHandling,
    desc: 'HR modifier applied only when this unit is using a shotgun.' },
  { key: 'sniperHandling',  label: 'Sniper Handling',  getter: (a) => a.sniperHandling,
    desc: 'HR modifier applied only when this unit is using a sniper.' },
  // Game Sense
  { key: 'awareness',       label: 'Awareness',        getter: (a) => a.awareness,
    desc: 'Widens the vision cone (±20°) and extends/shortens team ghost markers.' },
  { key: 'positioning',     label: 'Positioning',      getter: (a) => a.positioning,
    desc: 'Widens the cover-seek search radius when settling into hold (0–2 hex).' },
  { key: 'mapIQ',           label: 'Map IQ',           getter: (a) => a.mapIQ,
    desc: 'v1 — overall map familiarity (rotation timing, plant-zone awareness).' },
  // Mental
  { key: 'clutch',          label: 'Clutch',           getter: (a) => a.clutch,
    desc: 'Scales the last-alive HR/HS bonus, with or without the Clutch trait.' },
  { key: 'composure',       label: 'Composure',        getter: (a) => a.composure,
    desc: 'v1 — reduces the early-tick HR penalty after dying the previous round.' },
  { key: 'confidence',      label: 'Confidence',       getter: (a) => a.confidence,
    desc: 'v1 — scales effective aggression up or down from the role baseline.' },
  // Team
  { key: 'teamwork',        label: 'Teamwork',         getter: (a) => a.teamwork,
    desc: 'v1 — Trader-trait magnitude plus a small default ally-fired-recently bonus.' },
  { key: 'discipline',      label: 'Discipline',       getter: (a) => a.discipline,
    desc: 'v1 — likelihood of sticking to assigned region vs peeling off for opportunities.' },
  { key: 'communication',   label: 'Communication',    getter: (a) => a.communication,
    desc: 'v1 — cone bonus shared with allies within 5 hexes (info-sharing).' },
];

// HTML-escape a tooltip string before stuffing it into `title="..."`.
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function attributeBarsHtml(attrs: Attributes): string {
  return ATTR_ROWS.map(({ key, label, getter, desc }) => {
    const val = getter(attrs);
    const active = V0_ATTRIBUTES.has(key);
    const cls = active ? 'attr-row v0' : 'attr-row v1';
    const badge = active ? '' : '<span class="v1-tag">v1</span>';
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
  const pinHint = pinned
    ? '<span class="attr-panel-pin">📌 pinned</span>'
    : '';
  host.innerHTML = `
    <div class="attr-panel-header">
      <span class="attr-panel-id">${unit.id}</span>
      <span class="attr-panel-meta">${unit.team} · ${unit.weapon} · ${unit.role}</span>
      ${pinHint}
    </div>
    <div class="attributes">${attributeBarsHtml(unit.attributes)}</div>
  `;
}
