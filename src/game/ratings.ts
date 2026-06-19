// Player-facing rating + win-outlook estimate. Pure, no RNG, never touches the
// sim — it's the manager's READ (the dashboard team rating + the planning-screen
// Net Tactical Effect), not the resolver. The actual round is still decided by
// the tick sim; this is the "should this pick work?" projection the player acts on.

import type { GameState, Side, Unit } from './types.ts';
import { aggregateVisible } from './attributes.ts';

// A unit's overall = mean of its five visible aggregates.
export function unitOverall(u: Unit): number {
  const v = aggregateVisible(u.attributes);
  return (v.mechanics + v.gameSense + v.discipline + v.improvisation + v.leadership) / 5;
}

export function teamRating(units: readonly Unit[]): number {
  const alive = units.length ? units : [];
  if (alive.length === 0) return 50;
  const sum = alive.reduce((a, u) => a + unitOverall(u), 0);
  return Math.round((sum / alive.length) * 10) / 10;
}

// Counter-web favorability (−1..+1), the design intent of the soft counters —
// an estimate the player reads, not the sim's exact matrix. Defender pick vs the
// opponent's leaned ATTACK; attacker pick vs the opponent's leaned DEFENSE.
const DEF_VS_ATK: Record<string, Record<string, number>> = {
  Hold:                 { Rush: 0.30, Execute: -0.20, Control: 0.00, Mind_Games: 0.10 },
  Stack:                { Rush: 0.40, Execute: 0.20, Control: -0.30, Mind_Games: -0.20 },
  Pressure:             { Rush: -0.20, Execute: 0.10, Control: 0.30, Mind_Games: 0.00 },
  Mind_Games:           { Rush: -0.10, Execute: 0.20, Control: 0.10, Mind_Games: 0.00 },
  Coordinated_Lockdown: { Rush: 0.20, Execute: 0.10, Control: -0.20, Mind_Games: -0.30 },
  Rotate_Stack:         { Rush: -0.30, Execute: 0.20, Control: 0.40, Mind_Games: 0.10 },
  Mid_Control:          { Rush: -0.10, Execute: 0.10, Control: 0.40, Mind_Games: 0.10 },
};
const ATK_VS_DEF: Record<string, Record<string, number>> = {
  Rush:       { Hold: 0.20, Stack: -0.30, Pressure: -0.20, Mid_Control: -0.10, Coordinated_Lockdown: 0.10, Rotate_Stack: 0.30, Mind_Games: 0.20 },
  Execute:    { Hold: -0.10, Stack: 0.20, Pressure: 0.10, Mid_Control: 0.10, Coordinated_Lockdown: 0.10, Rotate_Stack: 0.20, Mind_Games: -0.10 },
  Control:    { Hold: 0.00, Stack: -0.20, Pressure: 0.30, Mid_Control: -0.30, Coordinated_Lockdown: 0.20, Rotate_Stack: -0.20, Mind_Games: 0.10 },
  Mind_Games: { Hold: -0.20, Stack: 0.40, Pressure: 0.00, Mid_Control: 0.10, Coordinated_Lockdown: 0.40, Rotate_Stack: -0.20, Mind_Games: 0.00 },
};

function counterFavor(playerStrat: string, oppStrat: string, playerSide: Side): number {
  const table = playerSide === 'defender' ? DEF_VS_ATK : ATK_VS_DEF;
  return table[playerStrat]?.[oppStrat] ?? 0;
}

export type WinFactor = { label: string; deltaPct: number };
export type WinOutlook = { pct: number; factors: WinFactor[]; oppName: string | null };

// Live win-outlook estimate for the player's CURRENT planning picks vs the
// scouted opponent lean. Recomputed by the UI on every strategy/variant change.
export function winOutlook(state: GameState): WinOutlook {
  const playerTeam = state.playerTeam;
  const oppTeam = playerTeam === 'defenders' ? 'attackers' : 'defenders';
  const playerSide = state.teamSide[playerTeam];
  const playerUnits = state.units.filter((u) => u.team === playerTeam && u.state === 'alive');
  const oppUnits = state.units.filter((u) => u.team === oppTeam && u.state === 'alive');

  const factors: WinFactor[] = [];
  let pct = 50;

  // 1) Rating edge (roster quality, incl. club lean + upgrades baked in).
  const delta = teamRating(playerUnits) - teamRating(oppUnits);
  const ratingPct = Math.round(delta * 2);
  if (ratingPct !== 0) factors.push({ label: `Rating ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`, deltaPct: ratingPct });
  pct += ratingPct;

  // 2) Counter read — the player's strategy vs the opponent's scouted lean.
  const lean = state.opponentLean?.[playerSide === 'attacker' ? 'defender' : 'attacker'];
  if (state.playerStrategy && lean?.strategy) {
    const fav = counterFavor(state.playerStrategy, lean.strategy, playerSide);
    const favPct = Math.round(fav * 25);
    if (favPct !== 0) factors.push({ label: `Your call vs their ${prettyName(lean.strategy)}`, deltaPct: favPct });
    pct += favPct;

    // 3) Site read — committing to / away from the site they favor.
    const playerSite = state.playerVariantChoice === 0 ? 'A' : state.playerVariantChoice === 1 ? 'B' : null;
    if (playerSite && lean.site) {
      const matched = playerSite === lean.site;
      const sitePct = playerSide === 'defender'
        ? (matched ? 12 : -12)   // stack where they hit (good) vs the wrong site (bad)
        : (matched ? -10 : 10);  // attack into their site (bad) vs the soft one (good)
      factors.push({ label: `Site read (you ${playerSite} · they ${lean.site})`, deltaPct: sitePct });
      pct += sitePct;
    }
  }

  return { pct: Math.max(10, Math.min(90, pct)), factors, oppName: state.opponentName ?? null };
}

function prettyName(id: string): string {
  return id.replace(/_/g, ' ');
}
