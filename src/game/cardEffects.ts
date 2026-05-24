// Pass 8 — card effect handlers (spec §15.4). Pure. Called from match.ts
// `applyCards` AFTER `applyStrategies` so directive cards can override strategy-
// set targets. Each handler returns a new GameState with the card's setup
// applied (cardFlags, ActiveCardEffects, target overrides, registered buffs).
// Per-tick mechanics (auras, safe-window writes, crossfire trigger buff push,
// Spearhead delays) live in tick.ts and read these flags/effects.

import type {
  GameState,
  HexCoord,
  PlayedCard,
  Role,
  Team,
  Unit,
} from './types.ts';
import type { Rng } from './rng.ts';
import { CARD_EFFECTS } from './config.ts';
import { cardById } from './cardData.ts';

type Handler = (state: GameState, played: PlayedCard, team: Team, rng: Rng) => GameState;

const HANDLERS: Record<string, Handler> = {
  // 1. Anchor Position (Sentinel directive): hold spawn-side hex; doubles
  // Sentinel bonus (combat.ts checks cardFlags.anchorPosition).
  anchor_position: (state, played, _team) =>
    updateUnit(state, played.contributor, (u) => ({
      ...u,
      cardFlags: { ...u.cardFlags, anchorPosition: true },
    }), { lockTargetToPos: true }),

  // 2. Reckless Push (Run-n-Gun directive): ignore retreat, +1 speed, +15 HR
  // moving (movement.ts + unit-ai.ts + combat.ts read the flag).
  reckless_push: (state, played) =>
    updateUnit(state, played.contributor, (u) => ({
      ...u,
      cardFlags: { ...u.cardFlags, recklessPush: true },
    })),

  // 3. Slow Flank (Lurker directive): pathfind via the perimeter
  // (tick.ts/pathfind.ts swap algorithm based on the flag).
  slow_flank: (state, played) =>
    updateUnit(state, played.contributor, (u) => ({
      ...u,
      cardFlags: { ...u.cardFlags, slowFlank: true },
    })),

  // 4. Opening Pick (Entry buff): combat overrides Entry's bonus + skips post.
  opening_pick: (state, played) =>
    updateUnit(state, played.contributor, (u) => ({
      ...u,
      cardFlags: { ...u.cardFlags, openingPickActive: true },
    })),

  // 5. Crossfire (Trader buff): set eligibility; tick.ts pushes the actual
  // +25/5-tick buff when an ally fires.
  crossfire: (state, played) =>
    updateUnit(state, played.contributor, (u) => ({
      ...u,
      cardFlags: {
        ...u.cardFlags,
        crossfireEligible: true,
        crossfireBuffsApplied: 0,
      },
    })),

  // 6. Last Stand (Clutch buff): combat & vision read the flag.
  last_stand: (state, played) =>
    updateUnit(state, played.contributor, (u) => ({
      ...u,
      cardFlags: { ...u.cardFlags, lastStandActive: true },
    })),

  // 7. Spearhead (Vanguard directive): Vanguard flag + delay teammates.
  spearhead: (state, played, team) => {
    let s = updateUnit(state, played.contributor, (u) => ({
      ...u,
      cardFlags: { ...u.cardFlags, spearhead: true },
    }));
    const delayUntil = s.tick + CARD_EFFECTS.spearhead.allyDelayTicks;
    s = {
      ...s,
      units: s.units.map((u) =>
        u.team === team && u.id !== played.contributor
          ? { ...u, cardFlags: { ...u.cardFlags, delayedMoveUntilTick: delayUntil } }
          : u,
      ),
      cardEffects: [
        ...s.cardEffects,
        { kind: 'spearhead', team, vanguardId: played.contributor },
      ],
    };
    return s;
  },

  // 8. Setup Play (Tactician directive): Tactician moves to chosen hex first;
  // a named ally gets +20 HR on flank shots for a window.
  setup_play: (state, played, team) => {
    const target = played.target as HexCoord | undefined;
    const allyId = played.secondaryTarget;
    if (!target || !allyId) return state;
    let s = updateUnit(state, played.contributor, (u) => u, {
      forceTarget: target,
    });
    if (allyId !== played.contributor) {
      s = updateUnit(s, allyId, (u) => ({
        ...u,
        cardFlags: { ...u.cardFlags, setupPlayBonus: true },
      }));
    }
    const expiresAtTick = s.tick + CARD_EFFECTS.setupPlay.windowTicks;
    return {
      ...s,
      cardEffects: [
        ...s.cardEffects,
        { kind: 'setup_play', team, allyId, expiresAtTick },
      ],
    };
  },

  // 9. Hold the Line (Warden directive): Warden anchored at chosen hex;
  // allies arriving there get a safe window (tick.ts writes the per-unit flag).
  hold_the_line: (state, played, team) => {
    const target = played.target as HexCoord | undefined;
    if (!target) return state;
    const s = updateUnit(state, played.contributor, (u) => ({
      ...u,
      cardFlags: { ...u.cardFlags, holdTheLineAnchor: target },
    }), { forceTarget: target });
    return {
      ...s,
      cardEffects: [
        ...s.cardEffects,
        { kind: 'hold_the_line', team, anchorHex: target, anchorId: played.contributor },
      ],
    };
  },

  // 10. Adapt (Specialist buff): re-invokes a chosen role card's handler on
  // the Specialist. Player picks one of the role cards in their team's pool.
  adapt: (state, played, team, rng) => {
    const role = played.target as Role | undefined;
    if (!role) return state;
    const roleCardId =
      role === 'Vanguard' ? 'spearhead' :
      role === 'Tactician' ? 'setup_play' :
      role === 'Warden' ? 'hold_the_line' :
      null;
    if (!roleCardId) return state;
    const handler = HANDLERS[roleCardId];
    if (!handler) return state;
    // Forward the same played card, but route to the chosen role's handler.
    // For Setup Play / Hold the Line which need a hex target, the Specialist
    // re-uses the Specialist's current position as a fallback hex (best-effort
    // — for v0, Adapt-on-targeted-cards just doesn't need full UI re-pick).
    const specialist = state.units.find((u) => u.id === played.contributor);
    if (!specialist) return state;
    const fallbackHex: HexCoord = specialist.pos;
    const allyId = played.secondaryTarget ??
      state.units.find((u) => u.team === team && u.id !== specialist.id)?.id;
    return handler(state, {
      ...played,
      target: roleCardId === 'spearhead' ? undefined : fallbackHex,
      secondaryTarget: allyId,
    }, team, rng);
  },

  // 11. Guardian Aura (Angelic buff): register effect; tick.ts manages the
  // per-tick maxHp deltas as the source moves.
  guardian_aura: (state, played, team) => ({
    ...state,
    cardEffects: [
      ...state.cardEffects,
      {
        kind: 'guardian_aura',
        team,
        sourceId: played.contributor,
        radius: CARD_EFFECTS.guardianAura.radius,
      },
    ],
  }),

  // 12. Tactical Scan (Techy utility): register, vision.ts unions enemy hexes.
  tactical_scan: (state, _played, team) => ({
    ...state,
    cardEffects: [
      ...state.cardEffects,
      { kind: 'tactical_scan', team, expiresAtTick: state.tick + CARD_EFFECTS.tacticalScan.ticks },
    ],
  }),

  // 13. Mark Target (Cursed buff): register; combat.ts reads on each shot.
  mark_target: (state, played, team) => {
    const targetId = played.target as string | undefined;
    if (!targetId) return state;
    return {
      ...state,
      cardEffects: [
        ...state.cardEffects,
        { kind: 'mark_target', team, targetId },
      ],
    };
  },
};

// --- public entry point ----------------------------------------------------

// Apply both teams' played cards (after applyStrategies). Player team first
// then AI for determinism, though handlers don't conflict.
export function applyCards(state: GameState, rng: Rng): GameState {
  let s = state;
  for (const team of ['defenders', 'attackers'] as const) {
    const played = state.playedCard[team];
    if (!played) continue;
    const handler = HANDLERS[played.defId];
    if (!handler) continue;
    s = handler(s, played, team, rng);
    // Log a cardPlay event for the kill feed.
    s = {
      ...s,
      events: [
        ...s.events,
        {
          tick: s.tick,
          type: 'cardPlay',
          team,
          defId: played.defId,
          contributor: played.contributor,
          target:
            typeof played.target === 'string'
              ? played.target
              : played.target && 'col' in played.target
                ? played.target
                : undefined,
        },
      ],
    };
  }
  return s;
}

// --- helpers ---------------------------------------------------------------

// Update a single unit (immutable) and optionally adjust its target.
function updateUnit(
  state: GameState,
  unitId: string,
  fn: (u: Unit) => Unit,
  opts: { forceTarget?: HexCoord; lockTargetToPos?: boolean } = {},
): GameState {
  const units = state.units.map((u) => (u.id === unitId ? fn(u) : u));
  const targets = { ...state.targets };
  if (opts.forceTarget) targets[unitId] = opts.forceTarget;
  const unit = units.find((u) => u.id === unitId);
  if (opts.lockTargetToPos && unit) targets[unitId] = unit.pos;
  return { ...state, units, targets };
}

// Look up a played card's def (helper for UI; placed here to keep cardData
// imports central). Returns null on unknown id.
export function playedCardDef(played: PlayedCard) {
  return cardById(played.defId);
}
