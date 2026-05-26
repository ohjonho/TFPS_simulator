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
} from './types.ts';
import { createTeam } from './units.ts';
import { blankMove } from './movement.ts';
import { computeVisibility } from './vision.ts';
import { assignAttributes, pickRandomLoadout } from './attributes.ts';
import { createRng } from './rng.ts';
import { buildDeck, drawCards } from './cards.ts';
import { foundry } from '../maps/foundry.ts';
import { atoll } from '../maps/atoll.ts';
import type { MapDefinition } from './types.ts';
import { AI, RANDOMIZE_ATTRIBUTES, RNG_SEED_DEFAULT } from './config.ts';

// Pass E m5 — `mode` chooses between Standard (today's fixed loadouts + flat
// attributes via ATTRIBUTES.generation) and Randomize (seeded random
// loadouts via pickRandomLoadout + uniform [40, 60] attributes). `seed`
// drives BOTH the loadout pick AND the attribute assignment so the same
// (mode, seed, map) triple reproduces the same matchup deterministically.
export function buildInitialState(
  mapName: MapDefinition['name'] = 'Foundry',
  mode: MatchMode = 'standard',
  seed: number = RNG_SEED_DEFAULT,
): GameState {
  const map = mapName === 'Atoll' ? atoll : foundry;

  // Randomize mode: pre-roll team loadouts from the match seed before
  // createTeam runs. Standard mode falls through to LOADOUTS in units.ts.
  let defenderLoadouts: readonly ('shotgun' | 'rifle' | 'sniper')[] | undefined;
  let attackerLoadouts: readonly ('shotgun' | 'rifle' | 'sniper')[] | undefined;
  if (mode === 'randomize') {
    // Separate RNG streams per team so the defender loadout doesn't shift
    // the attacker stream when constraints change later.
    defenderLoadouts = pickRandomLoadout(createRng((seed ^ 0xdef10ad) >>> 0), map.spawns.defenders.length);
    attackerLoadouts = pickRandomLoadout(createRng((seed ^ 0xa7710ad) >>> 0), map.spawns.attackers.length);
  }
  const defenders = createTeam('defenders', map.spawns.defenders, defenderLoadouts);
  const attackers = createTeam('attackers', map.spawns.attackers, attackerLoadouts);
  const units = [...defenders, ...attackers];
  // Random trait/role/hero/handling assignment at match start (spec §10–13).
  // Pass E m5: in Randomize mode, override the attribute range to [40, 60]
  // (configurable via RANDOMIZE_ATTRIBUTES).
  const attrRng = createRng(seed);
  if (mode === 'randomize') {
    assignAttributes(units, attrRng, {}, { rangeOverride: RANDOMIZE_ATTRIBUTES });
  } else {
    assignAttributes(units, attrRng);
  }

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
  // hands replay identically. (Per team we derive a separate RNG stream so the
  // attacker deck doesn't depend on the defender's first.)
  // Pass E m5: derive from the match seed (was hardcoded to RNG_SEED_DEFAULT)
  // so Randomize mode's seed also drives the deck order.
  const defenderDeckRng = createRng((seed ^ 0xdec0de) >>> 0);
  const attackerDeckRng = createRng((seed ^ 0xa77ac4) >>> 0);
  const defenderDeck = drawCards(buildDeck(defenders, defenderDeckRng), 3, defenderDeckRng);
  const attackerDeck = drawCards(buildDeck(attackers, attackerDeckRng), 3, attackerDeckRng);
  const cards: Record<Team, TeamDeck> = {
    defenders: defenderDeck,
    attackers: attackerDeck,
  };
  const playedCard: Record<Team, PlayedCard | null> = { defenders: null, attackers: null };

  // Pass E m5: renamed `seed` -> `initial` to avoid shadowing the new
  // `seed: number` parameter (was a pre-existing variable name collision
  // exposed by the arg refactor).
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
