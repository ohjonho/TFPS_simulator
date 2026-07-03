// Character-arc schema (Phase 3). An Arc is pure DATA: a sequence of beats, each
// with a trigger, optional choices (or a weighted roll), and Effects (the shared
// events/types vocab). The arc runtime (arcRuntime.ts) evaluates triggers, renders
// beats, applies effects, and stamps roll outcomes — so adding an arc = adding data.
//
// Phase-3 scope covers Moony + imissu (see arcs.ts). Fields for later phases
// (recurring/escalating triggers, rival binding, cross-unit rolls, depart) are
// typed here but not yet consumed.

import type { Effect, PersonalityId, RecordForm } from '../events/types.ts';

export type BeatSlot = 'pre-match' | 'post-match' | 'either';

// When a beat becomes eligible. All present conditions must hold. Absent = ignored.
export interface BeatTrigger {
  slot: BeatSlot;
  onWeek?: number;                                   // current week ≥ this
  onMatchEvent?: 'last-alive-round' | 'negative-kd'; // subject appears in the just-played MatchSummary (post-match)
  onNthWin?: number;                                 // season wins ≥ this
  requiresFlag?: string;                             // SeasonState.storyFlags[flag] is set
  requiresWinning?: boolean;                         // team has a winning record (wins > losses)
  minGapSlots?: number;                              // ≥ this many slots since the arc last advanced ("skip a day")
  // Later phases: recurring / escalates / requiresWinning / onMatchVsBoundRival / inPlayoffs.
}

// A weighted roll (deterministic on the season stream, stamped once resolved). One
// outcome ⇒ guaranteed. `weightBy` shifts the odds toward outcomes[0] by a unit's
// aggregate (e.g. the mentor's Leadership): shift = (agg − 50) · perPt, moved from
// the last outcome's weight into the first.
export interface RollOutcome { id: string; effects: Effect[]; }
export interface RollSpec {
  baseWeights: number[];                       // parallel to `outcomes`
  outcomes: RollOutcome[];
  weightBy?: { agg: 'leadership' | 'improvisation'; of: 'best-teammate' | 'subject' };
}

export interface ArcChoice {
  label: string;
  note?: string;
  requiresFlag?: string;   // choice only offered when this flag is set (later phases)
  effects?: Effect[];
  freezesArc?: boolean;    // resolve/close the arc here — no further beats
  goto?: string;           // jump to this beat id (else linear: next beat)
  roll?: RollSpec;         // this choice resolves via a weighted roll
}

export interface ArcBeat {
  id: string;
  trigger: BeatTrigger;
  maxHolds?: number;                               // Sam-holds before neglect (default 2)
  onNeglect?: Effect[];                            // applied if holds exhausted (absent ⇒ just stalls, neutral)
  kicker: string;
  headline: string;                                // may contain {player}
  body: string;                                    // may contain {player}
  persona?: Partial<Record<PersonalityId, string>>; // aside by subject personality
  record?: Partial<Record<RecordForm, string>>;     // aside by team form
  effects?: Effect[];                              // unconditional, on trigger (e.g. a morale dip)
  choices?: ArcChoice[];                           // player decision
  roll?: RollSpec;                                 // beat auto-resolves via a roll (no choices)
}

export interface Arc {
  id: string;               // === CharacterDef.arcId
  characterId: string;      // whose arc this is
  beats: ArcBeat[];
  // Epilogue reflection keyed by outcome/status; consumed by the arc-aware
  // epilogue (later phase). Optional.
  epilogue?: Partial<Record<string, string>>;
}

// --- Runtime state (lives in SeasonState.arcs, JSON-clean) ------------------
export type ArcStatus = 'unstarted' | 'active' | 'resolved' | 'frozen' | 'neglected' | 'departed';

export interface ArcRuntime {
  arcId: string;
  characterId: string;       // resolves the subject unit (roster unit with this characterId)
  stage: number;             // index of the NEXT beat to run
  heldCount: number;         // Sam-holds spent on the currently-ready beat
  status: ArcStatus;
  lastAdvancedSlot?: number; // global slot counter at last advance (for minGapSlots)
  resolvedOutcome?: string;  // stamped roll/branch id (last resolution)
}
