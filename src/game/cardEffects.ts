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
  // 1. Anchor Position (Sentinel directive): doubles Sentinel bonus when
  // stationary 3+ ticks. Pass C2 — no longer locks the unit to its current
  // (spawn) hex; it now follows the strategy's assignment and the bonus
  // fires wherever the Sentinel ends up holding. Strands-at-spawn problem
  // fixed; Sentinel can anchor mid/site/plant naturally per strategy.
  anchor_position: (state, played, _team) =>
    updateUnit(state, played.contributor, (u) => ({
      ...u,
      cardFlags: { ...u.cardFlags, anchorPosition: true },
    })),

  // 2. Reckless Push (Run-n-Gun directive): ignore retreat, +1 speed, +15 HR
  // moving (movement.ts + unit-ai.ts + combat.ts read the flag).
  reckless_push: (state, played) =>
    updateUnit(state, played.contributor, (u) => ({
      ...u,
      cardFlags: { ...u.cardFlags, recklessPush: true },
    })),

  // 3. Slow Flank (Lurker directive): perimeter pathfinding + Pass C2
  // invisibility — unit is filtered out of enemy AI's `enemiesVisibleTo`
  // until they fire OR proximity-check trips. tick.ts clears the flag on
  // fire; vision-filter handles proximity. True lurker identity.
  slow_flank: (state, played) =>
    updateUnit(state, played.contributor, (u) => ({
      ...u,
      cardFlags: { ...u.cardFlags, slowFlank: true, invisibleUntilFire: true },
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

  // 6. Trade Window (Clutch buff). Pass 9 m4 — when ANY teammate of the
  // contributor dies, tick.ts auto-marks the killer for 4 ticks and pushes a
  // +20 HR buff to every surviving teammate (vs the marked killer). Replaces
  // the old Last Stand "wait until last alive" model.
  trade_window: (state, played) =>
    updateUnit(state, played.contributor, (u) => ({
      ...u,
      cardFlags: { ...u.cardFlags, tradeWindowEnabled: true },
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

  // 8. Setup Play (Tactician directive): Tactician moves to chosen hex.
  // Pass C2 — drop the flank-angle gate; the named ally gets +20 HR all
  // round whenever they're within `allyRangeHexes` of the anchor. Simpler,
  // fires reliably. Anchor hex stored on ally's cardFlags.setupPlayAnchor
  // so combat.ts can range-check at shot time.
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
        cardFlags: { ...u.cardFlags, setupPlayBonus: true, setupPlayAnchor: target },
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

  // 10. Adapt (Specialist buff): Pass C2 — invokes a chosen role card's
  // handler on the Specialist AND grants a flat +10 HR for the round on top.
  // Two-layer effect: the role card brings tactical positioning/buffs; the
  // flat HR makes Adapt feel impactful even if the role card's effect is
  // niche (e.g. Setup Play with no good range target).
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
    const specialist = state.units.find((u) => u.id === played.contributor);
    if (!specialist) return state;
    const fallbackHex: HexCoord = specialist.pos;
    const allyId = played.secondaryTarget ??
      state.units.find((u) => u.team === team && u.id !== specialist.id)?.id;
    let s = handler(state, {
      ...played,
      target: roleCardId === 'spearhead' ? undefined : fallbackHex,
      secondaryTarget: allyId,
    }, team, rng);
    // Pass C2 — additional flat +10 HR buff for the Specialist, full round.
    const buffs = { ...s.buffs };
    buffs[played.contributor] = [
      ...(buffs[played.contributor] ?? []),
      {
        id: `adapt-${played.contributor}-${s.tick}`,
        source: 'adapt',
        hitPp: CARD_EFFECTS.adapt.allRoundHitPp,
        expiresAtTick: s.tick + CARD_EFFECTS.adapt.durationTicks,
      },
    ];
    s = { ...s, buffs };
    return s;
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

  // 13. Mark Target (Cursed buff). Pass 9 m3 — runtime trigger model: set a
  // pending flag on the contributor. tick.ts watches for their first tracked
  // enemy and converts the flag into an active mark_target effect on that
  // enemy. No pre-pick target; no effect registered yet.
  mark_target: (state, played) =>
    updateUnit(state, played.contributor, (u) => ({
      ...u,
      cardFlags: { ...u.cardFlags, markTargetPending: true },
    })),
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
          roundIndex: s.round,
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
