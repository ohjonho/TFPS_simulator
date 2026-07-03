// Story-arc TAGS — the mechanical vocabulary the character arcs trade in
// (game/story layer). Distinct from the 8 draftable tacticalTraits: story tags
// are only ever granted to AUTHORED characters or as arc payoffs, never rolled
// onto a random unit. They live in `Unit.storyTags` (absent ⇒ none), so any
// roster without story tags behaves byte-identically — the determinism guarantee
// that lets this whole layer sit on top of the sim.
//
// Effects hook three seams, each reading the tag off the unit at the point of
// use: COMBAT (anti-Clutch / Drained / Nervous — inline in combat.ts), TRAINING
// (Busy / Committed — training.ts), MORALE (Short Fuse / Even Keel / Homesick /
// Found Family — morale.ts). Cross-unit tags (Duo / Sisterhood) and flat
// attribute payoffs (Loyal / All-In / …) are declared here for the record but
// wired in later build phases (they need the arc runtime / authored roster).

import type { Unit } from './types.ts';
import { STORY_TAGS } from './config.ts';

export type StoryTagId =
  // combat-conditional
  | 'anti-Clutch'
  // temporary combat debuffs (cleared after the next match)
  | 'Drained' | 'Nervous'
  // training multipliers
  | 'Busy' | 'Committed'
  // morale modifiers / standing conditions
  | 'Short Fuse' | 'Even Keel' | 'Homesick' | 'Found Family'
  // flat attribute payoffs (applied at match-build — later phase)
  | 'Loyal' | 'All-In' | 'Locked In' | 'Steady-Hand'
  // cross-unit proximity buff (later phase)
  | 'Duo' | 'Sisterhood';

export function hasStoryTag(unit: Unit, id: StoryTagId): boolean {
  return unit.storyTags?.includes(id) ?? false;
}

// TRAINING — per-unit multiplier on a session's gains. Busy under-trains
// (day-job + kids); Committed over-delivers once resolved. ×1 when untagged.
export function storyTagTrainingMult(unit: Unit): number {
  if (hasStoryTag(unit, 'Committed')) return STORY_TAGS.committed.trainingMult;
  if (hasStoryTag(unit, 'Busy')) return STORY_TAGS.busy.trainingMult;
  return 1;
}

// MORALE — multiplier on a morale DELTA. Only negatives are scaled (a short fuse
// makes bad news land harder; an even keel softens it). ×1 when untagged or on a
// positive delta.
export function storyTagMoraleDeltaMult(unit: Unit, delta: number): number {
  if (delta >= 0) return 1;
  if (hasStoryTag(unit, 'Even Keel')) return STORY_TAGS.evenKeel.negMult;
  if (hasStoryTag(unit, 'Short Fuse')) return STORY_TAGS.shortFuse.negMult;
  return 1;
}

// MORALE — per-unit floor (Found Family keeps a settled player from bottoming
// out). 0 when untagged.
export function storyTagMoraleFloor(unit: Unit): number {
  return hasStoryTag(unit, 'Found Family') ? STORY_TAGS.foundFamily.floor : 0;
}

// MORALE — standing weekly drift (Homesick bleeds a little morale each week until
// resolved). 0 when untagged.
export function storyTagWeeklyMoraleDrift(unit: Unit): number {
  return hasStoryTag(unit, 'Homesick') ? -STORY_TAGS.homesick.weeklyDrain : 0;
}
