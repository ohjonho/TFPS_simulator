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
import { assignAttributes } from './attributes.ts';
import { createRng } from './rng.ts';
import { buildDeck, drawCards } from './cards.ts';
import { foundry } from '../maps/foundry.ts';
import { atoll } from '../maps/atoll.ts';
import type { MapDefinition } from './types.ts';
import { AI, RNG_SEED_DEFAULT } from './config.ts';

export function buildInitialState(mapName: MapDefinition['name'] = 'Foundry'): GameState {
  const map = mapName === 'Atoll' ? atoll : foundry;
  const defenders = createTeam('defenders', map.spawns.defenders);
  const attackers = createTeam('attackers', map.spawns.attackers);
  const units = [...defenders, ...attackers];
  // Random trait/role/hero/handling assignment at match start (spec §10–13).
  assignAttributes(units, createRng(RNG_SEED_DEFAULT));

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
  const defenderDeckRng = createRng(RNG_SEED_DEFAULT ^ 0xdec0de);
  const attackerDeckRng = createRng(RNG_SEED_DEFAULT ^ 0xa77ac4);
  const defenderDeck = drawCards(buildDeck(defenders, defenderDeckRng), 3, defenderDeckRng);
  const attackerDeck = drawCards(buildDeck(attackers, attackerDeckRng), 3, attackerDeckRng);
  const cards: Record<Team, TeamDeck> = {
    defenders: defenderDeck,
    attackers: attackerDeck,
  };
  const playedCard: Record<Team, PlayedCard | null> = { defenders: null, attackers: null };

  const seed: GameState = {
    phase: 'planning',
    map,
    units,
    playback: { playing: false, speed: 1 },
    playerTeam: 'defenders',
    tick: 0,
    seed: RNG_SEED_DEFAULT,
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
    aiStrategy: null,
    roundResult: null,
    timeoutUsed: { defenders: false, attackers: false },
    aiStrategyWins: { defenders: {}, attackers: {} },
    matchOver: false,
    matchWinner: null,
    cards,
    playedCard,
    cardEffects: [],
  };

  const { visibility } = computeVisibility(seed);
  return { ...seed, visibility };
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
  };
}
