// Part 6 (season meta-loop) — training. Pure logic: each weekly session drills
// ONE of four tracks, raising the underlying SUB-attributes (the visible 5
// aggregates are read-outs of those subs, so they rise in step). The fifth
// aggregate, Improvisation, has no track — it's earned in matches (a later
// increment). Focus-one-player redistribution layers on top later.

import { TRAINING, MATCH_XP, MASTERY } from './config.ts';
import type { Attributes, Unit } from './types.ts';

export type TrainingTrack = 'aim' | 'tactics' | 'team' | 'setpieces';

// Each track + the subs it drills + which visible aggregate it feeds. Order is
// the display order on the training screen.
export const TRAINING_TRACKS: {
  id: TrainingTrack; name: string; aggregate: string; blurb: string; subs: (keyof Attributes)[];
}[] = [
  { id: 'aim',       name: 'Aim Training',       aggregate: 'Mechanics',  blurb: 'Sharper shooting — hit rate, headshots, reflexes.', subs: ['aim', 'headshot', 'reflexes', 'weaponAffinity'] },
  { id: 'tactics',   name: 'Strategy & Tactics', aggregate: 'Game Sense', blurb: 'Reads, rotations — and a deeper, bolder playbook.',   subs: ['vision', 'mapIQ'] },
  { id: 'team',      name: 'Team-Building',      aggregate: 'Leadership', blurb: 'Coordination and trades — the squad fights as one.', subs: ['comms'] },
  { id: 'setpieces', name: 'Set-Pieces',         aggregate: 'Discipline', blurb: 'Drill the plan so it holds under fire.',             subs: ['tenacity'] },
];

const clamp100 = (n: number): number => Math.max(0, Math.min(100, n));

// Per-unit focus freshness (0..1, default 1 = fully rested). Absent ⇒ fresh.
export type FocusFreshness = Record<string, number>;

export type TrainingResult = { roster: Unit[]; freshness: FocusFreshness };

// Apply one session. Whole-squad (focusId null) → +perSession to each sub in the
// track for everyone, and everyone's freshness recovers. Focused → the chosen
// unit gains ×(1 + bonus·freshness), the rest ×othersMult; the focused unit's
// freshness then drains, everyone else's recovers. Pure — returns a new roster +
// the updated freshness map.
export function applyTraining(
  roster: readonly Unit[],
  track: TrainingTrack,
  opts: { focusId?: string | null; freshness?: FocusFreshness } = {},
): TrainingResult {
  const fresh: FocusFreshness = { ...(opts.freshness ?? {}) };
  const def = TRAINING_TRACKS.find((t) => t.id === track);
  if (!def) return { roster: roster.map((u) => u), freshness: fresh };
  const g = TRAINING.perSession;
  const F = TRAINING.focus;
  const focusId = opts.focusId ?? null;

  const newRoster = roster.map((u) => {
    const mult = !focusId ? 1
      : u.id === focusId ? 1 + F.bonus * (fresh[u.id] ?? 1)
      : F.othersMult;
    const add = Math.round(g * mult);
    const a = { ...u.attributes } as unknown as Record<string, number>;
    for (const s of def.subs) a[s] = clamp100(a[s] + add);
    return { ...u, attributes: a as unknown as Attributes };
  });

  // Freshness: the focused unit drains; everyone else (incl. on a squad session) recovers.
  for (const u of roster) {
    fresh[u.id] = focusId && u.id === focusId
      ? Math.max(0, (fresh[u.id] ?? 1) - F.decay)
      : Math.min(1, (fresh[u.id] ?? 1) + F.recover);
  }
  return { roster: newRoster, freshness: fresh };
}

// Match experience — bank Improvisation (Composure + Adaptability) after a played
// match. Pure; applied in the match-end flow. This is the only way Improvisation
// grows (no training track), so a green squad firms up over the season.
export function applyMatchExperience(roster: readonly Unit[]): Unit[] {
  return roster.map((u) => ({
    ...u,
    attributes: {
      ...u.attributes,
      composure: clamp100(u.attributes.composure + MATCH_XP.composure),
      adaptability: clamp100(u.attributes.adaptability + MATCH_XP.adaptability),
    },
  }));
}

// R3 — League-Point cost of an extra whole-squad session, given how many of the
// SAME track are already in this week's cart (0 → base). Same-track repeats
// escalate; different tracks each start at base. Pure; config-driven.
export function extraSessionCost(nthAlreadyBought: number): number {
  return TRAINING.extraBaseCost + TRAINING.extraStepCost * nthAlreadyBought;
}

// Total LP cost of a cart of extra sessions (counts keyed by track).
export function extrasCost(extras: Partial<Record<TrainingTrack, number>>): number {
  let total = 0;
  for (const t of TRAINING_TRACKS) {
    const n = extras[t.id] ?? 0;
    for (let i = 0; i < n; i++) total += extraSessionCost(i);
  }
  return total;
}

// Qualitative freshness label for a unit (player-facing — no raw number).
export function freshnessLabel(freshness: FocusFreshness, unitId: string): string {
  const f = freshness[unitId] ?? 1;
  if (f >= 0.66) return 'fresh';
  if (f >= 0.33) return 'worn';
  return 'needs a break';
}

// 3c — drill a play in Set-Pieces: +perSession mastery (capped at 1). Pure.
export function drillPlay(playMastery: Record<string, number>, playId: string): Record<string, number> {
  return { ...playMastery, [playId]: Math.min(1, (playMastery[playId] ?? 0) + MASTERY.perSession) };
}

// Qualitative mastery level for a play (player-facing — the pp bonus stays hidden).
export function masteryLabel(m: number): string {
  if (m <= 0) return 'undrilled';
  if (m < 0.4) return 'rehearsed';
  if (m < 0.8) return 'drilled';
  return 'second nature';
}
