// v1 management layer — the lightest "gauntlet season". A persistent player
// roster (drafted once) plays a fixed schedule of matches vs generated
// opponents, tracking a record toward a goal. Wraps the existing match sim:
// each match rebuilds from (player roster + the next opponent), re-placed at
// spawns. Tests whether a campaign with continuity + stakes feels like a game
// (H1), on top of the now-confirmed compounding of management skill
// (memory: v1-compounding-test). Pure logic — main.ts holds the live
// SeasonState (like it holds matchMode/matchSeed) and drives the flow.

import type { GameState, MapDefinition, Side, Team, Unit } from './types.ts';
import { buildStateFromUnits } from './state.ts';
import { placeSpawns } from './units.ts';
import { generatePool } from './draft.ts';
import { createRng } from './rng.ts';
import { UNIT_DEFAULTS, ROLE_AGGRESSION } from './config.ts';
import { BASIC_STRATEGY_IDS } from './strategies.ts';
import { generateTeamName } from './names.ts';

// A scouted tendency: a strategy the opponent leans, and (for site-committing
// strategies) the site they favor. `site` is null for whole-map / reading
// strategies (Control / Hold / Pressure) where there's no A/B to read.
export type Lean = { strategy: string; site: 'A' | 'B' | null };
export type OpponentInfo = { name: string; atk: Lean; def: Lean };

// The club's early identity, chosen in the post-draft team talk. A small,
// bounded, season-long nudge to the player roster — flavor with a light edge.
export type ClubLean = 'aggressive' | 'disciplined' | 'composed';
const clamp100 = (n: number) => Math.max(0, Math.min(100, n));
// Apply the club lean to the player roster (called each match in buildSeasonMatch
// so it persists all season). Small +6 to the relevant lever; deterministic.
function applyClubLean(units: Unit[], lean: ClubLean | null | undefined): Unit[] {
  if (!lean) return units;
  return units.map((u) => {
    if (lean === 'aggressive') {
      const aggr = clamp100(ROLE_AGGRESSION[u.role] + 6);
      return { ...u, modifiers: { ...u.modifiers, aggression: aggr, baseAggression: aggr } };
    }
    if (lean === 'disciplined') return { ...u, attributes: { ...u.attributes, tenacity: clamp100(u.attributes.tenacity + 6) } };
    return { ...u, attributes: { ...u.attributes, composure: clamp100(u.attributes.composure + 6) } };
  });
}

// Which strategies actually commit to a site (so a site lean is meaningful).
const SITE_COMMITTING = new Set(['Rush', 'Execute', 'Stack', 'Mind_Games', 'Coordinated_Lockdown']);
const siteFor = (strategy: string, rng: ReturnType<typeof createRng>): 'A' | 'B' | null =>
  SITE_COMMITTING.has(strategy) ? (rng.next() < 0.5 ? 'A' : 'B') : null;

export type SeasonState = {
  playerRoster: Unit[];      // persisted identities, drafted once — carry the season
  schedule: Unit[][];        // one opponent roster per match
  opponents: OpponentInfo[]; // one identity (name + scoutable lean) per match
  results: ('W' | 'L')[];    // recorded outcomes, results.length === matches played
  idx: number;               // current match index (0-based)
  K: number;                 // number of matches in the season
  goal: number;              // match wins needed to "make it"
  seed: number;
  mapName: MapDefinition['name'];
  clubLean: ClubLean | null; // early identity from the post-draft team talk
};

// Re-place a roster of persisted identities at a team's spawns, resetting every
// per-match transient field (id/team/pos/facing/hp/state/modifiers) — mirrors
// startRound's fresh-unit construction so a carried roster starts each match
// clean while keeping its identity (attributes/traits/role/hero/weapon).
function placeRoster(identities: readonly Unit[], team: Team, map: MapDefinition): Unit[] {
  const side: 'defender' | 'attacker' = team === 'defenders' ? 'defender' : 'attacker';
  const spawns = map.spawns[team];
  const positions = placeSpawns(spawns, identities.length, side === 'defender' ? 1 : -1);
  const facing: Unit['facing'] = side === 'defender' ? 5 : 1;
  const prefix = team === 'defenders' ? 'D' : 'A';
  return identities.map((u, i) => ({
    ...u,
    id: `${prefix}${i + 1}`,
    team,
    pos: { ...positions[i] },
    facing,
    hp: UNIT_DEFAULTS.maxHp,
    maxHp: UNIT_DEFAULTS.maxHp,
    state: 'alive' as const,
    modifiers: {
      ...u.modifiers,
      aggression: ROLE_AGGRESSION[u.role],
      baseAggression: ROLE_AGGRESSION[u.role],
      retreatThresholdMod: 0,
    },
    cardFlags: {},
    directives: [],
  }));
}

// Start a season: keep the drafted player roster + generate K opponent rosters.
export function startSeason(
  playerRoster: readonly Unit[],
  mapName: MapDefinition['name'],
  seed: number,
  K = 6,
  goal = 4,
): SeasonState {
  const schedule: Unit[][] = [];
  const opponents: OpponentInfo[] = [];
  // Leans are drawn from the basics (always unlocked) so the read is always
  // counterable; the tutorial opponent (match 1) is forced to match its script.
  const ATK_LEANS = ['Execute', 'Rush', 'Control'];
  const DEF_LEANS = ['Hold', 'Stack', 'Pressure'];
  for (let m = 0; m < K; m++) {
    const oppRng = createRng((seed ^ ((m + 1) * 0x85ebca6b)) >>> 0);
    // Match the player roster size (the draft fills a full team) so every match
    // is balanced N-v-N.
    schedule.push(generatePool(oppRng).slice(0, playerRoster.length));
    const leanRng = createRng((seed ^ ((m + 1) * 0x27d4eb2f)) >>> 0);
    const name = generateTeamName(leanRng);
    if (m === 0) {
      // The tutorial team — its lean mirrors the hard script (Rush A / Hold) so
      // the Scout's read matches what the player will actually face.
      opponents.push({ name, atk: { strategy: 'Rush', site: 'A' }, def: { strategy: 'Hold', site: null } });
    } else {
      const atkS = leanRng.pick(ATK_LEANS);
      const defS = leanRng.pick(DEF_LEANS);
      opponents.push({
        name,
        atk: { strategy: atkS, site: siteFor(atkS, leanRng) },
        def: { strategy: defS, site: siteFor(defS, leanRng) },
      });
    }
  }
  return { playerRoster: [...playerRoster], schedule, opponents, results: [], idx: 0, K, goal, seed, mapName, clubLean: null };
}

// Progressive strategy unlock across the campaign's opening matches. The new
// manager starts on the basics, then earns the advanced reads:
//   match 1 (idx 0) — the six basics only;
//   match 2 (idx 1) — adds Mind Games (the first fake/read, both sides);
//   match 3+ (idx ≥ 2) — everything the map offers.
// (In the full game these gate on roster/attribute/narrative progress; until
// that unlock system exists, the campaign hard-codes this teaching ramp.)
// Returns null = no restriction. Consumed by the strategy menu (cardPanel) AND
// the AI picker (aiOpponent), so the opponent ramps up with the player.
export function unlockedStrategiesForMatch(idx: number): readonly string[] | null {
  if (idx <= 0) return BASIC_STRATEGY_IDS;
  if (idx === 1) return [...BASIC_STRATEGY_IDS, 'Mind_Games'];
  return null;
}

// The campaign's first match faces a telegraphed opponent so the read → counter
// loop is learnable: it Rushes one site head-on while attacking (meet it with
// Stack / Hold) and sits in an even Hold while defending (out-read it). Returns
// null for every later match → the normal weighted picker. Consumed by
// aiOpponent.pickAiStrategy.
export function scriptedOpponentForMatch(idx: number): Partial<Record<Side, string>> | null {
  if (idx !== 0) return null;
  return { attacker: 'Rush', defender: 'Hold' };
}

// Build the current match's GameState from the persisted player roster + the
// current opponent, re-placed on the season's map. Deterministic per match idx.
// Also stamps the per-match strategy unlock set + scripted opponent (the
// campaign teaching ramp); both carry across rounds via the startRound spread.
export function buildSeasonMatch(season: SeasonState, map: MapDefinition): GameState {
  const player = applyClubLean(placeRoster(season.playerRoster, 'defenders', map), season.clubLean);
  const opp = placeRoster(season.schedule[season.idx], 'attackers', map);
  const matchSeed = (season.seed ^ ((season.idx + 1) * 0x9e3779b1)) >>> 0;
  const base = buildStateFromUnits([...player, ...opp], map, matchSeed, 'season');
  // Stamp the opponent's identity + scoutable lean (per side) so pickAiStrategy
  // and variantWeights bias toward it and the Scout can read it from round 1.
  const info = season.opponents[season.idx];
  return {
    ...base,
    unlockedStrategyIds: unlockedStrategiesForMatch(season.idx),
    scriptedAiStrategy: scriptedOpponentForMatch(season.idx),
    opponentName: info?.name,
    opponentLean: info ? { attacker: info.atk, defender: info.def } : undefined,
  };
}

// Record a match result and advance to the next match.
export function recordSeasonResult(season: SeasonState, playerWon: boolean): SeasonState {
  return { ...season, results: [...season.results, playerWon ? 'W' : 'L'], idx: season.idx + 1 };
}

export function seasonOver(season: SeasonState): boolean {
  return season.idx >= season.K;
}
export function seasonWins(season: SeasonState): number {
  return season.results.reduce((n, r) => n + (r === 'W' ? 1 : 0), 0);
}
export function seasonMadeGoal(season: SeasonState): boolean {
  return seasonWins(season) >= season.goal;
}
