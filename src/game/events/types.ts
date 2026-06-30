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
export type Effect =
  | { op: 'attr'; scope: 'team' | 'self'; agg: AggKey; amount: number }
  | { op: 'leaguePoints'; amount: number }
  | { op: 'morale'; scope: 'team' | 'self'; amount: number };

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
  kicker: string;
  headline: string;          // may contain {player}
  body: string;              // may contain {player}
  subject?: Subject;         // required if any effect has scope 'self'
  effects?: Effect[];        // applied on Continue (no-choice events)
  choices?: EventChoice[];   // each carries its own effects
  persona?: Partial<Record<PersonalityId, string>>; // aside flavoured by subject personality
  record?: Partial<Record<RecordForm, string>>;     // aside flavoured by form
};
