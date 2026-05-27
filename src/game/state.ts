// Builds the initial GameState: load Foundry, spawn both teams at the map's
// spawn hexes, default to planning phase at 1× paused, with empty movement
// orders, the deterministic seed set, and an initial visibility computed so the
// first frame already has fog populated.

import type {
  AiState,
  Buff,
  GameState,
  GhostEntry,
  HexCoord,
  MatchMode,
  MoveState,
  PlayedCard,
  Side,
  Team,
  TeamDeck,
  TrackEntry,
  Unit,
} from './types.ts';
import { createTeam } from './units.ts';
import { blankMove } from './movement.ts';
import { computeVisibility } from './vision.ts';
import { assignAttributes } from './attributes.ts';
import { createRng } from './rng.ts';
import { buildDeck, drawCards } from './cards.ts';
import { foundry } from '../maps/foundry.ts';
import { atoll } from '../maps/atoll.ts';
import type { MapDefinition } from './types.ts';
import { AI, RNG_SEED_DEFAULT } from './config.ts';
import { startDraft } from './draft.ts';

// Pass E m5 — `mode` chooses between Standard (today's fixed loadouts + flat
// attributes via ATTRIBUTES.generation) and Randomize (seeded random
// loadouts via pickRandomLoadout + uniform [40, 60] attributes). `seed`
// drives BOTH the loadout pick AND the attribute assignment so the same
// (mode, seed, map) triple reproduces the same matchup deterministically.
// Pass G — `'randomize'` renamed to `'draft'`; in draft mode this function
// returns a state with `phase: 'draft'` and units not yet assigned to spawns.
// The draft UI handles the pick flow and calls `finalizeDraft` (which uses
// buildStateFromUnits) to land in planning.
// H3.fix2 — Draft is the default mode now (Standard is kept as a debug
// option for forcing flat-50 attributes + fixed 2r+1s loadouts). The flip
// makes the first-load experience match the design thesis: roster
// composition matters from match 1.
export function buildInitialState(
  mapName: MapDefinition['name'] = 'Foundry',
  mode: MatchMode = 'draft',
  seed: number = RNG_SEED_DEFAULT,
): GameState {
  const map = mapName === 'Atoll' ? atoll : foundry;

  if (mode === 'draft') {
    // Pass G — pre-planning draft phase: generate an 8-unit pool, return a
    // state with no spawned units. The draft UI runs the picks and calls
    // finalizeDraft → buildStateFromUnits to start the match.
    return startDraft(map, seed);
  }

  // Standard mode: today's fixed-loadout assignment path.
  const defenders = createTeam('defenders', map.spawns.defenders);
  const attackers = createTeam('attackers', map.spawns.attackers);
  const units = [...defenders, ...attackers];
  const attrRng = createRng(seed);
  assignAttributes(units, attrRng);

  return buildStateFromUnits(units, map, seed, mode);
}

// Pass G — extracted from buildInitialState so finalizeDraft (in draft.ts)
// can produce a GameState from drafted-and-assigned units using the same
// init logic. Caller is responsible for: (1) creating the unit objects with
// the right spawn positions, ids, facings; (2) running assignAttributes (or
// rollUnitMeta per-unit, as the draft pool generator does).
export function buildStateFromUnits(
  units: Unit[],
  map: MapDefinition,
  seed: number,
  mode: MatchMode,
): GameState {
  const targets: Record<string, null> = {};
  const moves: Record<string, MoveState> = {};
  const tracking: Record<string, TrackEntry | null> = {};
  const prevPos: Record<string, HexCoord> = {};
  const ai: Record<string, AiState> = {};
  const buffs: Record<string, Buff[]> = {};
  for (const u of units) {
    targets[u.id] = null;
    moves[u.id] = blankMove(u.pos);
    tracking[u.id] = null;
    prevPos[u.id] = u.pos;
    ai[u.id] = initialAi();
    buffs[u.id] = [];
  }
  const ghosts: Record<Team, Record<string, GhostEntry>> = { defenders: {}, attackers: {} };
  // Match-flow defaults (Pass 7). The team named 'defenders' starts on the
  // defender side; halftime swaps these.
  const teamSide: Record<Team, Side> = { defenders: 'defender', attackers: 'attacker' };

  // Pass 8 — build each team's 9-card deck from their units' trait/role/hero,
  // then draw the 3-card starting hand. Deck shuffles use the seeded RNG so
  // hands replay identically.
  const defenders = units.filter((u) => u.team === 'defenders');
  const attackers = units.filter((u) => u.team === 'attackers');
  const defenderDeckRng = createRng((seed ^ 0xdec0de) >>> 0);
  const attackerDeckRng = createRng((seed ^ 0xa77ac4) >>> 0);
  const defenderDeck = drawCards(buildDeck(defenders, defenderDeckRng), 3, defenderDeckRng);
  const attackerDeck = drawCards(buildDeck(attackers, attackerDeckRng), 3, attackerDeckRng);
  const cards: Record<Team, TeamDeck> = {
    defenders: defenderDeck,
    attackers: attackerDeck,
  };
  const playedCard: Record<Team, PlayedCard | null> = { defenders: null, attackers: null };

  const initial: GameState = {
    phase: 'planning',
    map,
    units,
    playback: { playing: false, speed: 1 },
    playerTeam: 'defenders',
    tick: 0,
    seed,
    targets,
    moves,
    visibility: { defenders: new Set(), attackers: new Set() },
    ghosts,
    tracking,
    prevPos,
    ai,
    events: [],
    buffs,
    round: 1,
    scores: { defenders: 0, attackers: 0 },
    teamSide,
    playerStrategy: null,
    playerVariantChoice: null,
    aiStrategy: null,
    roundResult: null,
    timeoutUsed: { defenders: false, attackers: false },
    aiStrategyWins: { defenders: {}, attackers: {} },
    matchOver: false,
    matchWinner: null,
    cards,
    playedCard,
    cardEffects: [],
    plant: { planted: null, planting: null, defusing: null },
    prevPerUnitVisible: {},
    matchMode: mode,
  };

  const { visibility } = computeVisibility(initial);
  return { ...initial, visibility };
}

// Fresh AI state — starts moving (ticksSinceEnemySeen at the resume threshold so
// a unit heads to its region immediately).
export function initialAi(): AiState {
  return {
    mode: 'moving',
    firingTarget: null,
    ticksSinceEnemySeen: AI.resumeAfterTicks,
    shotClock: 0,
    stationaryTicks: 0,
    engagementTicks: 0,
    shotsThisEngagement: 0,
    lastFiredTick: -999,
    engageStickyTicks: 0,
  };
}

