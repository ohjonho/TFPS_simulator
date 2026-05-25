// Pass 9 — per-unit directive evaluators. Pure functions of
// (unit, state, prevAi, visibleEnemies); return a DirectiveDecision the tick
// loop merges with the legacy default-behavior tree. No mutation.
//
// Directives compose tactical behaviors that pre-Pass-9 strategies couldn't
// express ("hold this angle", "rotate when teammate spots", "trade for ally",
// "peek and retreat"). Strategies in `strategies.ts` and card handlers in
// `cardEffects.ts` populate `unit.directives`; the legacy tree fires only
// when no directive applies, keeping all existing behavior backward-compatible.

import type {
  AiState,
  Directive,
  DirectiveDecision,
  GameState,
  HexCoord,
  MapDefinition,
  Side,
  Unit,
} from './types.ts';
import { hexDistance } from './hex.ts';
import { findCoverHoldHex } from './unit-ai.ts';
import { regionCentroid } from './strategies.ts';

// Evaluate the unit's directives in priority order (higher first); the first
// directive that produces a non-null decision wins. Returns null when no
// directive applies — caller (tick.ts) falls back to the legacy decision tree.
export function evaluateDirectives(
  unit: Unit,
  state: GameState,
  prevAi: AiState,
  visibleEnemies: readonly Unit[],
): DirectiveDecision | null {
  if (!unit.directives || unit.directives.length === 0) return null;
  // Sort a copy so the field order in unit.directives doesn't change.
  const sorted = [...unit.directives].sort((a, b) => b.priority - a.priority);
  for (const d of sorted) {
    const decision = evaluateOne(d, unit, state, prevAi, visibleEnemies);
    if (decision) return decision;
  }
  return null;
}

function evaluateOne(
  d: Directive,
  unit: Unit,
  state: GameState,
  prevAi: AiState,
  visibleEnemies: readonly Unit[],
): DirectiveDecision | null {
  switch (d.kind) {
    case 'hold_angle':
      return holdAngle(d, unit);

    case 'safe_sniper':
      return safeSniper(d, unit, state, prevAi, visibleEnemies);

    case 'rotate_on_team_contact':
      return rotateOnTeamContact(d, unit, state);

    case 'trade_for':
      return tradeFor(d, unit, state);

    case 'peek_and_retreat':
      return peekAndRetreat(d, unit, state, prevAi);

    case 'commit_site':
      return commitSite(d, unit, state, visibleEnemies);
  }
}

// --- hold_angle ------------------------------------------------------------
// Provide the facing direction once the unit settles. Movement to the strategy
// region is delegated to the legacy tree (region → move → hold). Returning
// target: unit.pos here would lock the unit at spawn — that bug bit Pass 9 mB.

function holdAngle(
  d: Extract<Directive, { kind: 'hold_angle' }>,
  _unit: Unit,
): DirectiveDecision {
  return {
    facing: d.facingHex,
    source: 'hold_angle',
  };
}

// --- safe_sniper -----------------------------------------------------------
// Hold sightline toward angleHex. After firing `repositionAfterShots` shots
// this engagement, BFS to the nearest cover hex within `repositionRadius` and
// re-establish hold there. Pure: reads shotsThisEngagement from prevAi; the
// caller (tick.ts) is responsible for the actual relocation via movement.

function safeSniper(
  d: Extract<Directive, { kind: 'safe_sniper' }>,
  unit: Unit,
  state: GameState,
  prevAi: AiState,
  visibleEnemies: readonly Unit[],
): DirectiveDecision {
  // Reposition trigger: if we've fired enough shots THIS engagement and the
  // engagement is over (no visible enemies), relocate to nearby cover. The
  // legacy tree would otherwise just keep the unit at its current hex.
  const shouldReposition = prevAi.shotsThisEngagement >= d.repositionAfterShots;
  if (shouldReposition && visibleEnemies.length === 0) {
    const cover = findCoverHoldHex(unit, state.map);
    return { target: cover, facing: d.angleHex, source: 'safe_sniper' };
  }
  // Default: don't override target — the legacy tree handles "go to region,
  // hold once there." Just provide the facing angle.
  return { facing: d.angleHex, source: 'safe_sniper' };
}

// --- rotate_on_team_contact ------------------------------------------------
// If any watched ally has tracking on an enemy, after `delayTicks` re-target
// toward rotateToHex. Until then (or if no watched ally has tracking), null —
// other directives or the legacy tree take over.

function rotateOnTeamContact(
  d: Extract<Directive, { kind: 'rotate_on_team_contact' }>,
  _unit: Unit,
  state: GameState,
): DirectiveDecision | null {
  // Are any watched allies actively tracking an enemy?
  let allyContactTicks = 0;
  for (const allyId of d.watchAllies) {
    const t = state.tracking[allyId];
    if (!t) continue;
    // ticksLost = 0 means currently seen; we treat any tracked enemy as
    // "contact." Use 1 + ticksLost as the "ticks since contact was acquired"
    // since we don't separately track acquisition; close enough for v0.
    if (t.ticksLost === 0) {
      allyContactTicks = Math.max(allyContactTicks, 1);
    }
  }
  if (allyContactTicks < 1) return null;
  // For v0, fire as soon as contact is detected if delayTicks <= 1; otherwise
  // wait until the team has had contact for delayTicks ticks (we approximate
  // via a simple "wait at least delayTicks since round start" check).
  if (state.tick < d.delayTicks) return null;
  return { target: d.rotateToHex, source: 'rotate_on_team_contact' };
}

// --- trade_for -------------------------------------------------------------
// For `windowTicks` after `allyId` fires or dies, engage their last
// firingTarget if visible. We don't override target hex (let the unit move
// naturally); we override engagement via visibility of the marked enemy.

function tradeFor(
  d: Extract<Directive, { kind: 'trade_for' }>,
  _unit: Unit,
  state: GameState,
): DirectiveDecision | null {
  const allyAi = state.ai[d.allyId];
  if (!allyAi) return null;
  // Did the ally fire recently?
  const sinceFire = state.tick - allyAi.lastFiredTick;
  if (sinceFire < 0 || sinceFire > d.windowTicks) return null;
  // We don't currently override fire targeting (combat picks closest visible);
  // this directive's main effect comes via the +HR Trader-trait-like bonus
  // that strategies/cards may add separately. For v0 we leave the position
  // alone and the unit fires per default engage logic.
  return null;
}

// --- peek_and_retreat ------------------------------------------------------
// Alternate between peekHex (where the unit can see/be seen) and coverHex
// (safe). Cadence = ticks per oscillation half-cycle. Engagement allowed
// only when at peek; suppressed otherwise.

function peekAndRetreat(
  d: Extract<Directive, { kind: 'peek_and_retreat' }>,
  unit: Unit,
  state: GameState,
  _prevAi: AiState,
): DirectiveDecision {
  const phase = Math.floor(state.tick / Math.max(1, d.cadenceTicks)) % 2;
  const wantHex = phase === 0 ? d.peekHex : d.coverHex;
  const atPeek = hexDistance(unit.pos, d.peekHex) === 0;
  const suppressEngage = !atPeek;
  return {
    target: wantHex,
    facing: d.peekHex,
    suppressEngage,
    source: 'peek_and_retreat',
  };
}

// --- commit_site -----------------------------------------------------------
// Move to siteHex; don't leave unless contact appears in named regions. For
// v0 the "leave" condition is informational (no override yet) — the directive
// just biases the unit to head to its assigned site even if it sees an enemy
// outside the site.

function commitSite(
  d: Extract<Directive, { kind: 'commit_site' }>,
  unit: Unit,
  state: GameState,
  visibleEnemies: readonly Unit[],
): DirectiveDecision {
  // If we see an enemy OUTSIDE our named regions, suppress engage (commit to
  // moving). If the enemy is on our site, allow engage.
  const onSite = hexDistance(unit.pos, d.siteHex) <= 4;
  let suppressEngage = false;
  if (!onSite && visibleEnemies.length > 0) {
    const enemyInLeaveRegion = visibleEnemies.some((e) =>
      hexInAnyRegion(e.pos, d.leaveOnContactInRegions, state),
    );
    suppressEngage = !enemyInLeaveRegion;
  }
  return { target: d.siteHex, suppressEngage, source: 'commit_site' };
}

function hexInAnyRegion(hex: HexCoord, regions: readonly string[], state: GameState): boolean {
  for (const name of regions) {
    const cells = state.map.regions[name];
    if (!cells) continue;
    for (const h of cells) {
      if (h.col === hex.col && h.row === hex.row) return true;
    }
  }
  return false;
}

// --- DirectiveSpec → Directive resolution ----------------------------------
// Strategies author directive specs with symbolic hex/role references; we
// resolve them at applyStrategies time into concrete Directives with HexCoords
// and unit ids. Keeps strategy tables map-agnostic and portable.

// Symbolic reference to a hex on the map.
//   { region: 'a_site' }   → regionCentroid(map, 'a_site')
//   { spawn: 'enemy' }     → middle enemy-side spawn hex
//   { spawn: 'own' }       → middle own-side spawn hex
export type HexRef =
  | { region: string }
  | { spawn: 'enemy' | 'own' };

// Ally references in trade_for / rotate_on_team_contact are slot IDs (Pass A
// strategy review). Each strategy defines an ordered list of named slots
// ('site_anchor', 'mid_info', etc.); applyStrategies assigns each slot to a
// concrete unit on the team via assignSlots (weapon-aware). The resolver maps
// slot ID → unit ID via ctx.slotsToUnitIds.
export type DirectiveSpec =
  | { kind: 'hold_angle'; priority?: number; facing: HexRef }
  | { kind: 'safe_sniper'; priority?: number; angle: HexRef; repositionAfterShots?: number; repositionRadius?: number }
  | { kind: 'rotate_on_team_contact'; priority?: number; rotateTo: HexRef; watch: string[]; delayTicks?: number }
  | { kind: 'trade_for'; priority?: number; ally: string; windowTicks?: number }
  | { kind: 'peek_and_retreat'; priority?: number; peek: HexRef; cover?: HexRef; cadenceTicks?: number }
  | { kind: 'commit_site'; priority?: number; site: HexRef; leaveOnContactInRegions?: string[] };

export type ResolutionContext = {
  map: MapDefinition;
  side: Side;
  // Slot ID → assigned unit id. Built by applyStrategies after assignSlots
  // picks the loadout-best unit for each strategy slot.
  slotsToUnitIds: Record<string, string | undefined>;
};

export function resolveHexRef(ref: HexRef, ctx: ResolutionContext): HexCoord | null {
  if ('region' in ref) return regionCentroid(ctx.map, ref.region);
  // Spawn refs: 'own' = the team's current side spawn; 'enemy' = opposite.
  const ownKey = ctx.side === 'attacker' ? 'attackers' : 'defenders';
  const enemyKey = ctx.side === 'attacker' ? 'defenders' : 'attackers';
  const spawns = ctx.map.spawns[ref.spawn === 'own' ? ownKey : enemyKey];
  if (!spawns || spawns.length === 0) return null;
  return spawns[Math.floor(spawns.length / 2)];
}

// Resolve a DirectiveSpec into a Directive ready to plug into Unit.directives.
// Returns null when references can't be resolved (e.g. ally role not on team).
export function resolveDirectiveSpec(
  spec: DirectiveSpec,
  ctx: ResolutionContext,
): Directive | null {
  const priority = spec.priority ?? 50;
  switch (spec.kind) {
    case 'hold_angle': {
      const facing = resolveHexRef(spec.facing, ctx);
      if (!facing) return null;
      return { kind: 'hold_angle', priority, facingHex: facing };
    }
    case 'safe_sniper': {
      const angle = resolveHexRef(spec.angle, ctx);
      if (!angle) return null;
      return {
        kind: 'safe_sniper',
        priority,
        angleHex: angle,
        repositionAfterShots: spec.repositionAfterShots ?? 2,
        repositionRadius: spec.repositionRadius ?? 2,
      };
    }
    case 'rotate_on_team_contact': {
      const rotateTo = resolveHexRef(spec.rotateTo, ctx);
      if (!rotateTo) return null;
      const watchAllies: string[] = [];
      for (const slot of spec.watch) {
        const id = ctx.slotsToUnitIds[slot];
        if (id) watchAllies.push(id);
      }
      if (watchAllies.length === 0) return null;
      return {
        kind: 'rotate_on_team_contact',
        priority,
        rotateToHex: rotateTo,
        watchAllies,
        delayTicks: spec.delayTicks ?? 3,
      };
    }
    case 'trade_for': {
      const allyId = ctx.slotsToUnitIds[spec.ally];
      if (!allyId) return null;
      return {
        kind: 'trade_for',
        priority,
        allyId,
        windowTicks: spec.windowTicks ?? 4,
      };
    }
    case 'peek_and_retreat': {
      const peek = resolveHexRef(spec.peek, ctx);
      if (!peek) return null;
      // Cover defaults to own_spawn direction (1 hex back from peek).
      const cover = spec.cover ? resolveHexRef(spec.cover, ctx) : peek;
      if (!cover) return null;
      return {
        kind: 'peek_and_retreat',
        priority,
        peekHex: peek,
        coverHex: cover,
        cadenceTicks: spec.cadenceTicks ?? 4,
      };
    }
    case 'commit_site': {
      const site = resolveHexRef(spec.site, ctx);
      if (!site) return null;
      return {
        kind: 'commit_site',
        priority,
        siteHex: site,
        leaveOnContactInRegions: spec.leaveOnContactInRegions ?? [],
      };
    }
  }
}
