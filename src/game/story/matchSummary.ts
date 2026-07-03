// Phase 3d — derive the post-match summary the arc runtime reads for its
// `onMatchEvent` triggers. Pure: reads the finished match's event log + units.
//
//   lastAliveUnitIds — player-team units that were LAST ALIVE (a genuine 1vX) in
//     ≥1 round: either the sole survivor of a round, or the last of the team to
//     fall (alone before dying). This is Moony's curse trigger.
//   negativeKdUnitIds — player-team units ending the match on a negative K/D
//     (kills − deaths < 0). For later arcs (e.g. Reina's tilt).

import type { GameState } from '../types.ts';
import type { MatchSummary } from './arcRuntime.ts';
import { computeMatchStats } from '../stats.ts';

export function matchSummary(state: GameState): MatchSummary {
  const playerIds = new Set(state.units.filter((u) => u.team === state.playerTeam).map((u) => u.id));
  const teamSize = playerIds.size;

  // Player deaths grouped by round.
  const byRound = new Map<number, { id: string; tick: number }[]>();
  for (const e of state.events) {
    if (e.type === 'death' && playerIds.has(e.target)) {
      const arr = byRound.get(e.roundIndex) ?? [];
      arr.push({ id: e.target, tick: e.tick });
      byRound.set(e.roundIndex, arr);
    }
  }

  const lastAlive = new Set<string>();
  for (const deaths of byRound.values()) {
    const died = new Set(deaths.map((d) => d.id));
    const survivors = [...playerIds].filter((id) => !died.has(id));
    if (survivors.length === 1) {
      // Won or timed out a 1vX — the sole survivor stood alone.
      lastAlive.add(survivors[0]);
    } else if (survivors.length === 0 && teamSize > 0) {
      // Whole team fell — the last to die was alone (a 1vX) before dying.
      lastAlive.add(deaths.reduce((a, b) => (b.tick >= a.tick ? b : a)).id);
    }
    // ≥2 survivors ⇒ the round ended before a 1vX ⇒ nobody was "last alive".
  }

  const stats = computeMatchStats(state.events, state.units);
  const negativeKdUnitIds = [...playerIds].filter((id) => {
    const s = stats[id];
    return s !== undefined && s.kills - s.deaths < 0;
  });

  return { lastAliveUnitIds: [...lastAlive], negativeKdUnitIds };
}
