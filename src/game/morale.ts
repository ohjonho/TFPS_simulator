// Phase 4 — per-player morale (0–100, neutral 50). Stored on SeasonState.morale
// (Record by unit id, like focusFreshness/playMastery; absent ⇒ MORALE.start).
// Events move it (the `morale` effect op), match results ripple it, and at the
// extremes it nudges Composure into the match build. Pure logic; never reads the
// match RNG, so a fresh season (everyone at 50 → 0 nudge) is byte-identical.

import type { Unit } from './types.ts';
import { MORALE } from './config.ts';
import {
  storyTagMoraleDeltaMult,
  storyTagMoraleFloor,
  storyTagWeeklyMoraleDrift,
} from './storyTags.ts';

export type MoraleMap = Record<string, number>;

const clamp100 = (n: number): number => Math.max(0, Math.min(100, n));
// Clamp with a per-unit floor (Found Family raises the minimum morale can sink to).
const clampFloor = (n: number, floor: number): number => Math.max(floor, Math.min(100, n));

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
  for (const u of roster) {
    // Story tags scale the swing (Short Fuse doubles a loss, Even Keel softens it)
    // and can raise the floor (Found Family). ×1 / floor 0 for untagged units.
    const d = Math.round(delta * storyTagMoraleDeltaMult(u, delta));
    next[u.id] = clampFloor(moraleOf(morale, u.id) + d, storyTagMoraleFloor(u));
  }
  return next;
}

// Adjust morale by an event effect (team or a single subject). Pure.
export function adjustMorale(morale: MoraleMap, roster: readonly Unit[], scope: 'team' | 'self', subjectId: string | null, amount: number): MoraleMap {
  const next: MoraleMap = { ...morale };
  const apply = (u: Unit): void => {
    const d = Math.round(amount * storyTagMoraleDeltaMult(u, amount));
    next[u.id] = clampFloor(moraleOf(morale, u.id) + d, storyTagMoraleFloor(u));
  };
  if (scope === 'self') {
    if (!subjectId) return next;
    const u = roster.find((x) => x.id === subjectId);
    if (u) apply(u);
    // Subject not on the roster (shouldn't happen for event subjects): legacy path.
    else next[subjectId] = clamp100(moraleOf(morale, subjectId) + amount);
  } else {
    for (const u of roster) apply(u);
  }
  return next;
}

// Standing-condition weekly drift (Homesick bleeds a little morale each week
// until resolved). Called from the week loop; inert (no change) without such
// tags, so it never touches a fresh/tagless season.
export function applyWeeklyMoraleDrift(morale: MoraleMap, roster: readonly Unit[]): MoraleMap {
  const next: MoraleMap = { ...morale };
  for (const u of roster) {
    const d = storyTagWeeklyMoraleDrift(u);
    if (d !== 0) next[u.id] = clampFloor(moraleOf(morale, u.id) + d, storyTagMoraleFloor(u));
  }
  return next;
}
