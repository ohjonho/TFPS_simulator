// Pass 2c — personality CHEMISTRY engine.
//
// Pure, deterministic. Maps a team's personalities to pairwise "locker-room"
// interactions (positive / risky / negative / neutral) and a per-unit
// attribute-point delta. This is a STUB for the v1 management layer: it is
// deliberately NOT consumed by the live sim (tick.ts / match.ts / combat.ts
// never call it), so it has ZERO effect on match outcomes today — same posture
// `threat.ts` had before it was wired. The management layer will call
// `computeTeamChemistry()` pre/post-match to nudge attributes, and may derive
// rewards (strategy/trait unlocks, sponsor cash, EXP, quests) from the returned
// interactions. See docs/spec.md §15, [[v1-direction]], [[redesign-progress]].
//
// Model — two quadrant axes per personality (config.PERSONALITIES.axes):
//   extroversion ∈ {−1 introvert, +1 extrovert}, people ∈ {−1 task, +1 people}.
// Pairwise score (−2..+2) from three forces:
//   + people-glue : each people-oriented member warms the pair (0/+1/+2)
//   − ego-clash   : two extroverted task-driven egos compete for the spotlight (−2)
//   + complement  : opposites on BOTH axes attract and round each other out (+1)
// Buckets (config.CHEMISTRY): ≥positiveAt → positive (both +delta);
//   ==riskyAt → risky (the task member gains, the people member gives → ∓delta);
//   ≤negativeAt → negative (both −delta); else neutral (0).

import { CHEMISTRY, PERSONALITIES } from './config.ts';
import type { Personality, PersonalityAxes } from './types.ts';

export type InteractionType = 'positive' | 'risky' | 'negative' | 'neutral';

// One roster member fed to the engine. `personality` may be null (the sim
// allows it); null members form no interactions.
export interface ChemistryMember {
  id: string;
  personality: Personality | null;
}

export interface PairInteraction {
  a: string; // unit id (lower input index)
  b: string; // unit id (higher input index)
  type: InteractionType;
  score: number; // raw pairwise score, −2..+2
  rationale: string; // human-readable cause (UI / debugging / future scouting)
}

export interface UnitChemistryDelta {
  id: string;
  delta: number; // net attribute-point swing the management layer would apply
}

export interface TeamChemistry {
  interactions: PairInteraction[];
  perUnit: UnitChemistryDelta[];
  teamScore: number; // Σ pairwise scores — a single locker-room rating
}

function axesOf(p: Personality): PersonalityAxes {
  return PERSONALITIES[p].axes as PersonalityAxes;
}

const isPeople = (a: PersonalityAxes): boolean => a.people > 0;
const isTask = (a: PersonalityAxes): boolean => a.people < 0;
const isExtrovert = (a: PersonalityAxes): boolean => a.extroversion > 0;

// Pure axis math for an unordered pair. Order-independent in score/type; the
// `rationale` reads a→b but the classification itself is symmetric.
export function classifyPair(
  pa: Personality,
  pb: Personality,
): { type: InteractionType; score: number; rationale: string } {
  const a = axesOf(pa);
  const b = axesOf(pb);

  const glue = (isPeople(a) ? 1 : 0) + (isPeople(b) ? 1 : 0);
  const egoClash = isExtrovert(a) && isTask(a) && isExtrovert(b) && isTask(b);
  const complement =
    a.extroversion !== b.extroversion && a.people !== b.people;

  const score = glue + (egoClash ? -2 : 0) + (complement ? 1 : 0);

  let type: InteractionType;
  if (score >= CHEMISTRY.positiveAt) type = 'positive';
  else if (score <= CHEMISTRY.negativeAt) type = 'negative';
  else if (score === CHEMISTRY.riskyAt) type = 'risky';
  else type = 'neutral';

  const rationale =
    type === 'negative'
      ? 'two vocal, task-driven egos compete for the spotlight'
      : type === 'positive'
        ? complement
          ? 'opposite temperaments round each other out'
          : glue === 2
            ? 'two people-first players reinforce the room'
            : 'shared focus builds a steady bond'
        : type === 'risky'
          ? 'the people-first member carries the pairing; the task-first member gains'
          : 'parallel, low-friction — neither lifts nor drains the other';

  return { type, score, rationale };
}

// Per-pair attribute deltas keyed by member role in the pair. For `risky`, the
// task-oriented member gains and the people-oriented member gives; ties (same
// orientation can't be risky under the model) never occur.
function pairDeltas(
  type: InteractionType,
  pa: Personality,
): [number, number] {
  const d = CHEMISTRY.delta;
  switch (type) {
    case 'positive':
      return [d, d];
    case 'negative':
      return [-d, -d];
    case 'risky': {
      // Task member (people < 0) gains; people member (people > 0) gives.
      const aGains = isTask(axesOf(pa));
      return aGains ? [d, -d] : [-d, d];
    }
    default:
      return [0, 0];
  }
}

// Compute the full chemistry read for a roster. Deterministic: unordered pairs
// are walked in input order (i<j), no RNG, no time. Null-personality members
// are skipped (they form no interactions and get a 0 delta if present).
export function computeTeamChemistry(members: ChemistryMember[]): TeamChemistry {
  const interactions: PairInteraction[] = [];
  const deltaById = new Map<string, number>();
  for (const m of members) deltaById.set(m.id, 0);

  let teamScore = 0;
  for (let i = 0; i < members.length; i++) {
    const mi = members[i];
    if (!mi.personality) continue;
    for (let j = i + 1; j < members.length; j++) {
      const mj = members[j];
      if (!mj.personality) continue;

      const { type, score, rationale } = classifyPair(mi.personality, mj.personality);
      interactions.push({ a: mi.id, b: mj.id, type, score, rationale });
      teamScore += score;

      const [da, db] = pairDeltas(type, mi.personality);
      deltaById.set(mi.id, (deltaById.get(mi.id) ?? 0) + da);
      deltaById.set(mj.id, (deltaById.get(mj.id) ?? 0) + db);
    }
  }

  const perUnit: UnitChemistryDelta[] = members.map((m) => ({
    id: m.id,
    delta: deltaById.get(m.id) ?? 0,
  }));

  return { interactions, perUnit, teamScore };
}
