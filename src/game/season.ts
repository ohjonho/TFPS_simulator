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
import { UNIT_DEFAULTS, ROLE_AGGRESSION, AI_COMPETENCE, LEADER } from './config.ts';
import { BASIC_STRATEGY_IDS, setCustomStrategies, type Strategy } from './strategies.ts';
import { buildSignaturePlays, signatureMeta } from './signaturePlays.ts';
import { generateTeamName } from './names.ts';
import { teamRating } from './ratings.ts';

// A scouted tendency: a strategy the opponent leans, and (for site-committing
// strategies) the site they favor. `site` is null for whole-map / reading
// strategies (Control / Hold / Pressure) where there's no A/B to read.
export type Lean = { strategy: string; site: 'A' | 'B' | null };
// `signatureIds` (B2.2) — custom signature plays this opponent is "known for".
// Registered for the match in buildSeasonMatch; the matching-side lean points at
// one so the opponent actually deploys it and the Scout can read + counter it.
export type OpponentInfo = { name: string; atk: Lean; def: Lean; signatureIds?: string[] };

// Part 6 (season meta-loop) — the sub-week cursor. A week runs
// training → preEvent → match → postEvent, with a one-off `break` between the
// two halves. Drives which screen main.ts shows; persisted so an autosave can
// resume mid-week. `idx` still counts matches (advanced by recordSeasonResult
// after the match), so during postEvent/break idx already points past the
// just-played match — see currentWeek().
export type SeasonPhase = 'training' | 'preEvent' | 'match' | 'postEvent' | 'break';

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

// Pre-season club upgrades (tiny budget, pick up to 2). Each is a small, bounded,
// season-long attribute bump applied to the player roster — the "spend on the
// club" lever, kept light (no full economy yet).
export type UpgradeId = 'rigs' | 'coach' | 'bootcamp' | 'lounge';
export const UPGRADE_BUDGET = 2;
export const UPGRADES: { id: UpgradeId; name: string; desc: string }[] = [
  { id: 'rigs', name: 'New rigs', desc: 'Top-spec PCs + monitors. Sharper shooting (+Mechanics).' },
  { id: 'coach', name: 'Assistant coach', desc: 'A film-room veteran. Better reads & positioning (+Game Sense).' },
  { id: 'bootcamp', name: 'Pre-season bootcamp', desc: 'Drills under pressure. Sticks to the plan (+Discipline).' },
  { id: 'lounge', name: 'Team lounge', desc: 'A room to decompress. Steadier under stress (+Improvisation).' },
];
function applyUpgrades(units: Unit[], ids: readonly string[]): Unit[] {
  if (!ids.length) return units;
  const set = new Set(ids);
  return units.map((u) => {
    const a = { ...u.attributes };
    if (set.has('rigs')) { a.aim = clamp100(a.aim + 4); a.headshot = clamp100(a.headshot + 4); }
    if (set.has('coach')) { a.vision = clamp100(a.vision + 4); a.mapIQ = clamp100(a.mapIQ + 4); }
    if (set.has('bootcamp')) a.tenacity = clamp100(a.tenacity + 4);
    if (set.has('lounge')) a.composure = clamp100(a.composure + 4);
    return { ...u, attributes: a };
  });
}

// Per-match prep chosen on the Match Prep screen (before each match). Applies a
// match-only adjustment to the player roster on top of the season-long lean +
// upgrades. The win-outlook estimate on the prep screen reflects these.
export type PlayStyle = 'cautious' | 'standard' | 'aggressive';
export type TeamTalk = 'fire' | 'calm' | 'focus';
export type MatchPrep = { playStyle: PlayStyle; leaderId: string | null; teamTalk: TeamTalk };

function applyMatchPrep(units: Unit[], prep: MatchPrep): Unit[] {
  // Shotcaller: the leader's OWN Leadership (comms) lifts the whole squad's comms.
  // Read before any modification; a high-Leadership leader helps everyone, a poor
  // one is a mild drag. Pick your best communicator.
  const leader = units.find((u) => u.id === prep.leaderId);
  const teamComms = leader
    ? Math.max(LEADER.minBonus, Math.min(LEADER.maxBonus, Math.round((leader.attributes.comms - 50) * LEADER.teamCommsPerPoint)))
    : 0;
  return units.map((u) => {
    const m = { ...u.modifiers };
    const a = { ...u.attributes };
    let aggrDelta = 0;
    if (prep.playStyle === 'cautious') aggrDelta -= 8;
    if (prep.playStyle === 'aggressive') aggrDelta += 8;
    if (prep.teamTalk === 'fire') aggrDelta += 3;
    if (aggrDelta !== 0) { m.aggression = clamp100(m.aggression + aggrDelta); m.baseAggression = clamp100(m.baseAggression + aggrDelta); }
    if (prep.teamTalk === 'calm') a.composure = clamp100(a.composure + 3);
    if (prep.teamTalk === 'focus') a.tenacity = clamp100(a.tenacity + 3);
    if (teamComms !== 0) a.comms = clamp100(a.comms + teamComms); // shotcaller lifts the whole squad
    return { ...u, modifiers: m, attributes: a };
  });
}

// Team ratings for the Match Prep head-to-head (player roster WITH lean +
// upgrades baked in vs the scheduled opponent). Pure; for the player-facing read.
export function seasonRatings(season: SeasonState): { player: number; opp: number } {
  const player = applyUpgrades(applyClubLean([...season.playerRoster], season.clubLean), season.upgrades);
  return { player: teamRating(player), opp: teamRating(season.schedule[season.idx] ?? []) };
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
  upgrades: string[];        // pre-season club upgrades chosen on the dashboard
  // Part 6 — the season meta-loop. `phase` is the sub-week cursor (see
  // SeasonPhase); `weekEventMode` is the per-week event-pacing roll, precomputed
  // once at startSeason so the season replays identically. Both are plain data
  // (JSON-serializable) so the single-slot autosave snapshots them as-is.
  phase: SeasonPhase;
  weekEventMode: ('S' | 'R')[];
  // Part 6 (playbook gating) — authoring a play from scratch (the blank canvas)
  // is locked until the week-2 guided tutorial flips this. Adapting a built-in is
  // available from day 1 regardless. Capacity + route complexity gate separately
  // off roster Game Sense (see game/playbookGating.ts).
  authoringUnlocked: boolean;
  // Part 6 (training) — per-unit focus freshness (0..1, default 1). Drained by
  // focusing a player in training, recovered by resting them; gates the
  // focus-one-player bonus (see game/training.ts). Keyed by unit id.
  focusFreshness: Record<string, number>;
  // Part 6 (3c) — per-play mastery (0..1), keyed by authored play id. Raised by
  // drilling that play in Set-Pieces; stamped onto the match so its compliance
  // roll gets a bonus. Player plays only.
  playMastery: Record<string, number>;
  // Part 5 B0 — player-authored / adapted plays (the Playbook). Stored as live
  // Strategy objects (the season is in-memory only; Strategy is plain data, so a
  // future save system serializes them as-is). Registered into the strategy
  // resolver via setCustomStrategies in buildSeasonMatch. Empty until B1 lets the
  // player author one ⇒ matches stay byte-identical.
  customStrategies: Strategy[];
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
// Part 6 — precompute the per-week event-pacing sequence. Each week is either
// Structured (pre-event + a result-reactive post-event) or Random (both ambient).
// Base roll is 60% Structured, bounded two ways so streaks stay tight:
//   forward pity   — after a Random week, the next is forced Structured (never
//                    two Random in a row);
//   anti-streak    — after two Structured in a row, the next is forced Random
//                    (never three Structured).
// Together they settle near the nominal 60/40 with max streaks R≤1, S≤2. Seeded
// off the season seed (own stream — does NOT touch match RNG) so it replays.
export function buildWeekEventModes(seed: number, weeks: number): ('S' | 'R')[] {
  const rng = createRng((seed ^ 0x5bd1e995) >>> 0);
  const out: ('S' | 'R')[] = [];
  for (let w = 0; w < weeks; w++) {
    const last = out[w - 1];
    const prev = out[w - 2];
    let mode: 'S' | 'R';
    if (last === 'R') mode = 'S';                       // forward pity
    else if (last === 'S' && prev === 'S') mode = 'R';  // anti-streak
    else mode = rng.next() < 0.6 ? 'S' : 'R';
    out.push(mode);
  }
  return out;
}

export function startSeason(
  playerRoster: readonly Unit[],
  mapName: MapDefinition['name'],
  seed: number,
  K = 8,
  goal = 5,
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
      const opp: OpponentInfo = {
        name,
        atk: { strategy: atkS, site: siteFor(atkS, leanRng) },
        def: { strategy: defS, site: siteFor(defS, leanRng) },
      };
      // B2.2 — from match 3 on (idx ≥ 2, where the unlock ramp is lifted), the
      // opponent is "known for" a signature play: point the matching-side lean at
      // it so they actually deploy it and the Scout can read + counter it.
      if (m >= 2) {
        const sigs = signatureMeta();
        const sig = sigs[(m - 2) % sigs.length];
        opp.signatureIds = [sig.id];
        const lean: Lean = { strategy: sig.id, site: sig.siteCommitting ? (leanRng.next() < 0.5 ? 'A' : 'B') : null };
        if (sig.side === 'attacker') opp.atk = lean; else opp.def = lean;
      }
      opponents.push(opp);
    }
  }
  return {
    playerRoster: [...playerRoster], schedule, opponents, results: [], idx: 0, K, goal, seed, mapName,
    clubLean: null, upgrades: [], customStrategies: [],
    phase: 'training', weekEventMode: buildWeekEventModes(seed, K),
    authoringUnlocked: false, focusFreshness: {}, playMastery: {},
  };
}

// Part 6 — the week the player is currently in (1-based). `idx` counts matches
// and is advanced by recordSeasonResult AFTER the match, so during postEvent/
// break it already points past the just-played match; in those phases the
// current week is `idx`, otherwise `idx + 1`.
export function currentWeek(season: SeasonState): number {
  return season.phase === 'postEvent' || season.phase === 'break' ? season.idx : season.idx + 1;
}

// Part 6 — advance the sub-week cursor. Pure: only moves `phase` (idx is owned
// by recordSeasonResult). The mid-season break fires once, after the last match
// of the first half (idx === K/2) when the season isn't already over.
export function advanceSeasonPhase(season: SeasonState): SeasonState {
  const half = Math.floor(season.K / 2);
  let phase: SeasonPhase = season.phase;
  switch (season.phase) {
    case 'training':  phase = 'preEvent'; break;
    case 'preEvent':  phase = 'match'; break;
    case 'match':     phase = 'postEvent'; break;
    case 'postEvent': phase = season.idx === half && season.idx < season.K ? 'break' : 'training'; break;
    case 'break':     phase = 'training'; break;
  }
  return { ...season, phase };
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

// AI competence for a match (0–1) — how well the opponent uses its smart tools
// (the B2 counter to the player's signature + how reliably it commits its own
// read/signature). Early opponents are dumber so a new manager can learn; it
// scales to full over the opening. The difficultyBase term (config) is the hook
// for a future campaign-difficulty picker. Consumed by aiOpponent.pickAiStrategy.
export function aiCompetenceForMatch(idx: number): number {
  const c = AI_COMPETENCE.start + AI_COMPETENCE.perMatch * idx + AI_COMPETENCE.difficultyBase;
  return Math.max(AI_COMPETENCE.min, Math.min(1, c));
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
export function buildSeasonMatch(season: SeasonState, map: MapDefinition, prep?: MatchPrep): GameState {
  // B0/B2.2 — make this season's authored plays + the current opponent's signature
  // book resolvable (strategyById/strategiesFor) for the whole match. Deterministic:
  // same season+idx → same set, set before any strategy resolution. Empty (no
  // authored plays, no signature opponent) is a no-op ⇒ byte-identical.
  const oppBook = buildSignaturePlays(map).filter((s) => season.opponents[season.idx]?.signatureIds?.includes(s.id));
  setCustomStrategies([...season.customStrategies, ...oppBook]);
  let player = applyUpgrades(applyClubLean(placeRoster(season.playerRoster, 'defenders', map), season.clubLean), season.upgrades);
  if (prep) player = applyMatchPrep(player, prep);
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
    aiCompetence: aiCompetenceForMatch(season.idx),
    // 3c — the player's drilled-play reliability bonuses (compliance roll reads this).
    playMastery: season.playMastery,
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
