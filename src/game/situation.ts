// Situational read — AI competence #3. A per-tick aggression delta from the
// round situation (man-count, round-timer, plant state), applied on top of a
// unit's base (role+strategy) aggression in tick.ts. Because aggression feeds
// the #2 engage threshold and the push behavior, this makes a unit press a
// man-advantage, makes attackers escalate as the timer runs down (defenders win
// on timeout), and inverts post-plant: attackers hold the plant and stop
// over-peeking, defenders ramp up to retake before detonation. Pure +
// deterministic; no RNG.

import type { GameState, Unit } from './types.ts';
import { DETONATION_TICKS, ROUND_TICK_LIMIT, SITUATION } from './config.ts';

function aliveCount(units: readonly Unit[], team: Unit['team']): number {
  let n = 0;
  for (const u of units) if (u.team === team && u.state === 'alive') n++;
  return n;
}

// Aggression delta (clamped to ±SITUATION.deltaCap) for `unit` at `tick`.
export function situationAggressionDelta(unit: Unit, state: GameState, tick: number): number {
  const side = state.teamSide[unit.team];
  const enemyTeam: Unit['team'] = unit.team === 'defenders' ? 'attackers' : 'defenders';
  const myAlive = aliveCount(state.units, unit.team);
  const enemyAlive = aliveCount(state.units, enemyTeam);

  // Press a man-advantage; play careful when down a man.
  let delta = (myAlive - enemyAlive) * SITUATION.manAdvantageWeight;

  if (state.plant.planted) {
    if (side === 'attacker') {
      // Objective achieved — hold the angle on the plant, don't over-peek.
      delta += SITUATION.postPlantAttacker;
    } else {
      // Must retake; urgency climbs as the detonation timer runs down.
      const elapsed = tick - state.plant.planted.plantedAtTick;
      const frac = Math.max(0, Math.min(1, elapsed / DETONATION_TICKS));
      delta += SITUATION.postPlantDefenderBase + frac * SITUATION.postPlantDefenderUrgencyMax;
    }
  } else if (side === 'attacker') {
    // Pre-plant: escalate toward the timer — attackers lose on timeout, so a
    // do-nothing attacker has to commit before the clock kills the round.
    const start = SITUATION.attackerUrgencyStartFrac * ROUND_TICK_LIMIT;
    if (tick > start) {
      const frac = Math.min(1, (tick - start) / Math.max(1, ROUND_TICK_LIMIT - start));
      delta += frac * SITUATION.attackerUrgencyMax;
    }
  } else {
    // Defenders can afford to wait out the clock.
    delta += SITUATION.defenderPatience;
  }

  return Math.max(-SITUATION.deltaCap, Math.min(SITUATION.deltaCap, delta));
}
