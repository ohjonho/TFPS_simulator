// Pass G — Draft phase: pool of 8 randomly-generated units, player and AI
// snake-pick 3 each (P-A-A-P-P-A), 2 leftovers discarded. Drafted units are
// then assigned to spawn slots and the match enters planning.
//
// Pure module — no DOM, no rendering. State transitions are produced as new
// GameState values. Deterministic given (seed, mapName, player picks).

import type {
  Attributes,
  DraftState,
  Facing,
  GameState,
  MapDefinition,
  Modifiers,
  Team,
  Unit,
  Weapon,
} from './types.ts';
import { DRAFT, RANDOMIZE_ATTRIBUTES, UNIT_DEFAULTS } from './config.ts';
import { rollUnitMeta } from './attributes.ts';
import { assignNames } from './names.ts';
import { createRng, type Rng } from './rng.ts';
import { buildStateFromUnits } from './state.ts';
import { placeSpawns } from './units.ts';

// Pointy-top facing index. Defenders look down-right, attackers look up-right —
// the spawn-frame cones point toward the enemy half. Movement overrides this
// on the first step (same convention as units.ts).
const DEFENDER_FACING: Facing = 5;
const ATTACKER_FACING: Facing = 1;

// Construct a pool unit (P-prefixed id) with neutral defaults; `rollUnitMeta`
// fills in trait/role/hero/modifiers + the full 14-attribute record using the
// Randomize-mode [40, 60] uniform window.
function buildPoolUnit(slot: number, weapon: Weapon, rng: Rng): Unit {
  const u: Unit = {
    id: `P${slot + 1}`,
    name: '',                                // placeholder; assignNames fills it in generatePool
    team: 'defenders',                       // placeholder; reset at finalizeDraft
    weapon,
    pos: { col: -1, row: -1 },               // placeholder; reset at finalizeDraft
    hp: UNIT_DEFAULTS.maxHp,
    maxHp: UNIT_DEFAULTS.maxHp,
    facing: DEFENDER_FACING,                 // placeholder; reset at finalizeDraft
    state: 'alive',
    tacticalTraits: [],
    personality: null,
    role: 'Specialist',
    preferredRole: 'Specialist',
    hero: 'Angelic',
    modifiers: { aggression: 50, baseAggression: 50, offPosition: false, retreatThresholdMod: 0 } as Modifiers,
    attributes: {} as Attributes,            // filled by rollUnitMeta
    cardFlags: {},
    directives: [],
  };
  rollUnitMeta(u, rng, {}, RANDOMIZE_ATTRIBUTES);
  return u;
}

// Rifle-weighted draw pool — a roster fields four riflers + one sniper, so the
// pool should offer enough rifles to build that (an unweighted pool rolled
// sniper-heavy, leaving the player short of riflers). Rifle 3× → ~60% rifle;
// the minPerWeapon floor still guarantees ≥2 sniper/shotgun for variety.
const POOL_BIAS: readonly Weapon[] = ['rifle', 'rifle', 'rifle', 'sniper', 'shotgun'];

// Pick `n` weapons from the biased pool, resampling until the soft composition
// constraint (≥ minPerWeapon of each weapon) is met or maxRetries elapse.
// Deterministic given the rng.
function pickPoolLoadouts(rng: Rng, n: number): Weapon[] {
  const { minPerWeapon, maxComposeRetries } = DRAFT;
  for (let attempt = 0; attempt <= maxComposeRetries; attempt++) {
    const out: Weapon[] = [];
    for (let i = 0; i < n; i++) out.push(rng.pick(POOL_BIAS));
    // Check constraint: each weapon appears ≥ minPerWeapon times.
    const counts: Record<Weapon, number> = { shotgun: 0, rifle: 0, sniper: 0 };
    for (const w of out) counts[w]++;
    if (counts.shotgun >= minPerWeapon && counts.rifle >= minPerWeapon && counts.sniper >= minPerWeapon) {
      return out;
    }
    // Constraint failed — fall through to retry. After maxRetries we accept
    // the last attempt (cap prevents infinite loops at degenerate pool sizes;
    // at n=8, minPerWeapon=2 the constraint succeeds well within the cap).
    if (attempt === maxComposeRetries) return out;
  }
  // Unreachable; the loop returns above.
  return [];
}

// Build the pool of N units. Uses a single RNG so the pool generation is
// reproducible given seed alone.
export function generatePool(rng: Rng, n: number = DRAFT.poolSize): Unit[] {
  const loadouts = pickPoolLoadouts(rng, n);
  const units = loadouts.map((weapon, i) => buildPoolUnit(i, weapon, rng));
  assignNames(units, rng); // after the rolls — flavor only, no draw-order shift
  return units;
}

// Resolve the snake order ['P','A','A','P','P','A'] into actual teams given
// the player's team identity. Player = the user's `playerTeam` (defenders by
// default at match start).
function resolvePickOrder(playerTeam: Team): Team[] {
  const aiTeam: Team = playerTeam === 'defenders' ? 'attackers' : 'defenders';
  return DRAFT.snakeOrder.map((slot) => (slot === 'P' ? playerTeam : aiTeam));
}

// Draft variants. `playerOnly` (the campaign/season draft) drops the AI from
// the snake — the player simply picks their squad from a small pool, and the
// season generates opponents separately. `poolSize` / `picks` size that pool.
export type DraftOptions = {
  playerOnly?: boolean;
  poolSize?: number;
  picks?: number;
};

// Build the initial draft GameState (phase: 'draft', no spawned units). Lives
// here rather than in state.ts so the draft module owns its construction.
export function startDraft(map: MapDefinition, seed: number, opts: DraftOptions = {}): GameState {
  const poolSize = opts.poolSize ?? DRAFT.poolSize;
  const poolRng = createRng((seed ^ 0xd7af7000) >>> 0);
  const pool = generatePool(poolRng, poolSize);
  // Pass G — player team defaults to 'defenders' at match start (matches the
  // standard mode default). The snake order resolves against this.
  const playerTeam: Team = 'defenders';
  // Season draft = the player builds their own squad (no AI co-draft); the
  // standard/draft mode keeps the alternating snake.
  const pickOrder = opts.playerOnly
    ? Array.from({ length: opts.picks ?? DRAFT.picksPerTeam }, () => playerTeam)
    : resolvePickOrder(playerTeam);
  const draft: DraftState = {
    pool,
    pickOrder,
    picks: [],
    currentPickIdx: 0,
    autoMode: false,
  };
  // Minimal GameState shape: enough to render the topBar + draft overlay; the
  // sim fields (units, ai, buffs, visibility, etc.) are absent / empty until
  // finalizeDraft replaces this whole state with the buildStateFromUnits output.
  return {
    phase: 'draft',
    map,
    units: [],
    playback: { playing: false, speed: 1 },
    playerTeam,
    tick: 0,
    seed,
    targets: {},
    moves: {},
    visibility: { defenders: new Set(), attackers: new Set() },
    ghosts: { defenders: {}, attackers: {} },
    beliefs: { defenders: [], attackers: [] },
    scouting: { defenders: { a: 0, b: 0 }, attackers: { a: 0, b: 0 } },
    tracking: {},
    prevPos: {},
    ai: {},
    events: [],
    buffs: {},
    round: 1,
    scores: { defenders: 0, attackers: 0 },
    teamSide: { defenders: 'defender', attackers: 'attacker' },
    playerStrategy: null,
    playerVariantChoice: null,
    aiStrategy: null,
    roundResult: null,
    timeoutUsed: { defenders: false, attackers: false },
    aiStrategyWins: { defenders: {}, attackers: {} },
    strategyLean: { defenders: {}, attackers: {} },
    matchOver: false,
    matchWinner: null,
    // H3.4 — cards / playedCard fields removed; cardEffects starts empty
    // and is populated by applyStrategies (hero passives + synergies).
    cardEffects: [],
    plant: { planted: null, planting: null, defusing: null },
    prevPerUnitVisible: {},
    matchMode: 'draft',
    draft,
  };
}

// Whose turn is it? `null` when the draft is finished (currentPickIdx === N).
export function currentPicker(state: GameState): Team | null {
  if (!state.draft) return null;
  const { pickOrder, currentPickIdx } = state.draft;
  return currentPickIdx >= pickOrder.length ? null : pickOrder[currentPickIdx];
}

// Heuristic AI pick: greedy on Aim with a "must end with ≥ 1 rifle" floor.
// Deterministic given rng. Returns the picked unit id, or null if the pool is
// somehow empty (shouldn't happen with a well-formed draft).
export function aiPickHeuristic(state: GameState, aiTeam: Team, rng: Rng): string | null {
  if (!state.draft) return null;
  const { pool, picks } = state.draft;
  const pickedIds = new Set(picks.map((p) => p.unitId));
  const available = pool.filter((u) => !pickedIds.has(u.id));
  if (available.length === 0) return null;

  // Snapshot what the AI has so far.
  const aiHas = picks
    .filter((p) => p.pickerTeam === aiTeam)
    .map((p) => pool.find((u) => u.id === p.unitId))
    .filter((u): u is Unit => u !== undefined);
  const remainingPicksForAi = state.draft.pickOrder
    .slice(state.draft.currentPickIdx)
    .filter((t) => t === aiTeam).length;

  // Rule: if the AI has 0 rifles and this would be their final pick AND a
  // rifle exists in the available pool, prefer the highest-Aim rifle.
  const aiHasRifle = aiHas.some((u) => u.weapon === 'rifle');
  if (!aiHasRifle && remainingPicksForAi <= 1) {
    const availableRifles = available.filter((u) => u.weapon === 'rifle');
    if (availableRifles.length > 0) {
      const best = pickBestByAim(availableRifles, rng);
      return best.id;
    }
  }

  // Default: greedy on Aim; ties broken by a deterministic rng pick.
  const best = pickBestByAim(available, rng);
  return best.id;
}

function pickBestByAim(units: readonly Unit[], rng: Rng): Unit {
  let topAim = -Infinity;
  for (const u of units) if (u.attributes.aim > topAim) topAim = u.attributes.aim;
  const tied = units.filter((u) => u.attributes.aim === topAim);
  return rng.pick(tied);
}

// Commit a pick (player or AI) and advance the draft. If the next slot is an
// AI pick AND the draft isn't done, this cascades — AI picks resolve
// automatically until the next player slot or finalize. Pure: returns a new
// state with `draft` updated; does NOT call finalizeDraft (the caller does
// that when `currentPickIdx === pickOrder.length`).
export function commitDraftPick(state: GameState, unitId: string): GameState {
  if (!state.draft) return state;
  const { pool, picks, currentPickIdx, pickOrder } = state.draft;
  if (currentPickIdx >= pickOrder.length) return state;
  // Validate: unit must exist in the pool and not already be picked.
  const exists = pool.some((u) => u.id === unitId);
  const alreadyPicked = picks.some((p) => p.unitId === unitId);
  if (!exists || alreadyPicked) return state;

  const pickerTeam = pickOrder[currentPickIdx];
  let newDraft: DraftState = {
    ...state.draft,
    picks: [...picks, { pickerTeam, unitId }],
    currentPickIdx: currentPickIdx + 1,
  };
  let newState: GameState = { ...state, draft: newDraft };

  // Auto-cascade subsequent AI picks (and auto-mode player picks). The cascade
  // stops when the next picker is the human player AND autoMode is off, OR
  // when the draft completes.
  while (newDraft.currentPickIdx < newDraft.pickOrder.length) {
    const nextPicker = newDraft.pickOrder[newDraft.currentPickIdx];
    const aiTurn = nextPicker !== state.playerTeam;
    const playerAutoTurn = nextPicker === state.playerTeam && newDraft.autoMode;
    if (!aiTurn && !playerAutoTurn) break;

    // Pick RNG per-tick from seed + pickIdx so picks are reproducible.
    const pickRng = createRng((state.seed ^ 0xa1d10000 ^ newDraft.currentPickIdx) >>> 0);
    const picked = aiPickHeuristic(newState, nextPicker, pickRng);
    if (!picked) break;
    newDraft = {
      ...newDraft,
      picks: [...newDraft.picks, { pickerTeam: nextPicker, unitId: picked }],
      currentPickIdx: newDraft.currentPickIdx + 1,
    };
    newState = { ...newState, draft: newDraft };
  }
  return newState;
}

// Switch into auto-mode and immediately resolve all remaining picks. Returns
// a state with the draft completed (currentPickIdx === pickOrder.length).
export function autoDraft(state: GameState): GameState {
  if (!state.draft) return state;
  let newState: GameState = {
    ...state,
    draft: { ...state.draft, autoMode: true },
  };
  // Loop: if the next picker is auto (any), pick; else break. With autoMode on
  // both player and AI slots auto-resolve.
  while (newState.draft && newState.draft.currentPickIdx < newState.draft.pickOrder.length) {
    const nextPicker = newState.draft.pickOrder[newState.draft.currentPickIdx];
    const pickRng = createRng((newState.seed ^ 0xa1d10000 ^ newState.draft.currentPickIdx) >>> 0);
    const picked = aiPickHeuristic(newState, nextPicker, pickRng);
    if (!picked) break;
    const newDraft: DraftState = {
      ...newState.draft,
      picks: [...newState.draft.picks, { pickerTeam: nextPicker, unitId: picked }],
      currentPickIdx: newState.draft.currentPickIdx + 1,
    };
    newState = { ...newState, draft: newDraft };
  }
  return newState;
}

// All picks committed; assign drafted units to spawn slots and rebuild the
// match state via buildStateFromUnits. Drops `state.draft`, sets phase to
// 'planning'. Picks are grouped per team in pick order; unit i for each team
// goes to spawns[teamSide(team)][i].
export function finalizeDraft(state: GameState): GameState {
  if (!state.draft || state.draft.currentPickIdx < state.draft.pickOrder.length) {
    return state;
  }
  const { pool, picks } = state.draft;
  const { map, playerTeam, seed } = state;

  // Group picks by team in pick order; "defenders" / "attackers" identities
  // are preserved (the snake order resolved them at startDraft).
  const byTeam: Record<Team, string[]> = { defenders: [], attackers: [] };
  for (const p of picks) byTeam[p.pickerTeam].push(p.unitId);

  // Build the final units. Each team's i-th picked unit goes to that team's
  // i-th spawn slot. Re-ID to D1/A1 etc. Facing = side-appropriate default.
  const finalUnits: Unit[] = [];
  for (const team of ['defenders', 'attackers'] as const) {
    const idPrefix = team === 'defenders' ? 'D' : 'A';
    const facing = team === 'defenders' ? DEFENDER_FACING : ATTACKER_FACING;
    const spawns = team === 'defenders' ? map.spawns.defenders : map.spawns.attackers;
    const teamPickIds = byTeam[team];
    // Round-1 finalize: defenders north (forward +row), attackers south (−row).
    const positions = placeSpawns(spawns, teamPickIds.length, team === 'defenders' ? 1 : -1);
    for (let i = 0; i < teamPickIds.length; i++) {
      const poolUnit = pool.find((u) => u.id === teamPickIds[i]);
      if (!poolUnit) continue;
      if (i >= positions.length) break; // safety: shouldn't happen at 5 picks vs 5+ spawns
      finalUnits.push({
        ...poolUnit,
        id: `${idPrefix}${i + 1}`,
        team,
        pos: positions[i],
        facing,
        hp: poolUnit.maxHp,
        state: 'alive',
        cardFlags: {},
        directives: [],
      });
    }
  }

  // playerTeam carries through from the draft state. Mode stays 'draft' so
  // the UI knows this match was draft-generated (affects e.g. New Match
  // behavior in main.ts).
  const next = buildStateFromUnits(finalUnits, map, seed, 'draft');
  return { ...next, playerTeam };
}
