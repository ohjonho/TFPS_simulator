// Phase 4 — per-player morale (0–100, neutral 50). Stored on SeasonState.morale
// (Record by unit id, like focusFreshness/playMastery; absent ⇒ MORALE.start).
// Events move it (the `morale` effect op), match results ripple it, and at the
// extremes it nudges Composure into the match build. Pure logic; never reads the
// match RNG, so a fresh season (everyone at 50 → 0 nudge) is byte-identical.

import type { Unit } from './types.ts';
import { MORALE } from './config.ts';

export type MoraleMap = Record<string, number>;

const clamp100 = (n: number): number => Math.max(0, Math.min(100, n));

export function moraleOf(morale: MoraleMap, unitId: string): number {
  return morale[unitId] ?? MORALE.start;
}

export function teamMorale(morale: MoraleMap, roster: readonly Unit[]): number {
  if (roster.length === 0) return MORALE.start;
  return Math.round(roster.reduce((s, u) => s + moraleOf(morale, u.id), 0) / roster.length);
}

// Player-facing label (no raw number — the no-numbers principle).
export function moraleLabel(m: number): string {
  if (m >= 70) return 'fired up';
  if (m >= 58) return 'confident';
  if (m >= 43) return 'steady';
  if (m >= 30) return 'shaky';
  return 'rattled';
}

// Composure nudge from a unit's morale (±MORALE.composureMax; 0 at neutral 50).
export function moraleComposureDelta(m: number): number {
  const raw = Math.round((m - MORALE.start) * MORALE.composurePerPoint);
  return Math.max(-MORALE.composureMax, Math.min(MORALE.composureMax, raw));
}

// Apply each unit's morale → Composure on a roster (before placement). Default
// morale (50) → no change. Pure.
export function applyMoraleComposure(roster: readonly Unit[], morale: MoraleMap): Unit[] {
  return roster.map((u) => {
    const d = moraleComposureDelta(moraleOf(morale, u.id));
    if (d === 0) return u;
    return { ...u, attributes: { ...u.attributes, composure: clamp100(u.attributes.composure + d) } };
  });
}

// Match-result ripple: a win lifts the whole room, a loss stings. Pure — returns a
// new morale map. (MVP/choker-specific swings can layer on later.)
export function applyMatchMorale(morale: MoraleMap, roster: readonly Unit[], playerWon: boolean): MoraleMap {
  const delta = playerWon ? MORALE.winDelta : MORALE.lossDelta;
  const next: MoraleMap = { ...morale };
  for (const u of roster) next[u.id] = clamp100(moraleOf(morale, u.id) + delta);
  return next;
}

// Adjust morale by an event effect (team or a single subject). Pure.
export function adjustMorale(morale: MoraleMap, roster: readonly Unit[], scope: 'team' | 'self', subjectId: string | null, amount: number): MoraleMap {
  const next: MoraleMap = { ...morale };
  if (scope === 'self') {
    if (subjectId) next[subjectId] = clamp100(moraleOf(morale, subjectId) + amount);
  } else {
    for (const u of roster) next[u.id] = clamp100(moraleOf(morale, u.id) + amount);
  }
  return next;
}
