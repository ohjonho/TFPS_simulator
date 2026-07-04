// The cast's visual identity — one registry the VN scene runner and the draft
// screen both read for portraits + display names. Portraits are tinted-silhouette
// PLACEHOLDERS for now (one `tint` per face; swap `silhouetteSvg` for real art
// later). Display names are usually static but flag-gated where a character stays
// a mystery: Remi shows "???" until he introduces himself (storyFlags['remi-met']).

import { AUTHORED_ORIGINS, characterById } from '../game/story/characters.ts';

export interface CastVisual {
  id: string;
  name: string;
  tint: string;      // silhouette placeholder colour
  reveal?: string;   // a story flag; while unset, the name shows as "???"
}

// NPCs + guest faces (not draftable Origins).
const NPC_CAST: Record<string, CastVisual> = {
  sam:      { id: 'sam',      name: 'Sam',      tint: 'hsl(28 48% 54%)' },
  remi:     { id: 'remi',     name: 'Remi',     tint: 'hsl(142 46% 48%)', reveal: 'remi-met' },
  nova:     { id: 'nova',     name: 'Nova',     tint: 'hsl(322 54% 60%)' },   // Echo's big-league sister
  starling: { id: 'starling', name: 'Starling', tint: 'hsl(202 52% 56%)' },   // Yahyo's ex-Girlaxy teammate
  caster:   { id: 'caster',   name: 'Caster',   tint: 'hsl(0 0% 58%)' },
};

// The 12 Origins get evenly-spaced hues (stable, guaranteed-distinct placeholders).
const ORIGIN_TINT: Record<string, string> = {};
AUTHORED_ORIGINS.forEach((c, i) => {
  ORIGIN_TINT[c.id] = `hsl(${Math.round((i / AUTHORED_ORIGINS.length) * 360)} 44% 52%)`;
});

export function castVisual(id: string): CastVisual {
  if (NPC_CAST[id]) return NPC_CAST[id];
  const def = characterById(id);
  if (def) return { id, name: def.username, tint: ORIGIN_TINT[id] ?? 'hsl(0 0% 55%)' };
  return { id, name: id, tint: 'hsl(0 0% 55%)' };
}

// The name to render in the box — "???" while a reveal flag is unset.
export function displayName(id: string, flags: Record<string, string> = {}): string {
  const v = castVisual(id);
  return v.reveal && !flags[v.reveal] ? '???' : v.name;
}

// One or two placeholder initials for the silhouette (before real portraits).
export function castInitials(id: string, flags: Record<string, string> = {}): string {
  const name = displayName(id, flags);
  if (name === '???') return '?';
  return name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
}

// A generic head-and-shoulders silhouette in the given tint — the placeholder
// portrait every consumer drops in until real art lands.
export function silhouetteSvg(tint: string): string {
  return `<svg viewBox="0 0 100 120" class="cv-sil" preserveAspectRatio="xMidYMax meet" aria-hidden="true">`
    + `<rect width="100" height="120" fill="${tint}" opacity="0.16"/>`
    + `<circle cx="50" cy="42" r="22" fill="${tint}"/>`
    + `<path d="M14 120 C14 87 32 73 50 73 C68 73 86 87 86 120 Z" fill="${tint}"/>`
    + `</svg>`;
}
