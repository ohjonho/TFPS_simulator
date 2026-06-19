// Per-unit directive evaluators (spec §7.3). Pure functions of
// (unit, state, prevAi, visibleEnemies); return a DirectiveDecision the
// tick loop merges with the default-behavior fallback tree. No mutation.
//
// Directives compose tactical behaviors strategies couldn't express in
// region-target form: "hold this angle", "rotate when teammate spots",
// "trade for ally", "peek and retreat", "commit to site". Strategies in
// `strategies.ts` populate `unit.directives` at round start; tick.ts
// evaluates them in priority order and falls back to the legacy
// behavior tree when no directive applies (or compliance fails).
//
// `compliancePct` is the per-tick adherence roll (spec §7.4): higher
// Tenacity/Composure + lower strategy threshold + less situational
// pressure → near-100% adherence; low values + demanding strategy +
// under-fire pressure → frequent breaks.

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
import type { Rng } from './rng.ts';
import { hexDistance } from './hex.ts';
import { findCoverHoldHex, nearestCellInRegion } from './unit-ai.ts';
import { regionCentroid, strategyById } from './strategies.ts';
import { BELIEF, CHANNEL_COMMIT, COMPLIANCE_TRAIT_DELTA } from './config.ts';
import { beliefInRegions } from './belief.ts';

// H3.2 — compliance formula tunables. Baseline 85% (most units mostly
// adhere); ±0.4 per Discipline pt; ±0.2 per Composure pt; demanding
// strategies (complianceThreshold > 50) penalize 0.5 per threshold pt above
// 50; enemy-visible situational pressure drops adherence by another 15pp.
//
// Clamp [5, 99] — even a maximally-undisciplined roster on a demanding
// strategy under pressure still has a 5% chance to comply each tick; max
// stays at 99% so a high-tail roster isn't a perfect strategy executor.
const COMPLIANCE = {
  baseline: 85,
  disciplineWeight: 0.4,
  composureWeight: 0.2,
  thresholdWeight: 0.5,
  enemyVisiblePressure: -15,
  min: 5,
  max: 99,
} as const;

// H3.2 — strategy adherence chance for this tick (0-100). Combat / vision
// math are unaffected; only directive evaluation gates on this.
export function compliancePct(
  unit: Unit,
  complianceThreshold: number,
  situationalPressure: number,
): number {
  const d = unit.attributes.tenacity;       // Discipline visible-aggregate = Tenacity sub (1:1)
  const c = unit.attributes.composure;
  let p = COMPLIANCE.baseline
    + COMPLIANCE.disciplineWeight * (d - 50)
    + COMPLIANCE.composureWeight  * (c - 50)
    - COMPLIANCE.thresholdWeight  * (complianceThreshold - 50)
    + situationalPressure;
  // v0.26.0 — per-trait freelance channel. A negative delta (e.g. Ego) makes the
  // unit break directives more often → falls through to the legacy tree. Summed
  // across the unit's three trait slots; absent traits contribute 0.
  for (const id of [...unit.tacticalTraits, unit.personality]) {
    if (id) p += COMPLIANCE_TRAIT_DELTA[id] ?? 0;
  }
  if (p < COMPLIANCE.min) p = COMPLIANCE.min;
  if (p > COMPLIANCE.max) p = COMPLIANCE.max;
  return p;
}

// v0.19.0 — commitment check for staying on a plant/defuse channel through
// retreat HP. Deterministic discipline gate (no roll): reuses the
// Tenacity/Composure compliance curve at a neutral strategy threshold under
// enemy-visible pressure. true → the unit holds the channel; false → it bails.
export function holdsChannelUnderRetreat(unit: Unit): boolean {
  return compliancePct(
    unit,
    CHANNEL_COMMIT.strategyThreshold,
    CHANNEL_COMMIT.underFirePressure,
  ) >= CHANNEL_COMMIT.minComplyPct;
}

// Look up the strategy assigned to the unit's team (player or AI side).
// Returns null when no strategy is committed yet (e.g. planning preview
// before Begin Round) — caller treats null as "no compliance gating".
function strategyForUnit(state: GameState, unit: Unit): { complianceThreshold: number } | null {
  const stratId = unit.team === state.playerTeam ? state.playerStrategy : state.aiStrategy;
  if (!stratId) return null;
  const side = state.teamSide[unit.team];
  const strat = strategyById(stratId, side, state.map);
  if (!strat) return null;
  return { complianceThreshold: strat.complianceThreshold ?? 50 };
}

// Evaluate the unit's directives in priority order (higher first); the first
// directive that produces a non-null decision wins. Returns null when no
// directive applies — caller (tick.ts) falls back to the legacy decision tree.
// H3.2 — optional `rng` performs a probabilistic compliance roll BEFORE
// the directive runs. Failure returns null (legacy tree fires), so a
// low-Discipline roster on a demanding strategy under pressure visibly
// freelances. Backward-compatible: omit `rng` to skip the roll entirely.
export function evaluateDirectives(
  unit: Unit,
  state: GameState,
  prevAi: AiState,
  visibleEnemies: readonly Unit[],
  rng?: Rng,
): DirectiveDecision | null {
  if (!unit.directives || unit.directives.length === 0) return null;

  // H3.2 — compliance gate. Only rolls when an rng is supplied AND the unit
  // has a committed strategy with a known compliance threshold. Caller
  // (tick.ts) is responsible for threading a seeded rng so the roll is
  // deterministic.
  if (rng) {
    const strat = strategyForUnit(state, unit);
    if (strat) {
      const pressure = visibleEnemies.length > 0 ? COMPLIANCE.enemyVisiblePressure : 0;
      const pct = compliancePct(unit, strat.complianceThreshold, pressure);
      if (!rng.chance(pct / 100)) return null;
    }
  }

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

    case 'read_and_commit':
      return readAndCommit(d, unit, state);
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
  unit: Unit,
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
  // Near-edge rotation: head to the cell of the destination site nearest THIS
  // unit, not the fixed far-corner centroid — so rotating defenders take the
  // short path to their side of the site and don't all funnel onto one hex
  // across the map. (No occupancy set here, but per-unit nearest already spreads
  // them since each arrives from a different bearing.) Gated to maps WITHOUT the
  // threat-matrix cell-scorer (mirrors the collapse near-edge fix): threat-
  // targeting maps like Foundry IV keep their centroid/scorer convergence
  // untouched. Centroid fallback.
  let target = d.rotateToHex;
  if (d.rotateToRegion && !state.map.threatTargeting) {
    const cells = state.map.regions[d.rotateToRegion];
    if (cells && cells.length > 0) {
      const near = nearestCellInRegion(cells, unit.pos, state.map, new Set());
      if (near) target = near;
    }
  }
  return { target, source: 'rotate_on_team_contact' };
}

// --- trade_for -------------------------------------------------------------
// For `windowTicks` after the watched `allyId` fires (or dies), converge on the
// teammate's fight so a follow-up peek can trade the duel. Movement only — the
// +HR side of trading is the Trader trait / Trade-Window mark, not here. Fair
// info: we steer toward the ALLY's own position (own-team), never the enemy's
// hidden location. Low priority (40), so this only fires for a unit whose
// higher-priority directives all declined this tick (a trade-primary slot); it
// never pulls a committed anchor / pusher / sniper off its job.

function tradeFor(
  d: Extract<Directive, { kind: 'trade_for' }>,
  _unit: Unit,
  state: GameState,
): DirectiveDecision | null {
  const allyAi = state.ai[d.allyId];
  if (!allyAi) return null;
  // Did the watched ally fire (or trade into a death) within the window?
  const sinceFire = state.tick - allyAi.lastFiredTick;
  if (sinceFire < 0 || sinceFire > d.windowTicks) return null;
  const ally = state.units.find((u) => u.id === d.allyId);
  if (!ally) return null;
  // Move toward the teammate's contact (their pos, or where they fell). Engage
  // is left to the normal gate once we arrive.
  return { target: { ...ally.pos }, source: 'trade_for' };
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
  // Retreat to the unit's assigned hold (local), NOT d.coverHex — which
  // defaulted to OWN SPAWN and yo-yo'd every peeker across the whole map (they
  // died in transit + left their position undefended). Falling back to the
  // assigned hold keeps peek a short, local pop-and-duck near its angle; the
  // authored coverHex stays only as a fallback when a unit has no target.
  const retreatHex = state.targets[unit.id] ?? d.coverHex;
  const wantHex = phase === 0 ? d.peekHex : retreatHex;
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

// --- read_and_commit -------------------------------------------------------
// The "read the defense" attacker mechanic, on the persistent belief store
// (belief.ts). The old version counted directly-seen + ghost-remembered
// defenders and was starved (a team rarely knows >2 of 5, and forgets in
// ticks); the store keeps a full, always-defined distribution with decay,
// negative evidence, and redistribution — so "which site is lighter?" always
// has an answer, at varying confidence. Commit to the plant of the lighter
// site once the believed-mass gap exceeds `margin` (in expected enemies);
// below it → null (no confident read; lower directives keep gathering). Fair
// info: the store is built from the team's own visibility only.

function readAndCommit(
  d: Extract<Directive, { kind: 'read_and_commit' }>,
  unit: Unit,
  state: GameState,
): DirectiveDecision | null {
  const weights = state.beliefs[unit.team];
  if (weights.length === 0) return null; // round start — store not advanced yet
  const a = beliefInRegions(weights, d.siteARegions, state.map);
  const b = beliefInRegions(weights, d.siteBRegions, state.map);
  if (Math.abs(a - b) < d.margin) return null;
  const site = a < b ? 'a' : 'b';
  return { target: site === 'a' ? d.plantAHex : d.plantBHex, source: 'read_and_commit' };
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
  | { kind: 'commit_site'; priority?: number; site: HexRef; leaveOnContactInRegions?: string[] }
  // Authoring is map-agnostic: the resolver fills the standard a_plant/b_plant
  // targets + a_site/b_site buckets. `margin` is the belief-mass gap (expected
  // enemies) required before committing; defaults to config.BELIEF.readMargin.
  | { kind: 'read_and_commit'; priority?: number; margin?: number };

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
        // Keep the region name so the resolver can pick the cell nearest the
        // rotating unit (near-edge) instead of the fixed centroid.
        ...('region' in spec.rotateTo ? { rotateToRegion: spec.rotateTo.region } : {}),
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
    case 'read_and_commit': {
      // Map-agnostic: standard plant targets + site buckets. Drop the directive
      // if either plant centroid is missing (caller falls back to legacy tree).
      const plantA = regionCentroid(ctx.map, 'a_plant');
      const plantB = regionCentroid(ctx.map, 'b_plant');
      if (!plantA || !plantB) return null;
      return {
        kind: 'read_and_commit',
        priority,
        plantAHex: plantA,
        plantBHex: plantB,
        siteARegions: ['a_site'],
        siteBRegions: ['b_site'],
        margin: spec.margin ?? BELIEF.readMargin,
      };
    }
  }
}
