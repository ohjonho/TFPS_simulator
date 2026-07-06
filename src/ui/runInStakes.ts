// Run-in stakes — the late-season crescendo. In the back third of the regular
// season the match-prep screen surfaces the PLAYOFF RACE: where you sit, how many
// matches are left, and what THIS one means — escalating from "playoff places" or
// "the chase is on" to a final-day "must-win". A pure read over the standings (never
// the match RNG); returns null outside the run-in so the banner only appears — and
// its very appearance signals the season tipping into its climax.

import type { SeasonState } from '../game/season.ts';
import { computeStandings } from '../game/standings.ts';
import { LEAGUE } from '../game/config.ts';

// How many of the season's final matches count as "the run-in" (banner shows).
const RUN_IN_MATCHES = 4;

export type StakesTier = 'in' | 'bubble' | 'chase' | 'mustwin' | 'faded';
export type RunInStakes = { tier: StakesTier; kicker: string; line: string };

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export function runInStakesBanner(season: SeasonState): RunInStakes | null {
  const left = season.K - season.idx; // matches remaining, THIS one included
  if (left < 1 || left > RUN_IN_MATCHES) return null;

  const rows = computeStandings(season);
  const me = rows.find((r) => r.isPlayer);
  if (!me) return null;
  const cutoff = LEAGUE.playoffTeams;
  const rank = me.rank;
  const isLast = left === 1;
  const nLeft = `${left} to play`;
  const cutoffRow = rows[cutoff - 1];   // the last playoff place
  const firstOutRow = rows[cutoff];     // first team missing out
  const maxWins = me.wins + left;       // best case if you win out

  if (rank <= cutoff) {
    const cushion = me.wins - (firstOutRow?.wins ?? 0); // wins clear of the cutoff line
    if (isLast) {
      return cushion > 0
        ? { tier: 'in', kicker: "You're through", line: `Top four is secured — this last one's for <strong>seeding</strong>. Finish strong and take the momentum into the playoffs.` }
        : { tier: 'bubble', kicker: 'Win to lock it', line: `You're in the top four on the final day, but it's tight. <strong>Win, and you're safely through.</strong>` };
    }
    return cushion >= left
      ? { tier: 'in', kicker: 'Playoff places', line: `You're <strong>${ordinal(rank)}</strong> with a cushion, ${nLeft}. Now it's about <strong>seeding</strong> — and carrying form into the bracket.` }
      : { tier: 'bubble', kicker: 'Clinging on', line: `You're holding <strong>${ordinal(rank)}</strong>, but only just — ${nLeft}, and the pack is right on your heels. <strong>Don't slip now.</strong>` };
  }

  // Outside the top four — chasing.
  const deficit = (cutoffRow?.wins ?? me.wins) - me.wins;
  if (maxWins < (cutoffRow?.wins ?? 0)) {
    return { tier: 'faded', kicker: 'Long shot', line: `The top four is all but out of reach now — but there's pride on the line, and a foundation to lay for next season.` };
  }
  if (isLast) {
    return { tier: 'mustwin', kicker: 'Must-win', line: `Final match of the regular season. <strong>Win and you're in the playoffs — lose, and the season's over.</strong>` };
  }
  return { tier: 'chase', kicker: 'The chase is on', line: `<strong>${ordinal(rank)}</strong>, ${deficit > 0 ? `${deficit} ${deficit === 1 ? 'win' : 'wins'} back` : 'level'} on the cutoff with ${nLeft}. You need a run — <strong>starting now.</strong>` };
}
