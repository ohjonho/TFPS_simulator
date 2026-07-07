// Phase 4 — season EVENT system. Events are pure DATA (see registry.ts); a small
// runtime (runtime.ts) picks an eligible event for a week slot, resolves its
// subject, and applies its effects. A generic screen (ui/eventScreen.ts) renders
// any event from this shape, so growing the pool = adding data, never new code.
//
// P4.1 scope: ambient events with `attr` (permanent aggregate bump) + `leaguePoints`
// effects and optional choices. Morale, persistent conditions, the telegraph, the
// story tentpole registry and sponsors land in later increments.

export type AggKey = 'mechanics' | 'gameSense' | 'discipline' | 'improvisation' | 'leadership';

// Who an event is "about" (fills the {player} slot + targets `self` effects),
// resolved deterministically at fire time.
export type Subject = 'random' | { lowest: AggKey } | { highest: AggKey };

// A typed effect verb. `attr` raises a visible aggregate (by bumping its hidden
// subs) on the whole team or the event's subject; `leaguePoints` grants LP.
// Numbers stay HIDDEN from the player (the no-numbers principle) — the body/choice
// text describes the effect qualitatively.
// When an arc-triggered departure resolves (Phase 4b). immediate/after-next-match
// fire a mid-season goodbye + 1-of-N redraft; end-season is narrative (the epilogue).
export type DepartWhen = 'immediate' | 'after-next-match' | 'end-season';
export interface PendingDeparture { characterId: string; when: DepartWhen; resolveAtIdx: number; reason?: string; }
// Phase 5 — a promise checked at the next training day (Cardo). Broken ⇒ onBreak fires.
export interface PendingObligation { id: string; characterId: string; require: 'focused-self'; onBreak: Effect[]; }

export type Effect =
  | { op: 'attr'; scope: 'team' | 'self'; agg: AggKey; amount: number }
  | { op: 'leaguePoints'; amount: number }
  | { op: 'morale'; scope: 'team' | 'self'; amount: number }
  // Story-arc ops (Phase 3), shared with the arc runtime. Tag ops target the
  // subject's storyTags (game/storyTags.ts); setFlag writes SeasonState.storyFlags
  // (author-namespaced keys). All applied by runtime.applyEffects.
  | { op: 'grantTag'; tagId: string }
  | { op: 'removeTag'; tagId: string }
  | { op: 'evolveTag'; from: string; to: string }
  | { op: 'setFlag'; flag: string; value?: string }
  // Phase 4b — the subject leaves the roster (records a pending departure).
  | { op: 'depart'; when: DepartWhen; reason?: string }
  // Phase 5 special ops.
  | { op: 'swapLoadout'; role?: string; hero?: string }              // Cardo — change the subject's role/hero
  | { op: 'grantPlaybookSlots'; amount: number }                    // Potter — extra custom-play capacity
  | { op: 'enableEventGroup'; groupId: string }                     // Reina/Jok3r/Won — turn on a recurring ambient-event group
  | { op: 'grantDuo'; partner: string; tagId: string; agg: AggKey; amount: number } // Yahyo — a mutual bond (tag + attr on both)
  | { op: 'obligation'; id: string; require: 'focused-self'; onBreak: Effect[] };   // Cardo — a promise the training day checks

export type EventChoice = { label: string; note?: string; effects: Effect[] };

// Optional flavour that makes an event read differently depending on WHO it lands
// on and HOW the season is going. Both are pure text appended to the body at
// render time (filled like body — {player}) — no bearing on effects/outcomes.
//   persona — keyed on the subject's personality (needs a subject).
//   record  — keyed on the team's current form (any event).
export type PersonalityId = 'Firebrand' | 'Catalyst' | 'Analyst' | 'Stabilizer';
export type RecordForm = 'strong' | 'even' | 'struggling';

export type SeasonEvent = {
  id: string;
  weight?: number;            // ambient draw weight (default 1)
  group?: string;             // only drawn once its group is enabled (SeasonState.enabledEventGroups)
  kicker: string;
  headline: string;          // may contain {player}
  body: string;              // may contain {player}
  subject?: Subject;         // required if any effect has scope 'self'
  effects?: Effect[];        // applied on Continue (no-choice events)
  choices?: EventChoice[];   // each carries its own effects
  persona?: Partial<Record<PersonalityId, string>>; // aside flavoured by subject personality
  record?: Partial<Record<RecordForm, string>>;     // aside flavoured by form
};
