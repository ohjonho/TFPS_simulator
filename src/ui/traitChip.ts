// H2.2 — shared helper for rendering a trait name with a hover tooltip
// showing the trait's full description + sub-attribute bonuses + unlocks.
// Used in sidePanel roster, sidePanel unit info, draftPanel pool cards,
// draftPanel roster previews.
//
// The tooltip uses the native HTML `title` attribute (no JS state, no
// custom popover) — same approach the attribute bars use. Native title
// is unstyled but appears reliably on hover with a small delay; good
// enough for "what does Paranoid do?" pre-glossary checks.

import { TACTICAL_TRAITS, PERSONALITIES } from '../game/config.ts';

// HTML-escape strings going into title="..." attributes.
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// Format a single trait/personality tooltip. v0.29.0 — looks up the id in either
// the tactical-trait or personality registry. Returns a plain string for the
// `title` attribute (newlines render as line breaks in the native tooltip).
export function traitTooltip(traitId: string | null): string {
  if (!traitId) return '';
  const tac = TACTICAL_TRAITS[traitId];
  const per = PERSONALITIES[traitId];
  const def = tac ?? per;
  if (!def) return '';
  const kind = tac ? `tactical · ${tac.tier}` : 'personality';
  const lines: string[] = [`${traitId} (${kind})`, def.description];
  const bonusEntries = Object.entries(def.attrBonuses).filter(([, v]) => v !== 0);
  if (bonusEntries.length > 0) {
    const bonusStr = bonusEntries
      .map(([k, v]) => `${(v as number) > 0 ? '+' : ''}${v} ${k}`)
      .join(', ');
    lines.push(`Bonuses: ${bonusStr}`);
  }
  return lines.join('\n');
}

// Convenience: render a `<span class="trait <category>" title="...">Name</span>`
// for inline use. Falls back to "—" for null traits (no tooltip).
export function traitSpan(
  traitId: string | null,
  category: 'skill' | 'beh' | 'personality',
): string {
  if (!traitId) return `<span class="trait ${category}">—</span>`;
  const tip = esc(traitTooltip(traitId));
  return `<span class="trait ${category}" title="${tip}">${traitId}</span>`;
}
