// H3.fix3 — shared helpers for rendering role + hero (origin) as styled
// chips with native `title` tooltips. Mirrors the traitChip.ts pattern so
// the planning roster, draft pool cards, draft roster previews, and the
// resolution unit-info DL all surface the same hover affordance.
//
// Native HTML `title` is consistent with the trait chips (same delay,
// same browser-native popover) — good enough until the help-glossary
// expansion replaces these with richer popovers.

import type { Hero, Role } from '../game/types.ts';
import { ROLE_DESCRIPTIONS, HERO_DESCRIPTIONS } from '../game/config.ts';

// HTML-escape strings stuffed into title="..." attributes.
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// `<span class="meta-chip role" title="…">Vanguard</span>` — sized + colored
// alongside trait chips so a roster line reads as identity, not data.
export function roleChip(role: Role): string {
  const tip = esc(`${role} — ${ROLE_DESCRIPTIONS[role]}`);
  return `<span class="meta-chip role" title="${tip}">${role}</span>`;
}

// `<span class="meta-chip hero" title="…">Angelic</span>` — heroes are
// passive ability tags after the H3.3 card-system collapse; the tooltip
// is the only place the player learns what the hero *does*.
export function heroChip(hero: Hero): string {
  const tip = esc(`${hero} — ${HERO_DESCRIPTIONS[hero]}`);
  return `<span class="meta-chip hero" title="${tip}">${hero}</span>`;
}
