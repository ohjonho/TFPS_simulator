// Engagement gate — AI competence #2. Decides whether a unit commits to a duel
// it can see, and which target to shoot.
//
// Replaces the old binary shouldEngage ("any enemy visible → fight"). The unit
// now sizes up the duel: estimated odds = my expected-damage-per-tick share vs
// the target (combat.estimateEdpt, which reads the full effective-stat seam — so
// mark, traits, cover, range and weapon all count, and a sniper's burst reads as
// the threat it is). Whether to commit is PROBABILISTIC and modulated by
// personality: P(fight) = logistic((odds − threshold)/softness), threshold
// lowered by aggression + risk traits (Ego/Hot Head peek the AWP anyway) and
// raised by patient/anchor traits. The accept roll uses a seeded rng supplied by
// the caller, so determinism holds.
//
// Decline isn't "do nothing": if the unit is standing somewhere dangerous it
// holds and tucks to cover (don't feed the angle); otherwise it keeps executing
// its movement (a far shotgun still closes). The smart "flank the lane" reposition
// is the later approach-IQ concern.

import type { AiState, GameState, Side, Unit } from './types.ts';
import type { Rng } from './rng.ts';
import { hexDistance } from './hex.ts';
import { estimateEdpt } from './combat.ts';
import { staticExposure, suspectedEnemyHexes, threatAt } from './threat.ts';
import { ENGAGE, ROLE_PROFILE } from './config.ts';

export type EngageAssessment = {
  engage: boolean;
  targetId: string | null;
  // Declined while exposed → hold + tuck to cover instead of advancing.
  holdForSafety: boolean;
};

function aliveTeam(units: readonly Unit[], team: Unit['team']): number {
  let n = 0;
  for (const u of units) if (u.team === team && u.state === 'alive') n++;
  return n;
}

// Odds (0..1) at which this unit becomes a coin-flip to commit. Lower = takes
// worse fights. Aggression + risk/patient traits shift it; clamped.
function engageThreshold(unit: Unit, side: Side): number {
  let t = ENGAGE.baseThreshold;
  // High aggression lowers the bar (fights more); risk traits are negative
  // deltas (lower the bar further), patient/anchor traits positive (raise it).
  t -= (unit.modifiers.aggression - 50) * ENGAGE.aggressionWeight;
  // v0.27.0 — side-aware role posture: Vanguard commits (− delta), Warden is more
  // selective on defense (+ delta) but ~neutral on attack (disciplined support,
  // not a passive decliner). The explicit half of "Warden ≠ Vanguard".
  t += ROLE_PROFILE[unit.role][side].engageDelta;
  const tt = ENGAGE.traitThreshold;
  for (const id of [...unit.tacticalTraits, unit.personality]) {
    if (id && tt[id] !== undefined) t += tt[id];
  }
  return Math.max(ENGAGE.minThreshold, Math.min(ENGAGE.maxThreshold, t));
}

function isMarked(state: GameState, team: Unit['team'], enemyId: string, tick: number): boolean {
  return state.cardEffects.some(
    (fx) =>
      fx.kind === 'mark_target' &&
      fx.team === team &&
      fx.targetId === enemyId &&
      (fx.expiresAtTick === undefined || tick <= fx.expiresAtTick),
  );
}

export function assessEngagement(
  unit: Unit,
  visibleEnemies: readonly Unit[],
  state: GameState,
  prevAi: AiState,
  rng: Rng,
  tick: number,
): EngageAssessment {
  if (visibleEnemies.length === 0) return { engage: false, targetId: null, holdForSafety: false };

  const lastAlive = aliveTeam(state.units, unit.team) === 1;

  // Pick the best target by desirability: finishing a wounded enemy (securable)
  // > favorable odds > the team's marked target > closer. `bestOdds` is the
  // chosen target's odds — what the commit decision rolls against.
  let best: Unit | null = null;
  let bestScore = -Infinity;
  let bestOdds = 0.5;
  for (const e of visibleEnemies) {
    const eLastAlive = aliveTeam(state.units, e.team) === 1;
    const myEdpt = estimateEdpt(unit, e, state.map, state.buffs[unit.id] ?? [], state.cardEffects, tick, lastAlive, ENGAGE.skillOddsWeight);
    const eEdpt = estimateEdpt(e, unit, state.map, state.buffs[e.id] ?? [], state.cardEffects, tick, eLastAlive, ENGAGE.skillOddsWeight);
    const odds = myEdpt + eEdpt > 0 ? myEdpt / (myEdpt + eEdpt) : 0.5;
    const marked = isMarked(state, unit.team, e.id, tick);
    const score = odds + 0.15 * (e.maxHp - e.hp) + (marked ? 0.25 : 0) - 0.01 * hexDistance(unit.pos, e.pos);
    if (score > bestScore) {
      bestScore = score;
      best = e;
      bestOdds = odds;
    }
  }
  if (!best) return { engage: false, targetId: null, holdForSafety: false };

  // Anti-flip-flop: once committed, keep fighting while the prior target is
  // still a live, visible option (don't re-roll the decision every tick).
  if (
    prevAi.mode === 'engaged' &&
    prevAi.firingTarget !== null &&
    visibleEnemies.some((e) => e.id === prevAi.firingTarget)
  ) {
    return { engage: true, targetId: prevAi.firingTarget, holdForSafety: false };
  }

  // Point-blank: already in the fight.
  if (hexDistance(unit.pos, best.pos) <= ENGAGE.forceEngageRange) {
    return { engage: true, targetId: best.id, holdForSafety: false };
  }

  // Probabilistic commit on acquisition.
  const threshold = engageThreshold(unit, state.teamSide[unit.team]);
  const p = 1 / (1 + Math.exp(-(bestOdds - threshold) / ENGAGE.softness));
  const pClamped = Math.max(ENGAGE.minAccept, Math.min(ENGAGE.maxAccept, p));
  if (rng.chance(pClamped)) {
    return { engage: true, targetId: best.id, holdForSafety: false };
  }

  // Declined: hold + tuck only if standing somewhere dangerous.
  const here = threatAt(state, unit.team, unit.pos, staticExposure(state.map), suspectedEnemyHexes(state, unit.team));
  return { engage: false, targetId: null, holdForSafety: here > ENGAGE.holdThreatCutoff };
}
