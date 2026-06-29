// League standings (v1 economy R2) — a 9-team single round-robin: you (Pixel
// Pursuit) + your 8 scheduled rivals. Every team plays every other once over 9
// rounds, byeing exactly once; the player's bye is the mid-season break. Your
// fixtures use your real match results; rival-vs-rival fixtures are a LIGHT sim
// (a seeded coin-flip weighted by team rating — NOT a full match), so the table
// stays coherent (each completed round = 4 results = 4 W + 4 L) without running
// any extra matches.
//
// Everything here is PURE and DERIVED from existing SeasonState (seed, schedule,
// opponents, results) + the constant fixture math — no new stored state, no save
// bump, and it never touches the match RNG, so determinism is unaffected.

import type { SeasonState } from './season.ts';
import { teamRating } from './ratings.ts';
import { createRng } from './rng.ts';
import { LEAGUE, MATCH_WIN_SCORE } from './config.ts';

const N = LEAGUE.teams;            // 9
const P = LEAGUE.playerTeamIndex;  // 2 — chosen so the player byes the middle round
const BYE = LEAGUE.byeRound;       // 4

export const PLAYER_TEAM_NAME = 'Pixel Perfect';

// Round r: pairs satisfy (i+j) % N === r; the team with 2i ≡ r byes (= 5r % N,
// since 5 is the inverse of 2 mod 9). Yields 9 rounds, every pair exactly once,
// one bye per round.
function byeTeam(r: number): number { return (5 * r) % N; }
function roundPairs(r: number): [number, number][] {
  const bye = byeTeam(r);
  const pairs: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const j = (((r - i) % N) + N) % N;
    if (i < j && i !== bye && j !== bye) pairs.push([i, j]);
  }
  return pairs;
}

// The player (index P) plays every round except BYE. Map player match index
// (0..7) ↔ round, and the rival team-index the player faces.
function roundOfMatch(k: number): number { return k < BYE ? k : k + 1; }
function matchOfRound(r: number): number { return r < BYE ? r : r - 1; }
function playerOppIndex(round: number): number { return (((round - P) % N) + N) % N; }
// Inverse: which player-match faces rival team-index ti.
function matchForRival(ti: number): number {
  for (let k = 0; k < N - 1; k++) if (playerOppIndex(roundOfMatch(k)) === ti) return k;
  return -1;
}

// Identity + rating per team index. P = the player; every other index is the
// rival the player faces in matchForRival(ti), so names/rosters come from there.
function ratingOf(season: SeasonState, ti: number): number {
  if (ti === P) return teamRating(season.playerRoster);
  return teamRating(season.schedule[matchForRival(ti)] ?? []);
}
function nameOf(season: SeasonState, ti: number): string {
  if (ti === P) return PLAYER_TEAM_NAME;
  return season.opponents[matchForRival(ti)]?.name ?? `Team ${ti}`;
}

// Light match sim — seeded coin-flip weighted by rating gap, deterministic per
// (seed, salt, a, b). Returns the winning team index. Used for rival-vs-rival
// league fixtures (salt = round) and playoff matches the player isn't in.
function simMatchWinner(season: SeasonState, salt: number, a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const ra = ratingOf(season, lo);
  const rb = ratingOf(season, hi);
  let p = 0.5 + LEAGUE.ratingToWinProbK * (ra - rb); // chance lo beats hi
  p = Math.max(LEAGUE.winProbClamp.min, Math.min(LEAGUE.winProbClamp.max, p));
  const rng = createRng((season.seed ^ (salt * 0x9e3779b1) ^ (lo * 0x85ebca6b) ^ (hi * 0x27d4eb2f)) >>> 0);
  return rng.next() < p ? lo : hi;
}

// A plausible loser scoreline for a sim'd fixture: the winner takes MATCH_WIN_SCORE
// rounds, the loser a deterministic 0..(MATCH_WIN_SCORE−1) — fewer the more the
// winner outrates them. Gives every league fixture a scoreline so round-diff is
// defined table-wide (the player's own matches use their REAL round tallies).
function simLoserRounds(season: SeasonState, salt: number, winner: number, loser: number): number {
  const gap = ratingOf(season, winner) - ratingOf(season, loser); // >0 = winner stronger
  const rng = createRng((season.seed ^ (salt * 0x9e3779b1) ^ (winner * 0x85ebca6b) ^ (loser * 0x27d4eb2f) ^ 0x5c04e5) >>> 0);
  const lr = Math.round(1.7 - gap * 0.08 + (rng.next() * 1.6 - 0.8));
  return Math.max(0, Math.min(MATCH_WIN_SCORE - 1, lr));
}

// A round is "played" once its matches have happened. Player matches drive rounds
// 0–3 and 5–8; the bye round (BYE) is played during the mid-season break.
function roundComplete(r: number, idx: number): boolean {
  if (r < BYE) return idx >= r + 1;
  if (r === BYE) return idx >= BYE;
  return idx >= r;
}

export type StandingRow = {
  teamIndex: number;
  name: string;
  wins: number;
  losses: number;
  played: number;
  rd: number;            // round differential = rounds won − rounds lost
  rating: number;
  isPlayer: boolean;
  rank: number;
};

// The full league table as of the season's current progress. Rank by wins, then
// round-differential (the standard tiebreak), then rating, then name (stable).
export function computeStandings(season: SeasonState): StandingRow[] {
  const wins = new Array<number>(N).fill(0);
  const losses = new Array<number>(N).fill(0);
  const played = new Array<number>(N).fill(0);
  const rf = new Array<number>(N).fill(0); // rounds for
  const ra = new Array<number>(N).fill(0); // rounds against

  for (let r = 0; r < N; r++) {
    if (!roundComplete(r, season.idx)) continue;
    for (const [i, j] of roundPairs(r)) {
      let winner: number;
      let wRounds = MATCH_WIN_SCORE;
      let lRounds: number;
      if (i === P || j === P) {
        const res = season.results[matchOfRound(r)];
        if (res === undefined) continue; // safety: player's match not recorded yet
        winner = res === 'W' ? P : (i === P ? j : i);
        const loser = winner === i ? j : i;
        // The player's REAL round tally for this match (winner's = the higher score).
        const score = season.roundScores?.[matchOfRound(r)];
        if (score) {
          const [pf, pa] = score;
          wRounds = winner === P ? pf : pa;
          lRounds = winner === P ? pa : pf;
        } else {
          lRounds = simLoserRounds(season, r, winner, loser); // pre-v9 save: synthesize
        }
      } else {
        winner = simMatchWinner(season, r, i, j);
        lRounds = simLoserRounds(season, r, winner, winner === i ? j : i);
      }
      const loser = winner === i ? j : i;
      wins[winner]++; losses[loser]++; played[winner]++; played[loser]++;
      rf[winner] += wRounds; ra[winner] += lRounds;
      rf[loser] += lRounds; ra[loser] += wRounds;
    }
  }

  const rows: StandingRow[] = [];
  for (let ti = 0; ti < N; ti++) {
    rows.push({
      teamIndex: ti, name: nameOf(season, ti), wins: wins[ti], losses: losses[ti],
      played: played[ti], rd: rf[ti] - ra[ti], rating: ratingOf(season, ti), isPlayer: ti === P, rank: 0,
    });
  }
  rows.sort((x, y) => y.wins - x.wins || y.rd - x.rd || y.rating - x.rating || x.name.localeCompare(y.name));
  rows.forEach((row, i) => { row.rank = i + 1; });
  return rows;
}

// The player's current league position (1..N).
export function playerRank(season: SeasonState): number {
  return computeStandings(season).find((r) => r.isPlayer)?.rank ?? N;
}

// The team-index of the player's NEXT opponent (or null if the season's done) —
// so the standings UI can flag the right row even when two rivals share a name.
export function nextOpponentTeamIndex(season: SeasonState): number | null {
  if (season.idx >= season.K) return null;
  return playerOppIndex(roundOfMatch(season.idx));
}

// All 8 player matches played ⇒ every round resolved.
export function regularSeasonComplete(season: SeasonState): boolean {
  return season.idx >= season.K;
}

// Did the player finish in a playoff-qualifying position?
export function madePlayoffs(season: SeasonState): boolean {
  return regularSeasonComplete(season) && playerRank(season) <= LEAGUE.playoffTeams;
}

// The top-`playoffTeams` rows (the bracket seeds) — consumed by the playoffs (R2d).
export function playoffSeeds(season: SeasonState): StandingRow[] {
  return computeStandings(season).slice(0, LEAGUE.playoffTeams);
}

// R2d helpers — resolve a bracket team-index to its regular-season match (and so
// its roster/identity), its display name, and the light sim for a playoff match
// the player isn't in (distinct salt range from league rounds).
export function rivalMatchIndexFor(ti: number): number { return matchForRival(ti); }
export function teamNameForIndex(season: SeasonState, ti: number): string { return nameOf(season, ti); }
export function simPlayoffWinner(season: SeasonState, slot: number, a: number, b: number): number {
  return simMatchWinner(season, 0x50000 + slot, a, b);
}
