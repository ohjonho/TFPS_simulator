// Pass A5 — performance stats. Pure derivation from the event log; no state
// of its own. Per the design doc (docs/attributes-design.md §5):
//   ACS    Average Combat Score, VLR-style formula
//   K/D/A  Kills / Deaths / Assists per match
//   KAST%  % of rounds in which a unit had K, A, S (survived), or T (traded)
//   ADR    Average Damage per Round
//   HS%    Headshot kills / total kills
//
// Rounds are filtered via `event.roundIndex` (stamped by tick.ts / match.ts).
// Assists: a unit damaged the victim within `assistWindowTicks` before death,
// excluding the killer; up to 2 most-recent damagers credited.
// Trade: the victim's killer is killed by ANY of the victim's teammates
// within `tradeWindowTicks` after the original death.

import type { GameEvent, GameState, Unit } from './types.ts';
import { ATTRIBUTES } from './config.ts';

// Per-unit stats for a single round.
export type RoundStats = {
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  headshotKills: number;
  acs: number;
  // KAST flags — set if condition met this round.
  k: boolean; a: boolean; s: boolean; t: boolean;
};

// Per-unit stats aggregated across the whole match (so far).
export type MatchStats = {
  kills: number;
  deaths: number;
  assists: number;
  totalDamage: number;
  headshotKills: number;
  acs: number;            // running ACS = sum(roundACS) / roundsPlayed
  adr: number;            // totalDamage / roundsPlayed
  kastPct: number;        // 0-100
  hsPct: number;          // headshotKills / kills × 100; 0 if no kills
  roundsPlayed: number;
  // Per-round ACS history for the match-end sparkline.
  acsByRound: number[];
};

// --- Per-round helpers ----------------------------------------------------

// Shots that damaged `victim` within `windowTicks` before `deathTick`.
// Returns shooter ids in most-recent-first order; excludes the killer.
function damagersBeforeDeath(
  events: readonly GameEvent[],
  victim: string,
  killerId: string | null,
  deathTick: number,
  windowTicks: number,
): string[] {
  const damagers: { shooter: string; tick: number }[] = [];
  for (const e of events) {
    if (e.type !== 'shot') continue;
    if (e.target !== victim) continue;
    if (!e.hit) continue;
    if (e.shooter === killerId) continue;
    if (e.tick > deathTick) continue;
    if (e.tick < deathTick - windowTicks) continue;
    damagers.push({ shooter: e.shooter, tick: e.tick });
  }
  // De-duplicate (one assist per shooter), most-recent first.
  damagers.sort((a, b) => b.tick - a.tick);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of damagers) {
    if (seen.has(d.shooter)) continue;
    seen.add(d.shooter);
    out.push(d.shooter);
    if (out.length >= 2) break;
  }
  return out;
}

// Killer of `victim` from a 'death' event = the most-recent 'shot' that hit
// the victim at or before the death tick. Returns null if not derivable.
function killerOf(
  events: readonly GameEvent[],
  victim: string,
  deathTick: number,
): string | null {
  let killer: string | null = null;
  let bestTick = -Infinity;
  for (const e of events) {
    if (e.type !== 'shot') continue;
    if (e.target !== victim) continue;
    if (!e.hit) continue;
    if (e.tick > deathTick) continue;
    if (e.tick > bestTick) { bestTick = e.tick; killer = e.shooter; }
  }
  return killer;
}

// VLR-style multikill bonus per spec §5.2 (3v3 scaled: 3K = ace).
function multiKillBonus(kills: number): number {
  if (kills <= 1) return 0;
  if (kills === 2) return 0;
  return ATTRIBUTES.performanceStats.acs.multikill3K;
}

// Compute per-unit stats for one round.
export function computeRoundStats(
  events: readonly GameEvent[],
  roundIndex: number,
  units: readonly Unit[],
): Record<string, RoundStats> {
  const out: Record<string, RoundStats> = {};
  for (const u of units) {
    out[u.id] = {
      kills: 0, deaths: 0, assists: 0,
      damage: 0, headshotKills: 0, acs: 0,
      k: false, a: false, s: false, t: false,
    };
  }
  // Filter to this round once.
  const roundEvents = events.filter((e) => e.roundIndex === roundIndex);

  // Damage + kills + headshots.
  for (const e of roundEvents) {
    if (e.type !== 'shot') continue;
    if (!e.hit) continue;
    const shot = out[e.shooter];
    if (shot) shot.damage += e.damage;
  }

  // Deaths + assists (death + tradeFlag computed against full log filtered).
  const cfg = ATTRIBUTES.performanceStats;
  // Pre-compute deaths in the round with their killer.
  const deathsInRound: { victim: string; tick: number; killer: string | null }[] = [];
  for (const e of roundEvents) {
    if (e.type !== 'death') continue;
    deathsInRound.push({
      victim: e.target,
      tick: e.tick,
      killer: killerOf(roundEvents, e.target, e.tick),
    });
  }

  // Assign kills/deaths/assists; trade flag.
  const unitsById: Record<string, Unit> = {};
  for (const u of units) unitsById[u.id] = u;
  for (const d of deathsInRound) {
    const victim = out[d.victim];
    if (!victim) continue;
    victim.deaths += 1;
    if (d.killer) {
      const killer = out[d.killer];
      if (killer) {
        killer.kills += 1;
        // Headshot kill? Find the lethal shot.
        const lethal = roundEvents.find(
          (e) =>
            e.type === 'shot' &&
            e.target === d.victim &&
            e.shooter === d.killer &&
            e.tick === d.tick &&
            e.hit,
        );
        if (lethal && lethal.type === 'shot' && lethal.headshot) killer.headshotKills += 1;
      }
      // Trade: did any teammate of the victim kill the killer within
      // tradeWindowTicks after this death?
      const victimUnit = unitsById[d.victim];
      if (victimUnit) {
        const tradedDeath = deathsInRound.find(
          (e) =>
            e.victim === d.killer &&
            e.tick > d.tick &&
            e.tick <= d.tick + cfg.tradeWindowTicks &&
            e.killer !== null &&
            unitsById[e.killer]?.team === victimUnit.team,
        );
        if (tradedDeath) victim.t = true;
      }
    }
    // Assists.
    const assistIds = damagersBeforeDeath(
      roundEvents, d.victim, d.killer, d.tick, cfg.assistWindowTicks,
    );
    for (const aid of assistIds) {
      const assister = out[aid];
      if (assister) assister.assists += 1;
    }
  }

  // KAST K, A, S flags from per-unit totals.
  // Survival: unit has no death event in this round.
  const diedThisRound = new Set(deathsInRound.map((d) => d.victim));
  for (const u of units) {
    const s = out[u.id];
    if (!s) continue;
    s.k = s.kills > 0;
    s.a = s.assists > 0;
    s.s = !diedThisRound.has(u.id);
  }

  // ACS contribution: kills*200 + assists*50 + multikill bonus + damage.
  for (const u of units) {
    const s = out[u.id];
    if (!s) continue;
    s.acs = s.kills * cfg.acs.killValue
          + s.assists * cfg.acs.assistValue
          + multiKillBonus(s.kills)
          + s.damage * cfg.acs.damageMultiplier;
  }

  return out;
}

// --- Per-match aggregation ------------------------------------------------

// Aggregate per-round stats across the whole match (so far). Uses every
// 'roundResult' event as a per-round anchor — rounds without a roundResult
// (currently in progress) are excluded.
export function computeMatchStats(
  events: readonly GameEvent[],
  units: readonly Unit[],
): Record<string, MatchStats> {
  const out: Record<string, MatchStats> = {};
  for (const u of units) {
    out[u.id] = {
      kills: 0, deaths: 0, assists: 0,
      totalDamage: 0, headshotKills: 0,
      acs: 0, adr: 0, kastPct: 0, hsPct: 0,
      roundsPlayed: 0, acsByRound: [],
    };
  }

  // Find all completed rounds (presence of 'roundResult' event).
  const completedRounds = new Set<number>();
  for (const e of events) {
    if (e.type === 'roundResult') completedRounds.add(e.roundIndex);
  }
  const rounds = [...completedRounds].sort((a, b) => a - b);

  // Accumulators.
  const kastTotals: Record<string, number> = {};
  for (const u of units) kastTotals[u.id] = 0;

  for (const r of rounds) {
    const rs = computeRoundStats(events, r, units);
    for (const u of units) {
      const stat = out[u.id];
      const round = rs[u.id];
      if (!stat || !round) continue;
      stat.kills += round.kills;
      stat.deaths += round.deaths;
      stat.assists += round.assists;
      stat.totalDamage += round.damage;
      stat.headshotKills += round.headshotKills;
      stat.acsByRound.push(round.acs);
      if (round.k || round.a || round.s || round.t) kastTotals[u.id] += 1;
    }
  }

  for (const u of units) {
    const stat = out[u.id];
    if (!stat) continue;
    stat.roundsPlayed = rounds.length;
    if (rounds.length > 0) {
      stat.acs = Math.round(stat.acsByRound.reduce((a, b) => a + b, 0) / rounds.length);
      stat.adr = Math.round(stat.totalDamage / rounds.length * 10) / 10;
      stat.kastPct = Math.round(kastTotals[u.id] / rounds.length * 1000) / 10;
    }
    stat.hsPct = stat.kills > 0
      ? Math.round((stat.headshotKills / stat.kills) * 1000) / 10
      : 0;
  }

  return out;
}

// MVP = highest ACS on the winning team. Returns null if no match-winner yet
// or no units have any ACS contribution (degenerate scoreless match).
export function mvpUnit(state: GameState): Unit | null {
  if (!state.matchOver || !state.matchWinner || state.matchWinner === 'draw') return null;
  const stats = computeMatchStats(state.events, state.units);
  let best: Unit | null = null;
  let bestAcs = -Infinity;
  for (const u of state.units) {
    if (u.team !== state.matchWinner) continue;
    const s = stats[u.id];
    if (!s) continue;
    if (s.acs > bestAcs) { bestAcs = s.acs; best = u; }
  }
  return bestAcs > 0 ? best : null;
}

// Sort units by ACS desc within their team; for the scoreboard layout.
export function sortByAcs(units: readonly Unit[], stats: Record<string, MatchStats>): Unit[] {
  return [...units].sort((a, b) => (stats[b.id]?.acs ?? 0) - (stats[a.id]?.acs ?? 0));
}

// Helper exposed for unit hover panels: ACS contribution for the round-in-
// progress only (i.e. partial computation against the current tick state).
export function currentRoundStats(state: GameState): Record<string, RoundStats> {
  return computeRoundStats(state.events, state.round, state.units);
}
