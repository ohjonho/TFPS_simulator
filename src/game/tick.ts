// Per-tick simulation step. Pure: takes a GameState, returns the next one.
//
// Pipeline:
//   1. Snapshot pre-tick positions (for stationary-sniper test).
//   2. Compute visibility (drives AI; what units act on at tick start).
//   3. Plant/defuse state update (may decide the round immediately).
//   4. Per-unit AI decision (directives + compliance roll → fallback tree).
//   5. Movement (advanceUnit along A* paths).
//   6. Fire/damage resolution (combat.resolveShot, seeded; simultaneous).
//   7. Recompute visibility + tracking + ghosts; tick down buffs.
//   8. Plant-defuse triggers + Mark Target + Trade Window post-checks.
//
// Determinism: per-tick RNG is `createRng(hashSeed(seed, tick))`, so the
// tick's outcome is independent of how many rolls earlier ticks consumed.

import type {
  AiState,
  Buff,
  GameEvent,
  GameState,
  HexCoord,
  HexKey,
  MoveState,
  PlantState,
  Team,
  Unit,
} from './types.ts';
import { advanceUnit } from './movement.ts';
import { findPath, findPerimeterPath, neighbors, passableAt } from './pathfind.ts';
import {
  computeVisibility,
  hexKey,
  isVisibleAlongLine,
  updateGhosts,
  updateTracking,
  visibleEnemiesByTeam,
} from './vision.ts';
import {
  bestHoldCellInRegion,
  findCoverHoldHex,
  findCoverWithLosTo,
  findThreatAwareHoldHex,
  nearestFacing,
  nearestWallRetreatHex,
  shouldRetreat,
} from './unit-ai.ts';
import { assessEngagement } from './engage.ts';
import { staticExposure, suspectedEnemyHexes, threatAt } from './threat.ts';
import { situationAggressionDelta } from './situation.ts';
import { traceTick, traceUnit } from './trace.ts';
import type { DecisionSource } from './trace.ts';
import { beliefInRegions, updateBeliefs } from './belief.ts';
import { evaluateDirectives, holdsChannelUnderRetreat } from './directives.ts';
import { resolveShot } from './combat.ts';
import type { ShotContextInput } from './combat.ts';
import { createRng } from './rng.ts';
import {
  AGGRESSION_PUSH_THRESHOLD,
  AI,
  ATTRIBUTES,
  CARD_EFFECTS,
  DEFENSIVE_COLLAPSE,
  DEFUSE_TICKS,
  DETONATION_TICKS,
  FIRE_RATE,
  HERO_ABILITIES,
  MIN_ROUND_TICKS_FOR_HOLD_END,
  PLANT_TICKS,
  POSITIONING,
  POST_PLANT_HUNT,
  ROTATE_AFTER_HOLD_TICKS,
  THREAT_TARGETING,
  THREAT_TARGETING_OVERRIDE,
  ROUND_TICK_LIMIT,
  SITUATION,
  STAY_ENGAGED_TICKS,
  TRAITS,
  UNIT_DEFAULTS,
} from './config.ts';
import { hexDistance, offsetToAxial } from './hex.ts';

export function stepTick(state: GameState): GameState {
  const tick = state.tick + 1;
  const events: GameEvent[] = [];
  const unitsById: Record<string, Unit> = {};
  for (const u of state.units) unitsById[u.id] = u;

  // 1. Vision at current positions drives AI sight (what each unit sees now).
  const { perUnit } = computeVisibility(state);

  const newAi: Record<string, AiState> = {};
  const nextMoves: Record<string, MoveState> = { ...state.moves };
  // Targets may shift mid-round when a unit cover-seeks (it commits to its new
  // cover hex so subsequent ticks don't pull it back to the strategy centroid).
  const nextTargets: Record<string, HexCoord | null> = { ...state.targets };
  const prevPos: Record<string, HexCoord> = {};
  // Work on a mutable copy of units (pos/facing updated by movement; hp/state
  // by combat).
  const working: Unit[] = state.units.map((u) => ({ ...u }));
  const workingById: Record<string, Unit> = {};
  for (const u of working) workingById[u.id] = u;
  // Pass 7.7 — per-tick occupancy: blocks a unit from moving into a hex still
  // held by another live unit. Updated as movement is applied below.
  const claimed = new Set<string>();
  for (const u of working) {
    if (u.state === 'alive') claimed.add(`${u.pos.col},${u.pos.row}`);
  }

  // H3.2 — per-tick RNG dedicated to directive compliance rolls. Separate
  // seed-hash (0xC0~) from the combat-fire RNG so the two streams don't
  // interleave; lets compliance behavior change independently of combat
  // determinism. Consumed in stable unit order below.
  const complianceRng = createRng(hashSeed(state.seed, tick) ^ 0xC011A11);
  // AI #2 — engagement-gate accept rolls. Separate stream again so the duel
  // commit decision is independent of combat/compliance determinism. Consumed
  // in stable unit order below.
  const engageRng = createRng(hashSeed(state.seed, tick) ^ 0xE17A6E);

  // Hoist the per-tick threat inputs once (stable across the tick) for the
  // threat-aware hold positioner below. staticExposure is map-cached; suspected
  // is computed per team. Both are pure/deterministic — no RNG, no per-unit
  // recompute. Only used when POSITIONING.enabled.
  const exposure = staticExposure(state.map);
  const suspectedByTeam: Record<Team, HexCoord[]> = {
    defenders: suspectedEnemyHexes(state, 'defenders'),
    attackers: suspectedEnemyHexes(state, 'attackers'),
  };

  // Pass F — post-plant retake coordination (hoisted once per tick). Designate
  // ONE defuser (the alive defender nearest the spike) so the rest can COVER
  // instead of all piling onto the hex, and precompute whether the plant is
  // contested (a defuse is blocked while any attacker stands on it). The lone
  // retaker was either dueling a step short of a clear spike, or solo-defusing
  // and getting traded one tick before completion. Pure/deterministic — no RNG.
  const defenderTeamId: Team =
    state.teamSide.defenders === 'defender' ? 'defenders' : 'attackers';
  let plantHexList: HexCoord[] = [];
  let plantClear = false;
  let defuserId: string | null = null;
  if (state.plant.planted) {
    const attackerTeamId: Team = defenderTeamId === 'defenders' ? 'attackers' : 'defenders';
    const psite = state.plant.planted.site;
    plantHexList = psite === 'A' ? state.map.sites.A.plantHexes : state.map.sites.B.plantHexes;
    const onPlant = (p: HexCoord) => plantHexList.some((h) => sameHex(h, p));
    // The defuser only commits onto the spike when no attacker stands on it (a
    // defuse is blocked otherwise); when contested it clears the angle first.
    plantClear = !working.some(
      (u) => u.team === attackerTeamId && u.state === 'alive' && onPlant(u.pos),
    );
    let bestD = Infinity;
    for (const u of working) {
      if (u.team !== defenderTeamId || u.state !== 'alive' || shouldRetreat(u).retreat) continue;
      let d = Infinity;
      for (const h of plantHexList) d = Math.min(d, hexDistance(u.pos, h));
      if (d < bestD) { bestD = d; defuserId = u.id; }
    }
  }

  // Tier 1 (v0.22.0) — defensive collapse-on-commit (pre-plant only; post-plant
  // the Pass F retake above owns it). The defense splits across two sites + mid
  // while attackers concentrate, so it reaches the contested site a man short.
  // Read the committed site from the defense's COLLECTIVE current vision —
  // attackers any alive defender can see, bucketed by site centroid — and pull
  // the off-site defenders onto it, keeping `minWatchers` nearest the quiet
  // site so a fake-and-switch can't walk in free. Pure/deterministic — no RNG.
  let collapseHex: HexCoord | null = null;
  let collapseSiteRegion: string | null = null;
  const collapseExempt = new Set<string>();
  if (!state.plant.planted) {
    const cenA = state.map.sites.A.centerHex;
    const cenB = state.map.sites.B.centerHex;
    const seenAtk = new Map<string, HexCoord>();
    for (const def of working) {
      if (def.team !== defenderTeamId || def.state !== 'alive') continue;
      for (const atk of enemiesVisibleTo(def, working, perUnit[def.id])) seenAtk.set(atk.id, atk.pos);
    }
    let nearA = 0;
    let nearB = 0;
    for (const pos of seenAtk.values()) {
      const dA = hexDistance(pos, cenA);
      const dB = hexDistance(pos, cenB);
      // Attribute each seen attacker to the site it's committing to — nearer
      // of the two, and within the (wide) read radius — so an attacker out in
      // the approach already counts, but mid traffic equidistant to both is not
      // double-counted toward a phantom commit.
      if (dA <= DEFENSIVE_COLLAPSE.readRadius && dA < dB) nearA++;
      else if (dB <= DEFENSIVE_COLLAPSE.readRadius && dB < dA) nearB++;
    }
    let collapseSite: 'A' | 'B' | null = null;
    if (nearA >= DEFENSIVE_COLLAPSE.commitThreshold && nearA > nearB) { collapseSite = 'A'; collapseHex = cenA; collapseSiteRegion = 'a_site'; }
    else if (nearB >= DEFENSIVE_COLLAPSE.commitThreshold && nearB > nearA) { collapseSite = 'B'; collapseHex = cenB; collapseSiteRegion = 'b_site'; }
    if (collapseSite) {
      const quietHex = collapseSite === 'A' ? cenB : cenA;
      const aliveDef = working
        .filter((u) => u.team === defenderTeamId && u.state === 'alive')
        .sort((a, b) => {
          const da = hexDistance(a.pos, quietHex);
          const db = hexDistance(b.pos, quietHex);
          return da !== db ? da - db : a.id.localeCompare(b.id);
        });
      for (let k = 0; k < Math.min(DEFENSIVE_COLLAPSE.minWatchers, aliveDef.length); k++) {
        collapseExempt.add(aliveDef[k].id);
      }
    }
  }

  // Phase 1.5 observability — per-tick belief/collapse record (no-op unless a
  // trace sink is installed by the harness; the thunk defers the site sums).
  traceTick(tick, collapseSiteRegion, suspectedByTeam.defenders.length, suspectedByTeam.attackers.length, () => ({
    defenders: {
      aSite: beliefInRegions(state.beliefs.defenders, ['a_site'], state.map),
      bSite: beliefInRegions(state.beliefs.defenders, ['b_site'], state.map),
    },
    attackers: {
      aSite: beliefInRegions(state.beliefs.attackers, ['a_site'], state.map),
      bSite: beliefInRegions(state.beliefs.attackers, ['b_site'], state.map),
    },
  }));

  // 2. AI decisions + 3. movement (per unit, stable order).
  for (const u of working) {
    prevPos[u.id] = u.pos;
    const prevAi = state.ai[u.id] ?? freshAi();
    if (u.state !== 'alive') {
      newAi[u.id] = prevAi;
      continue;
    }

    // AI #3 — fold the per-tick situational delta into aggression on top of the
    // round's base (role+strategy) value. Reassign modifiers (don't mutate the
    // shared object) so state.units stays untouched. This drives #2's engage
    // threshold + the push behavior, so man-count / timer / plant pressure shape
    // behavior without compounding across ticks.
    u.modifiers = {
      ...u.modifiers,
      aggression: Math.max(0, Math.min(100,
        u.modifiers.baseAggression + situationAggressionDelta(u, state, tick))),
    };

    const visibleEnemies = enemiesVisibleTo(u, working, perUnit[u.id]);
    const seesEnemy = visibleEnemies.length > 0;
    const ticksSinceEnemySeen = seesEnemy ? 0 : prevAi.ticksSinceEnemySeen + 1;

    // v0.19.0 — channel commitment. A unit already planting/defusing (committed
    // on a prior tick) that hits retreat HP holds the channel iff its discipline
    // clears the bar; otherwise it bails and is free to retreat-move (below).
    const isChanneling =
      state.plant.planting?.unitId === u.id || state.plant.defusing?.unitId === u.id;
    const retreat = shouldRetreat(u).retreat
      && !(isChanneling && holdsChannelUnderRetreat(u));
    // AI #2 — odds-based, trait-modulated engagement gate (replaces the binary
    // "any enemy visible → fight"). Picks the best target and decides whether
    // the duel is worth committing to; declining while exposed sets holdForSafety.
    const engage = assessEngagement(u, visibleEnemies, state, prevAi, engageRng, tick);

    // Pass 9 — evaluate per-unit directives. Survival (retreat) still trumps;
    // otherwise a directive can override engagement (suppressEngage), supply a
    // movement target, or set facing. Legacy default-behavior tree fires only
    // when the directive returns no useful decision.
    // H3.2 — pass the per-tick compliance RNG so low-Discipline units on
    // demanding strategies probabilistically break directive and fall
    // through to the legacy tree (the "freelance" path).
    const directiveDecision = retreat ? null
      : evaluateDirectives(u, state, prevAi, visibleEnemies, complianceRng);
    const directiveSuppressesEngage = directiveDecision?.suppressEngage === true;

    let mode: AiState['mode'];
    let firingTarget: string | null = null;
    let effectiveTarget: HexCoord | null = null;
    // Phase 1.5 observability — which cascade branch finalized this unit's
    // action (recorded via traceUnit below; assignment-only, no behavior).
    let targetSource: DecisionSource = 'hold';
    // Pass 9: directive-supplied facing override for hold modes (applied below
    // when face-on-hold runs).
    let directiveFacing: HexCoord | null = directiveDecision?.facing ?? null;

    // Pass 9 m2 — sticky-engage: if last tick was engaged but no enemy visible
    // this tick, persist `engaged` for up to STAY_ENGAGED_TICKS so the unit
    // doesn't flip-flop when an enemy steps behind a wall for one tick. The
    // firing loop already no-ops when firingTarget is missing/dead, so this is
    // a pure mode-stickiness change — no extra shots fire.
    const stickyEngage =
      !retreat &&
      !engage.engage &&
      !directiveSuppressesEngage &&
      prevAi.mode === 'engaged' &&
      prevAi.engageStickyTicks < STAY_ENGAGED_TICKS;

    if (retreat) {
      mode = 'retreating';
      effectiveTarget = nearestWallRetreatHex(u, state.map);
      targetSource = 'retreat';
    } else if (engage.engage && !directiveSuppressesEngage) {
      mode = 'engaged';
      firingTarget = engage.targetId;
      targetSource = 'engage';
    } else if (stickyEngage) {
      // Keep the previous engagement alive briefly. Keep the prior firingTarget
      // if it's still alive (combat will skip the shot if not), so a unit that
      // re-acquires next tick continues a clean engagement.
      mode = 'engaged';
      firingTarget = prevAi.firingTarget;
      targetSource = 'engage-sticky';
    } else if (directiveDecision?.target) {
      // Pass 9 — directive supplied a target. 'holding' when target === pos,
      // else 'moving'. Bypasses the legacy region/push/rotation tree below.
      effectiveTarget = directiveDecision.target;
      mode = sameHex(directiveDecision.target, u.pos) ? 'holding' : 'moving';
      targetSource = `directive:${directiveDecision.source ?? 'unknown'}`;
    } else if (ticksSinceEnemySeen >= AI.resumeAfterTicks) {
      const region = state.targets[u.id];
      if (region && !sameHex(u.pos, region)) {
        mode = 'moving';
        effectiveTarget = region;
        targetSource = 'region';
      } else if (!region && u.modifiers.aggression >= AGGRESSION_PUSH_THRESHOLD) {
        // No assigned region: high-aggression roles advance toward the enemy
        // spawn (lightweight role tendency; superseded by Pass 7 strategy).
        const push = enemyPushTarget(u, state);
        if (push && !sameHex(u.pos, push)) {
          mode = 'moving';
          effectiveTarget = push;
          targetSource = 'push';
        } else {
          mode = 'holding';
        }
      } else {
        mode = 'holding';
      }
    } else {
      // Recently lost sight (spec §7.1/§8). Pass 7.8 — reactive peek: if the
      // unit had a tracked enemy that just slipped out of view, advance
      // toward the last-known hex instead of standing still. Lets a unit
      // chase a fleeing target one step before the resume timer kicks in
      // and the region/holding branches take over. Tracking state from the
      // previous tick (ticksLost >= 1) is what indicates a fresh loss.
      const track = state.tracking[u.id];
      if (
        track &&
        track.ticksLost >= 1 &&
        passableAt(state.map, track.lastKnownHex) &&
        !sameHex(u.pos, track.lastKnownHex)
      ) {
        mode = 'moving';
        effectiveTarget = track.lastKnownHex;
        targetSource = 'track-chase';
      } else {
        mode = 'holding';
      }
    }

    // AI #2 — declined a fight while exposed: hold here (the cover-seek below
    // tucks to cover) instead of advancing into the angle. Retreat, an engaged
    // stick, and a committed directive move all still win; the plant-retake /
    // post-plant overrides downstream can still pull the unit when it matters.
    if (engage.holdForSafety && mode !== 'engaged' && mode !== 'retreating' && !directiveDecision?.target) {
      mode = 'holding';
      effectiveTarget = null;
      targetSource = 'hold-safety';
    }

    // Pass 7.7 — light stalemate breaker: a unit that's been idle for a long
    // stretch without seeing anyone re-targets to the mid centroid (where
    // contact is most likely). Applies to both sides equally.
    // F3 — shotguns are excluded from the mid push. Mid is the worst place
    // for them (open sightlines, dueling rifles/snipers at distances where
    // shotgun HR is 5%); they hold a tight angle instead and let the rest
    // of the team rotate.
    if (mode === 'holding'
        && ticksSinceEnemySeen >= ROTATE_AFTER_HOLD_TICKS
        && u.weapon !== 'shotgun') {
      const midGoal = midCentroid(state);
      if (midGoal && !sameHex(midGoal, u.pos)) {
        mode = 'moving';
        effectiveTarget = midGoal;
        nextTargets[u.id] = midGoal;
        targetSource = 'stalemate-mid';
      }
    }

    // Tier 1 (v0.22.0) — collapse onto the committed site (pre-plant). An
    // off-site defender abandons its static hold and converges on the read site
    // so the defense isn't a man short at the plant / retake. Engaged units keep
    // fighting; the quiet-site watcher(s) (collapseExempt) stay; retreat wins.
    // Targets the site centroid and releases once near it, so the legacy hold /
    // engage takes back over instead of pinning onto the exact hex pre-plant.
    if (collapseHex && !retreat && mode !== 'engaged'
      && u.team === defenderTeamId && !collapseExempt.has(u.id)
      && hexDistance(u.pos, collapseHex) > DEFENSIVE_COLLAPSE.siteRadius) {
      mode = 'moving';
      targetSource = 'collapse';
      let collapseTarget = collapseHex;
      // Threat-matrix target selection (THREAT_TARGETING): converge on the safest
      // good CELL of the contacted site — LoS to the attacker approach + cover —
      // instead of the raw site centroid. A/B-flagged; centroid fallback if no
      // cell qualifies. `claimed` spreads converging defenders across distinct cells.
      if ((THREAT_TARGETING_OVERRIDE ?? state.map.threatTargeting ?? false) && collapseSiteRegion) {
        const cells = state.map.regions[collapseSiteRegion];
        if (cells && cells.length > 0) {
          const team = u.team;
          const threatOf = (h: HexCoord) => threatAt(state, team, h, exposure, suspectedByTeam[team]);
          // Watch angle = the suspected-enemy mass (where the team reads the
          // attackers pouring into the site), NOT the distant enemy spawn — so the
          // chosen cell CONTESTS the breach instead of tucking toward a spawn-facing
          // corner. Fall back to the enemy spawn bearing if nothing is suspected yet.
          const susp = suspectedByTeam[team];
          let angleHex: HexCoord | null = enemySpawnForSide(u, state) ?? null;
          if (susp.length > 0) {
            let sc = 0;
            let sr = 0;
            for (const h of susp) { sc += h.col; sr += h.row; }
            angleHex = { col: Math.round(sc / susp.length), row: Math.round(sr / susp.length) };
          }
          const best = bestHoldCellInRegion(cells, state.map, claimed, threatOf, angleHex, {
            safety: THREAT_TARGETING.wSafety,
            los: THREAT_TARGETING.wLos,
            cover: THREAT_TARGETING.wCover,
            dist: THREAT_TARGETING.wDist,
          });
          if (best) {
            collapseTarget = best;
            targetSource = 'collapse-matrix';
          }
        }
      }
      effectiveTarget = collapseTarget;
      nextTargets[u.id] = collapseTarget;
    }

    // Pass F — coordinated defender retake on plant (was Pass B's "everyone
    // pile onto the spike", which produced zero defuses). One designated defuser
    // commits onto the spike; the rest take a covered angle with LoS to it and
    // trade for the defuser. The commit overrides engage/hold only when the
    // spike is clear of attackers (it can't be defused otherwise); contested,
    // the defuser clears the angle first. Retreat (HP 1) still wins.
    if (state.plant.planted && plantHexList.length > 0 && !retreat && u.team === defenderTeamId) {
      if (u.id === defuserId) {
        // Step 2 (v0.20.0) — an aggressive / Ego defuser clears the last attacker
        // BEFORE committing to the spike (a no-shoot defuser just dies on the hex
        // otherwise). While that hold applies, leave engage/hold as decided so the
        // unit fights its target; otherwise commit onto the spike as before.
        const huntFirst = postPlantHuntFirst(
          u, state, tick, seesEnemy, aliveTeamCount(working, u.team) === 1,
        );
        if (!huntFirst) {
          // Nearest plant hex. When clear, commit (override engage) and — once on
          // the hex — target self so movement is a no-op and the cover-seek can't
          // pull it back off the spike. When contested, approach and let engage
          // clear the blockers first.
          let goal = plantHexList[0];
          let gd = Infinity;
          for (const h of plantHexList) { const d = hexDistance(u.pos, h); if (d < gd) { gd = d; goal = h; } }
          const onPlant = plantHexList.some((h) => sameHex(h, u.pos));
          if (plantClear) {
            mode = 'moving';
            effectiveTarget = onPlant ? u.pos : goal;
          } else if (mode !== 'engaged') {
            mode = 'moving';
            effectiveTarget = goal;
          }
          nextTargets[u.id] = effectiveTarget ?? u.pos;
          targetSource = 'retake-defuse';
        }
      } else if (mode !== 'engaged') {
        // Coverer — hold a covered angle with LoS to the spike to trade for the
        // defuser, instead of crowding onto the hex.
        const center = plantHexList[Math.floor(plantHexList.length / 2)];
        const cover = findCoverWithLosTo(u, center, state.map, claimed);
        if (cover && !sameHex(u.pos, cover)) {
          mode = 'moving';
          effectiveTarget = cover;
          nextTargets[u.id] = cover;
          targetSource = 'retake-cover';
        }
      }
    }

    // Pass E m2 — post-plant attacker cover hold. Once the spike is down,
    // alive attackers not on the plant zone re-target to a cover-adjacent
    // hex within POST_PLANT_SEARCH_RADIUS of their current pos that has LoS
    // to the plant centroid — so they can kill defusers instead of
    // wandering pre-plant directives. Attackers already on the plant zone
    // stay put (they're covering the spike at point-blank). Engaged
    // attackers keep shooting (they're presumably already fighting a
    // defuser). Retreat (HP 1) still wins.
    if (state.plant.planted && !retreat && mode !== 'engaged') {
      const atkTeam: Team = state.teamSide.attackers === 'attacker' ? 'attackers' : 'defenders';
      if (u.team === atkTeam) {
        const site = state.plant.planted.site;
        const plantHexes = site === 'A' ? state.map.sites.A.plantHexes : state.map.sites.B.plantHexes;
        const onPlant = plantHexes.some((h) => sameHex(h, u.pos));
        if (!onPlant && plantHexes.length > 0) {
          const centroid = plantHexes[Math.floor(plantHexes.length / 2)];
          const coverHex = findCoverWithLosTo(u, centroid, state.map, claimed);
          if (coverHex && !sameHex(u.pos, coverHex)) {
            mode = 'moving';
            effectiveTarget = coverHex;
            targetSource = 'postplant-cover';
            // Persist the override so the user-visible "target" in the side
            // panel reflects the post-plant cover seek rather than the stale
            // pre-plant strategy target.
            nextTargets[u.id] = coverHex;
          }
        }
      }
    }

    // AI #3 — pre-plant time scramble: as the round timer runs down, attackers
    // must take a site (timeout is their loss), so they commit to the nearest
    // plant zone instead of holding angles or dueling for picks. Overrides the
    // cautious hold; engaged and retreating units keep their action. Mirrors the
    // post-plant retake. Aggression alone ("fight more") didn't reduce timeouts —
    // attackers need the movement push to actually plant.
    if (
      !state.plant.planted &&
      !retreat &&
      mode !== 'engaged' &&
      state.teamSide[u.team] === 'attacker' &&
      tick >= SITUATION.attackerUrgencyStartFrac * ROUND_TICK_LIMIT
    ) {
      const site = nearestPlantTarget(u, state.map);
      if (site && !sameHex(u.pos, site)) {
        mode = 'moving';
        effectiveTarget = site;
        nextTargets[u.id] = site;
        targetSource = 'urgency-plant';
      }
    }

    // Pass 7.6 / Pillar B — cover-seek on hold: if we'd still hold, relocate to
    // a better hex nearby and commit it as the unit's target so subsequent ticks
    // don't oscillate back to the strategy centroid. POSITIONING.enabled routes
    // through the threat-aware selector (pick the safest hex that keeps LoS to
    // the watch angle — emergent fine positioning from a coarse region label);
    // OFF falls back to the legacy spawn-bearing wall-cover shuffle so the
    // harness can A/B the lever (the inert-AI law demands we prove it moves
    // outcomes).
    if (mode === 'holding') {
      // F2 / H1 — Map IQ (formerly Positioning) widens the search: low → tight,
      // mid → default, high → wider (find a better spot a few hexes away).
      const pos = u.attributes.mapIQ;
      const high = pos >= ATTRIBUTES.formulas.mapIQ.highThreshold;
      const low = pos <= ATTRIBUTES.formulas.mapIQ.lowThreshold;
      let hold: HexCoord;
      if (POSITIONING.enabled) {
        // Watch angle = the directive's facing if any, else the enemy-spawn
        // bearing. The selector keeps LoS to it while minimizing threat.
        const angleHex = directiveFacing ?? enemySpawnForSide(u, state) ?? null;
        const radius = high ? POSITIONING.radiusHighIQ
          : low ? POSITIONING.radiusLowIQ
          : POSITIONING.radiusMidIQ;
        const team = u.team;
        const threatOf = (h: HexCoord) =>
          threatAt(state, team, h, exposure, suspectedByTeam[team]);
        hold = findThreatAwareHoldHex(u, state.map, claimed, threatOf, angleHex, radius, {
          safety: POSITIONING.wSafety,
          los: POSITIONING.wLos,
          cover: POSITIONING.wCover,
          dist: POSITIONING.wDist,
        });
      } else {
        const threat = enemySpawnForSide(u, state) ?? undefined;
        const searchRadius = high ? 2 : low ? 0 : 1;
        hold = findCoverHoldHex(u, state.map, claimed, threat, searchRadius);
      }
      if (!sameHex(hold, u.pos)) {
        mode = 'moving';
        effectiveTarget = hold;
        nextTargets[u.id] = hold;
        targetSource = 'hold-tuck';
      }
    }

    // Phase 1.5 observability — record the finalized decision (no-op unless a
    // trace sink is installed by the harness).
    traceUnit(tick, u.id, mode, targetSource, u.pos, effectiveTarget);

    // Pass 8 — Spearhead delays non-Vanguard allies for the first N ticks of
    // the round (allies follow behind). While the delay window is active, the
    // unit stays put even if moving/retreating was decided. The cardFlag is
    // cleared by match.startRound at round start, so it's per-round automatic.
    const delayedUntil = u.cardFlags.delayedMoveUntilTick ?? -1;
    // v0.19.0 — a committed channeler that is holding (not bailing) is locked
    // onto its hex; only a bail (retreat) releases it to run off the spike.
    const moveSuppressed =
      tick < delayedUntil || (isChanneling && !retreat);

    // Movement for moving/retreating units (engaged/holding stay put). Block
    // moves into hexes claimed by other live units (Pass 7.7). Pass 7.8: when
    // blocked, try once to recompute a detour around all other live units —
    // fixes the "stuck behind a teammate" clustering when two units share a
    // path through a chokepoint. Pass 8: Slow Flank uses the perimeter
    // variant of A* so the route hugs the map edge.
    if (effectiveTarget && (mode === 'moving' || mode === 'retreating') && !moveSuppressed) {
      let move = ensurePathToward(nextMoves[u.id], u.pos, effectiveTarget, state, !!u.cardFlags.slowFlank);
      let result = advanceUnit(u, move);
      const oldKey = `${u.pos.col},${u.pos.row}`;
      let newKey = `${result.pos.col},${result.pos.row}`;
      if (newKey !== oldKey && claimed.has(newKey)) {
        // Detour: A* with all other live unit hexes treated as impassable.
        // Our own hex is removed from the avoid set so the search can start.
        const detourAvoid = new Set(claimed);
        detourAvoid.delete(oldKey);
        const detour = findPath(state.map, u.pos, effectiveTarget, detourAvoid);
        if (detour && detour.length > 1) {
          move = { path: detour, progress: 0 };
          result = advanceUnit(u, move);
          newKey = `${result.pos.col},${result.pos.row}`;
        }
      }
      if (newKey === oldKey || !claimed.has(newKey)) {
        if (newKey !== oldKey) {
          claimed.delete(oldKey);
          claimed.add(newKey);
        }
        u.pos = result.pos;
        u.facing = result.facing;
        // Pass B — threat-aware facing override. A moving unit shouldn't
        // stare at the wall it's pathing around; the cone should point at
        // what matters tactically. Priority: directive's hold-angle facing
        // (e.g. safe_sniper looks down a lane) → tracked enemy bearing →
        // overall destination (so cone leads the path) → enemy spawn /
        // mid centroid (a sensible threat direction) → movement direction
        // (final fallback). Pass E m1: added enemy spawn + midCentroid so a
        // unit that lands on its destination this tick still has a useful
        // facing direction (used to silently fall through to movement dir).
        const tracked = state.tracking[u.id]?.lastKnownHex;
        const arrivedThisTick = effectiveTarget && sameHex(u.pos, effectiveTarget);
        const approach = enemySpawnForSide(u, state);
        // Pass F — skip a hold-angle that points behind the unit (own backfield);
        // while moving, lead with the destination instead so the cone faces
        // forward into the push rather than back where it came from.
        const dirUsable = directiveFacing
          && !(approach && holdAngleBehindApproach(u.pos, directiveFacing, approach));
        if (dirUsable) {
          u.facing = nearestFacing(u.pos, directiveFacing!);
        } else if (tracked) {
          u.facing = nearestFacing(u.pos, tracked);
        } else if (effectiveTarget && !arrivedThisTick) {
          u.facing = nearestFacing(u.pos, effectiveTarget);
        } else {
          // Arrived (or no target) — fall back to enemy spawn / mid centroid
          // so the cone doesn't keep staring at the last-traversed wall.
          const fallback = approach ?? midCentroid(state);
          if (fallback && !sameHex(fallback, u.pos)) {
            u.facing = nearestFacing(u.pos, fallback);
          }
        }
        nextMoves[u.id] = result.move;
      }
      // Still blocked? The unit stays this tick; recompute again next tick.
    }

    // Pass 7.7 face-threat-on-hold: if the unit's final mode is 'holding'
    // (didn't move this tick), point it at the enemy spawn so it actually
    // watches a useful angle instead of whatever direction it last walked in
    // from. Snap-on-hit below overrides this when a unit takes fire.
    // Pass 7.8: if the unit has a fresh tracking entry, prefer its
    // last-known hex as the threat bearing (the tracked enemy is the actual
    // immediate threat — facing the spawn direction would point the wrong
    // way if the enemy is flanking).
    // Pass E m1: added midCentroid as the final fallback for the rare case
    // when a map's enemy-spawn list is empty (defensive); together with the
    // every-tick re-derivation, this guarantees a holding unit always has a
    // sensible facing direction instead of staying stuck on whatever wall
    // its last movement step happened to align with.
    if (mode === 'holding') {
      // Pass 9 — directive-supplied facing (e.g. hold_angle.facingHex) wins
      // over the default threat-bearing logic.
      // Pass E m1 — skip directiveFacing if it resolves to a wall hex
      // (the directive author got it wrong, or the chosen hex moved with
      // a map redesign). Re-deriving from tracking/spawn/midCentroid each
      // tick beats staring at a wall forever.
      // Pass F — also skip a directive facing that points BEHIND the unit on
      // the enemy-approach axis (would stare at its own backfield). A tracked
      // enemy still wins (real threat); otherwise watch the approach.
      const approach = enemySpawnForSide(u, state);
      const useDirective = directiveFacing
        && !isWallHex(state.map, directiveFacing)
        && !(approach && holdAngleBehindApproach(u.pos, directiveFacing, approach));
      const threat = (useDirective ? directiveFacing : undefined)
        ?? state.tracking[u.id]?.lastKnownHex
        ?? approach
        ?? midCentroid(state);
      if (threat && !sameHex(threat, u.pos)) {
        u.facing = nearestFacing(u.pos, threat);
      }
    }

    const stationaryTicks = sameHex(prevPos[u.id], u.pos) ? prevAi.stationaryTicks + 1 : 0;
    const engagementTicks = mode === 'engaged' ? prevAi.engagementTicks + 1 : 0;
    // Pass 9 m2 — sticky-engage counter: increments when engaged-without-sight
    // (carrying or starting the sticky window); resets to 0 the moment a real
    // engagement (engage.engage) reacquires, or when leaving `engaged` entirely.
    const engageStickyTicks =
      mode === 'engaged'
        ? (engage.engage ? 0 : prevAi.engageStickyTicks + 1)
        : 0;
    newAi[u.id] = {
      mode,
      firingTarget,
      ticksSinceEnemySeen,
      shotClock: prevAi.shotClock,
      stationaryTicks,
      engagementTicks,
      // Reset shot count when not engaged; fire loop increments it.
      shotsThisEngagement: mode === 'engaged' ? prevAi.shotsThisEngagement : 0,
      lastFiredTick: prevAi.lastFiredTick,
      engageStickyTicks,
    };
  }

  // v0.19.0 — no-shoot channel lock. A unit actively planting/defusing this
  // tick (resolved on post-move positions, matching updatePlantState's
  // channeler) cannot fire: a defuser can't trade for itself, a planter can't
  // peek mid-plant. Coverers (not on the spike) are unaffected and still trade.
  const atkTeamId: Team = defenderTeamId === 'defenders' ? 'attackers' : 'defenders';
  const channelers = resolveChannelers(working, state.plant, state.map, atkTeamId, defenderTeamId);
  const channelingNow = new Set<string>();
  if (channelers.planterId) channelingNow.add(channelers.planterId);
  if (channelers.defuserId) channelingNow.add(channelers.defuserId);

  // 4. Fire/damage — nested-roll combat (§7.2). One seeded RNG per tick,
  // consumed in stable unit order; damage applied simultaneously below.
  const rng = createRng(hashSeed(state.seed, tick));
  const damage: Record<string, number> = {};
  // Pass 7.7 turn-on-hit: shooter to react to per target this tick. `damagedBy`
  // = last shooter to LAND A HIT; `shotAtBy` = last shooter to FIRE AT the
  // target (hit or miss). After damage application, surviving targets snap
  // facing toward their shooter (preferring a hitter) so they can engage next
  // tick — covers being shot at from outside the cone even when the shot misses.
  const damagedBy: Record<string, string> = {};
  const shotAtBy: Record<string, string> = {};
  for (const u of working) {
    if (u.state !== 'alive') continue;
    const ai = newAi[u.id];
    // v0.19.0 — committed to a plant/defuse channel: no shooting this tick.
    if (channelingNow.has(u.id)) {
      ai.shotClock = 0;
      continue;
    }
    if (ai.mode !== 'engaged') {
      ai.shotClock = 0; // ready to fire the instant it engages
      continue;
    }
    const target = ai.firingTarget ? workingById[ai.firingTarget] : null;
    if (!target || target.state !== 'alive') continue;
    if (ai.shotClock > 0) {
      ai.shotClock -= 1;
      continue;
    }
    // Engaged units don't move, so the shooter is stationary this tick.
    const stationary = sameHex(prevPos[u.id], u.pos);
    // Pass B — peeker's advantage: was the target's hex in the shooter's
    // PREVIOUS-tick visibility set? If not, the shooter is reacting to a
    // newly-appeared target and the first shot takes a small HR penalty.
    // Symmetric on first sight, but defenders pay it more often in practice
    // (attackers walking into cones >> attackers ambushing defenders).
    const prevShooterVis = state.prevPerUnitVisible[u.id];
    const targetHexKey: HexKey = `${target.pos.col},${target.pos.row}`;
    const firstSightShot = !prevShooterVis || !prevShooterVis.has(targetHexKey);
    const ctxInput: ShotContextInput = {
      stationary,
      stationaryTicks: ai.stationaryTicks,
      engagementTicks: ai.engagementTicks,
      firstShot: ai.shotsThisEngagement === 0,
      allyFiredRecently: allyFiredRecently(u, working, state, tick),
      lastAlive: aliveTeamCount(working, u.team) === 1,
      adjacentToWall: isWallAdjacent(u.pos, state),
      ticksIntoRound: tick,
      firstSightShot,
    };
    const shot = resolveShot(u, target, state.map, ctxInput, state.buffs[u.id] ?? [], state.cardEffects, tick, rng);
    // Record the shot regardless of outcome so the target turns to face anyone
    // shooting at it (hit OR miss) — not only when it takes damage.
    shotAtBy[target.id] = u.id;
    if (shot.hit) {
      damage[target.id] = (damage[target.id] ?? 0) + shot.damage;
      damagedBy[target.id] = u.id;
    }
    ai.shotsThisEngagement += 1;
    ai.lastFiredTick = tick;
    events.push({
      tick,
      roundIndex: state.round,
      type: 'shot',
      shooter: u.id,
      target: target.id,
      weapon: u.weapon,
      range: shot.band,
      hit: shot.hit,
      headshot: shot.headshot,
      damage: shot.damage,
      cover: shot.cover,
    });
    ai.shotClock = FIRE_RATE[u.weapon] - 1;

    // Pass C2 — Slow Flank invisibility clears on first fire.
    if (u.cardFlags.invisibleUntilFire) {
      u.cardFlags = { ...u.cardFlags, invisibleUntilFire: false };
    }

    // Pass 8 — Crossfire trigger: when this unit fires, any teammate with
    // crossfireEligible and < extraStack card buffs gets a +25 HR / N-tick buff.
    for (const ally of working) {
      if (ally.id === u.id) continue;
      if (ally.team !== u.team || ally.state !== 'alive') continue;
      if (!ally.cardFlags.crossfireEligible) continue;
      const applied = ally.cardFlags.crossfireBuffsApplied ?? 0;
      if (applied >= CARD_EFFECTS.crossfire.extraStack) continue;
      ally.cardFlags = { ...ally.cardFlags, crossfireBuffsApplied: applied + 1 };
      const ally_buffs = state.buffs[ally.id] ?? [];
      state.buffs[ally.id] = [
        ...ally_buffs,
        {
          id: `crossfire-${u.id}-${tick}`,
          source: 'crossfire',
          hitPp: CARD_EFFECTS.crossfire.hitPp,
          expiresAtTick: tick + CARD_EFFECTS.crossfire.durationTicks,
        },
      ];
    }
  }

  // Apply damage simultaneously; deaths at end of tick.
  // Pass 9 m4 — also collect (deadUnit, killer) pairs so Trade Window can
  // register its mark + ally buffs after the death loop.
  const deathsThisTick: { dead: Unit; killer: Unit | null }[] = [];
  for (const u of working) {
    const dmg = damage[u.id];
    if (!dmg || u.state !== 'alive') continue;
    u.hp -= dmg;
    if (u.hp <= 0) {
      u.hp = 0;
      u.state = 'dead';
      events.push({ tick, roundIndex: state.round, type: 'death', target: u.id });
      const killerId = damagedBy[u.id];
      deathsThisTick.push({ dead: u, killer: killerId ? workingById[killerId] ?? null : null });
    }
  }

  // Pass 7.7 turn-on-hit (extended): surviving targets snap facing toward the
  // shooter that fired at them this tick — so units shot from outside their cone
  // turn to engage next tick (the end-of-tick vision pass then reveals the
  // shooter → tracking acquires it). Covers misses too, not just hits; prefer a
  // shooter that actually landed a hit over one that only shot at us. Overrides
  // the face-threat-on-hold set earlier this tick.
  for (const targetId of Object.keys(shotAtBy)) {
    const t = workingById[targetId];
    if (!t || t.state !== 'alive') continue;
    const shooter = workingById[damagedBy[targetId] ?? shotAtBy[targetId]];
    if (!shooter) continue;
    t.facing = nearestFacing(t.pos, shooter.pos);
  }

  // Pass 8 — post-damage card-effect housekeeping:
  //   a) Guardian Aura: bring each ally's maxHp/hp in line with current aura
  //      coverage (allies within radius of a live aura source get +1).
  //   b) Hold the Line: any ally on a Warden's anchor hex gets the safe-window
  //      flag set to expire `safeWindowTicks` ticks from now.
  applyCardPostDamage(working, state.cardEffects, tick, state);

  // Pass 9 m4 — Trade Window trigger: for each death this tick, if the dead
  // unit's team has any alive teammate with `tradeWindowEnabled`, auto-mark
  // the killer for the dead unit's team. Mark stays for tradeWindow.markTicks
  // and is consumed by combat's mark_target check (which adds +20 HR vs the
  // killer for all allied attacks). Mark Target's reveal-vision is omitted
  // here (Trade Window's effect is the HR bonus, not the wallhack).
  const tradeWindowMarks: import('./types.ts').ActiveCardEffect[] = [];
  for (const { dead, killer } of deathsThisTick) {
    if (!killer) continue;
    const teamHasTradeWindow = working.some(
      (a) => a.team === dead.team && a.state === 'alive' && a.cardFlags.tradeWindowEnabled,
    );
    if (!teamHasTradeWindow) continue;
    tradeWindowMarks.push({
      kind: 'mark_target',
      team: dead.team,
      targetId: killer.id,
      expiresAtTick: tick + CARD_EFFECTS.tradeWindow.markTicks,
    });
  }
  let nextCardEffects: import('./types.ts').ActiveCardEffect[] =
    tradeWindowMarks.length > 0 ? [...state.cardEffects, ...tradeWindowMarks] : [...state.cardEffects];

  // Pass 4 — damage-reactive hero actives (each once per round, armed via
  // heroActivePending; read only own-team observable state):

  // Angelic Field Medic: the first ally in LOS that took damage this tick and
  // SURVIVED → the Angelic steps 1 hex toward them, heals them to full, and
  // grants a short +HR buff. Picks the neediest (most damage taken; id-stable).
  for (const angel of working) {
    if (angel.hero !== 'Angelic' || angel.state !== 'alive') continue;
    if (!angel.cardFlags.heroActivePending) continue;
    let target: Unit | null = null;
    let worst = 0;
    for (const ally of working) {
      if (ally.id === angel.id || ally.team !== angel.team || ally.state !== 'alive') continue;
      const d = damage[ally.id] ?? 0;
      if (d <= 0) continue;
      if (!isVisibleAlongLine(angel.pos, ally.pos, state.map)) continue;
      if (d > worst || (d === worst && (target === null || ally.id < target.id))) {
        worst = d;
        target = ally;
      }
    }
    if (!target) continue;
    angel.cardFlags = { ...angel.cardFlags, heroActivePending: false };
    const path = findPath(state.map, angel.pos, target.pos);
    if (path && path.length > 1) angel.pos = path[1];
    target.hp = Math.min(target.maxHp, target.hp + HERO_ABILITIES.angelicHeal.healHp);
    target.cardFlags = { ...target.cardFlags, rallyUntilTick: tick + HERO_ABILITIES.angelicHeal.buffTicks };
  }

  // Bulwark Fortify: the first time the Bulwark takes damage → it + allies within
  // radius gain a fortify (incoming-HR penalty in combat) for durationTicks.
  for (const bw of working) {
    if (bw.hero !== 'Bulwark' || bw.state !== 'alive') continue;
    if (!bw.cardFlags.heroActivePending) continue;
    if ((damage[bw.id] ?? 0) <= 0) continue;
    bw.cardFlags = { ...bw.cardFlags, heroActivePending: false };
    const fort = HERO_ABILITIES.bulwarkFortify;
    for (const ally of working) {
      if (ally.team !== bw.team || ally.state !== 'alive') continue;
      if (hexDistance(ally.pos, bw.pos) <= fort.radius) {
        ally.cardFlags = { ...ally.cardFlags, fortifiedUntilTick: tick + fort.durationTicks };
      }
    }
  }

  // Cursed Hunter's Mark — end the hunt: drop any clearOnDamage mark whose target
  // took damage from the marking team this tick (the prey is hit → mark expires).
  nextCardEffects = nextCardEffects.filter((fx) => {
    if (fx.kind !== 'mark_target' || !fx.clearOnDamage) return true;
    if ((damage[fx.targetId] ?? 0) <= 0) return true;
    const shooter = workingById[damagedBy[fx.targetId]];
    return !(shooter && shooter.team === fx.team);
  });

  // Buff durations: drop any whose window has elapsed (spec §7.4).
  const nextBuffs = pruneBuffs(state.buffs, tick);

  // 5. Recompute vision/tracking/ghosts on the post-move/post-death state.
  // Pass 9 m4 — postMove carries nextCardEffects (state.cardEffects + Trade
  // Window marks); m3's Mark Target trigger layers on top of that.
  const postMove: GameState = {
    ...state,
    units: working,
    moves: nextMoves,
    targets: nextTargets,
    ai: newAi,
    prevPos,
    tick,
    events: [...state.events, ...events],
    buffs: nextBuffs,
    cardEffects: nextCardEffects,
  };
  const post = computeVisibility(postMove);
  const visibility = post.visibility;
  const tracking = updateTracking(postMove, post.perUnit);
  const prevVisibleByTeam = visibleEnemiesByTeam(state, state.visibility);
  const currVisibleByTeam = visibleEnemiesByTeam(postMove, visibility);
  const ghosts = updateGhosts(state.units, state.ghosts, prevVisibleByTeam, currVisibleByTeam, tick);
  // Belief store advances on the same post-move visibility as ghosts/tracking;
  // like them it's consumed by the NEXT tick's AI (one-tick lag, fair info).
  const beliefs = updateBeliefs(state.beliefs, working, visibility, state.map);

  // Pass 9 m3 / Pass 3 — vision-triggered hero actives, evaluated on post-move
  // visibility so they fire the tick the condition first holds: Cursed Mark
  // Target (first enemy a contributor spots) + Techy Tactical Scan (the team's
  // first enemy contact). Returns the updated cardEffects; clears the flags.
  const triggeredEffects = triggerHeroActives(working, post.perUnit, postMove.cardEffects, tick, state.map);

  // Pass B — spike-plant update on the post-move state. May set roundResult
  // (detonation → attackers win, defuse → defenders win) and push plant
  // lifecycle events into the kill feed.
  const plantUpdate = updatePlantState(
    { ...postMove, units: working },
    tick,
  );

  // Pass B — snapshot post-move per-unit visibility for next tick's
  // first-sight (peeker's advantage) check. ReadonlySet copies are cheap at
  // 9 units × small cone sizes.
  const nextPrevVisible: Record<string, ReadonlySet<HexKey>> = {};
  for (const id of Object.keys(post.perUnit)) {
    nextPrevVisible[id] = new Set(post.perUnit[id]);
  }

  return {
    ...postMove,
    visibility,
    tracking,
    ghosts,
    beliefs,
    cardEffects: triggeredEffects,
    plant: plantUpdate.plant,
    events: [...postMove.events, ...plantUpdate.events],
    roundResult: plantUpdate.roundResult ?? postMove.roundResult,
    prevPerUnitVisible: nextPrevVisible,
  };
}

// Pass B — spike-plant update. Pure(ish): returns the next PlantState plus
// any plant/defuse/detonate events and an optional roundResult winner. The
// caller merges these into the returned state. Uses post-move positions so
// "did this attacker arrive on the plant hex this tick?" works correctly.
type PlantUpdate = {
  plant: PlantState;
  events: GameEvent[];
  roundResult: { winner: Team } | null;
};
// Step 2 (v0.20.0) — should this designated defuser hunt the last attacker
// BEFORE committing to the spike? This is the lone-retaker case the player asked
// for: an aggressive / Ego defender with NO surviving teammate to trade for it
// would just die on a no-shoot defuse, so it clears the threat first. Gated to
// the last defender alive — with coverers present, the coordinated retake
// already trades for the defuser, and deferring a clear defuse there only throws
// winnable rounds away. Also requires a visible attacker to hunt (no ghost-
// chasing) and enough detonation time left to still defuse after the kill.
// Deterministic — no RNG.
function postPlantHuntFirst(
  unit: Unit,
  state: GameState,
  tick: number,
  hasVisibleEnemy: boolean,
  isLastDefenderAlive: boolean,
): boolean {
  if (!state.plant.planted || !hasVisibleEnemy || !isLastDefenderAlive) return false;
  const timeLeft = DETONATION_TICKS - (tick - state.plant.planted.plantedAtTick);
  if (timeLeft <= DEFUSE_TICKS + POST_PLANT_HUNT.timeMarginTicks) return false;
  const aggroTrait = [...unit.tacticalTraits, unit.personality]
    .some((t) => t !== null && POST_PLANT_HUNT.egoTraits.includes(t));
  return aggroTrait || unit.modifiers.aggression >= POST_PLANT_HUNT.aggroBar;
}

// v0.19.0 — who is eligible to plant / defuse RIGHT NOW given positions? Shared
// by the no-shoot lock (tick body, post-move/pre-fire) and the timer
// (updatePlantState, post-fire) so the two never disagree about the channeler.
//   Plant:  alive attacker on a site's plant hexes with no alive defender there
//           (site A before B — deterministic tie-break).
//   Defuse: spike down, alive defender on the planted site's plant hexes with
//           no alive attacker there (attackers block). At most one of each.
function resolveChannelers(
  units: readonly Unit[],
  plant: PlantState,
  map: GameState['map'],
  atkTeam: Team,
  defTeam: Team,
): { planterId: string | null; planterSite: 'A' | 'B' | null; defuserId: string | null } {
  const plantHexes: Record<'A' | 'B', Set<string>> = {
    A: new Set(map.sites.A.plantHexes.map((h) => `${h.col},${h.row}`)),
    B: new Set(map.sites.B.plantHexes.map((h) => `${h.col},${h.row}`)),
  };
  const posKey = (u: Unit) => `${u.pos.col},${u.pos.row}`;
  const aliveAtk = units.filter((u) => u.team === atkTeam && u.state === 'alive');
  const aliveDef = units.filter((u) => u.team === defTeam && u.state === 'alive');

  if (plant.planted === null) {
    for (const site of ['A', 'B'] as const) {
      if (aliveDef.some((d) => plantHexes[site].has(posKey(d)))) continue;
      const planter = aliveAtk.find((a) => plantHexes[site].has(posKey(a)));
      if (planter) return { planterId: planter.id, planterSite: site, defuserId: null };
    }
    return { planterId: null, planterSite: null, defuserId: null };
  }
  const site = plant.planted.site;
  if (aliveAtk.some((a) => plantHexes[site].has(posKey(a)))) {
    return { planterId: null, planterSite: null, defuserId: null };
  }
  const defuser = aliveDef.find((d) => plantHexes[site].has(posKey(d)));
  return { planterId: null, planterSite: null, defuserId: defuser ? defuser.id : null };
}

function updatePlantState(state: GameState, tick: number): PlantUpdate {
  const events: GameEvent[] = [];
  let roundResult: { winner: Team } | null = null;

  // Resolve teams from current side assignment.
  const atkTeam: Team = state.teamSide.defenders === 'attacker' ? 'defenders' : 'attackers';
  const defTeam: Team = atkTeam === 'defenders' ? 'attackers' : 'defenders';
  const { planterId, planterSite, defuserId } =
    resolveChannelers(state.units, state.plant, state.map, atkTeam, defTeam);

  let nextPlant: PlantState = state.plant;

  if (state.plant.planted === null) {
    if (planterId && planterSite) {
      const planter = state.units.find((u) => u.id === planterId)!;
      const cur = state.plant.planting;
      const continuing = cur !== null && cur.unitId === planterId && cur.site === planterSite;
      // Pass C2 — Reckless Push planter plants `plantTicksReduction` ticks
      // faster (min 1). Read from the planter's cardFlags at decision time.
      const effectivePlantTicks = Math.max(
        1,
        PLANT_TICKS - (planter.cardFlags.recklessPush ? CARD_EFFECTS.recklessPush.plantTicksReduction : 0),
      );
      if (continuing && tick - cur.startedAtTick >= effectivePlantTicks) {
        nextPlant = {
          planted: { site: planterSite, plantedAtTick: tick },
          planting: null,
          defusing: null,
        };
        events.push({ tick, roundIndex: state.round, type: 'plant', unit: planterId, site: planterSite });
      } else if (continuing) {
        // Already counted; keep ticking — next tick will hit the threshold.
        nextPlant = state.plant;
      } else {
        nextPlant = {
          ...state.plant,
          planting: { unitId: planterId, site: planterSite, startedAtTick: tick },
        };
      }
    } else {
      // No eligible planter this tick — reset any in-progress attempt.
      nextPlant = { ...state.plant, planting: null };
    }
  } else {
    // Spike is down. Check detonation FIRST so it always fires on the
    // detonation tick (even if a defuse would also have completed).
    const site = state.plant.planted.site;
    if (tick - state.plant.planted.plantedAtTick >= DETONATION_TICKS) {
      events.push({ tick, roundIndex: state.round, type: 'detonate', site });
      roundResult = { winner: atkTeam };
      nextPlant = state.plant; // keep planted record for kill-feed reference
    } else if (defuserId) {
      const cur = state.plant.defusing;
      const continuing = cur !== null && cur.unitId === defuserId;
      if (continuing && tick - cur.startedAtTick >= DEFUSE_TICKS) {
        events.push({ tick, roundIndex: state.round, type: 'defuse', unit: defuserId });
        roundResult = { winner: defTeam };
        nextPlant = { planted: null, planting: null, defusing: null };
      } else if (continuing) {
        nextPlant = state.plant;
      } else {
        nextPlant = {
          ...state.plant,
          defusing: { unitId: defuserId, startedAtTick: tick },
        };
      }
    } else {
      // No eligible defuser (none on the spike, or an attacker is blocking).
      nextPlant = { ...state.plant, defusing: null };
    }
  }

  return { plant: nextPlant, events, roundResult };
}

// Pass 9 m3 / Pass 3 / Pass 4 — fire vision-triggered hero actives this tick.
// Pure: returns a new cardEffects array; mutates each triggered contributor's
// cardFlags in place (the same `working` array stepTick is about to commit).
//   Cursed Hunter's Mark (markTargetPending) — first enemy spotted; reveal +
//     +HR/+HS for cursedMark.ticks OR until it's hit (clearOnDamage).
//   Techy Tactical Scan (heroActivePending) — fires on the team's first enemy
//     contact; reveals enemies around the NEARER site's plant hexes.
// (Angelic heal / Bulwark fortify are damage-triggered, handled in the death loop.)
function triggerHeroActives(
  units: Unit[],
  perUnitVis: Record<string, Set<string>>,
  cardEffects: readonly import('./types.ts').ActiveCardEffect[],
  tick: number,
  map: GameState['map'],
): import('./types.ts').ActiveCardEffect[] {
  let next: import('./types.ts').ActiveCardEffect[] = [...cardEffects];
  // Cursed — Hunter's Mark on first spotted enemy.
  for (const u of units) {
    if (u.state !== 'alive') continue;
    if (!u.cardFlags.markTargetPending) continue;
    const vis = perUnitVis[u.id];
    if (!vis) continue;
    // Find first visible enemy: stable order = enemy.id ascending.
    const enemies = units
      .filter((e) => e.team !== u.team && e.state === 'alive' && vis.has(`${e.pos.col},${e.pos.row}`))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    if (enemies.length === 0) continue;
    const target = enemies[0];
    u.cardFlags = { ...u.cardFlags, markTargetPending: false };
    // Only one mark per team active at a time. Replace if the team already has
    // one (later contributors would otherwise spam effects).
    next = next.filter((e) => !(e.kind === 'mark_target' && e.team === u.team));
    const until = tick + HERO_ABILITIES.cursedMark.ticks;
    next = [
      ...next,
      {
        kind: 'mark_target',
        team: u.team,
        targetId: target.id,
        revealUntilTick: until,
        expiresAtTick: until,
        clearOnDamage: true,
      },
    ];
  }
  // Techy — targeted Tactical Scan on the team's first enemy contact.
  for (const u of units) {
    if (u.state !== 'alive' || u.hero !== 'Techy') continue;
    if (!u.cardFlags.heroActivePending) continue;
    const teamSeesEnemy = units.some((mate) => {
      if (mate.team !== u.team || mate.state !== 'alive') return false;
      const vis = perUnitVis[mate.id];
      if (!vis) return false;
      return units.some(
        (e) => e.team !== u.team && e.state === 'alive' && vis.has(`${e.pos.col},${e.pos.row}`),
      );
    });
    if (!teamSeesEnemy) continue;
    u.cardFlags = { ...u.cardFlags, heroActivePending: false };
    // Pick the site whose plant hexes are nearest the Techy (the objective the
    // team is fighting over from here).
    const distTo = (hexes: readonly HexCoord[]) =>
      hexes.reduce((m, h) => Math.min(m, hexDistance(u.pos, h)), Infinity);
    const site: 'A' | 'B' = distTo(map.sites.A.plantHexes) <= distTo(map.sites.B.plantHexes) ? 'A' : 'B';
    next = next.filter((e) => !(e.kind === 'tactical_scan' && e.team === u.team));
    next = [
      ...next,
      {
        kind: 'tactical_scan',
        team: u.team,
        expiresAtTick: tick + HERO_ABILITIES.techyScan.ticks,
        site,
        radius: HERO_ABILITIES.techyScan.radius,
      },
    ];
  }
  return next;
}

// Pass 8 — apply per-tick card effects after damage resolution. Mutates the
// supplied unit array in place (kept here so the main stepTick body stays
// readable; this is glue, not algorithm).
function applyCardPostDamage(
  units: Unit[],
  cardEffects: readonly import('./types.ts').ActiveCardEffect[],
  tick: number,
  state: GameState,
): void {
  // a) Guardian Aura — recompute coverage from live aura sources, then sync.
  // Build a per-unit "covered" bool from the union of all live aura sources.
  const sourcesByTeam: Record<string, Unit[]> = {};
  const radii: Record<string, number> = {};
  for (const fx of cardEffects) {
    if (fx.kind !== 'guardian_aura') continue;
    const src = units.find((u) => u.id === fx.sourceId && u.state === 'alive');
    if (!src) continue;
    sourcesByTeam[fx.team] = sourcesByTeam[fx.team] ?? [];
    sourcesByTeam[fx.team].push(src);
    radii[fx.sourceId] = fx.radius;
  }
  for (const u of units) {
    if (u.state !== 'alive') continue;
    const sources = sourcesByTeam[u.team] ?? [];
    const covered = sources.some((s) => hexDistance(u.pos, s.pos) <= (radii[s.id] ?? CARD_EFFECTS.guardianAura.radius));
    // Base is the configured max HP (was a hard-coded 3, which silently
    // overrode UNIT_DEFAULTS.maxHp every tick and capped all units at 3 —
    // masked only because the config also happened to be 3).
    const wantMax = UNIT_DEFAULTS.maxHp + (covered ? CARD_EFFECTS.guardianAura.maxHpBonus : 0);
    if (u.maxHp !== wantMax) {
      const delta = wantMax - u.maxHp;
      u.maxHp = wantMax;
      // Only raise current HP when newly covered; reductions clamp.
      if (delta > 0) u.hp = Math.min(u.maxHp, u.hp + delta);
      else u.hp = Math.min(u.hp, u.maxHp);
    }
  }

  // b) Hold the Line — allies on the anchor hex get the safe-window flag.
  // Pass C2 — when the spike is planted AND the Warden's anchor hex is on
  // the planted site's plant zone, the safe-window extends to ANY ally on
  // any plant hex of that site (so a Warden anchoring near the spike
  // protects defusers).
  for (const fx of cardEffects) {
    if (fx.kind !== 'hold_the_line') continue;

    // Pass C2 plant-zone extension: precompute whether anchor is on plant.
    let plantZoneHexes: Set<string> | null = null;
    if (state.plant.planted) {
      const site = state.plant.planted.site;
      const sitePlantHexes = state.map.sites[site].plantHexes;
      const onPlant = sitePlantHexes.some(
        (h) => h.col === fx.anchorHex.col && h.row === fx.anchorHex.row,
      );
      if (onPlant) {
        plantZoneHexes = new Set(sitePlantHexes.map((h) => `${h.col},${h.row}`));
      }
    }

    for (const u of units) {
      if (u.team !== fx.team || u.state !== 'alive') continue;
      const onAnchor = u.pos.col === fx.anchorHex.col && u.pos.row === fx.anchorHex.row;
      const onPlantZone = plantZoneHexes !== null
        && plantZoneHexes.has(`${u.pos.col},${u.pos.row}`);
      if (!onAnchor && !onPlantZone) continue;
      u.cardFlags = {
        ...u.cardFlags,
        safeWindowUntilTick: tick + CARD_EFFECTS.holdTheLine.safeWindowTicks,
      };
    }
  }

  // Pass 9 m4 — Last Stand removed; the (c) ghost-skip block lived here and is
  // gone with it. Trade Window's death-trigger lives in stepTick directly (it
  // needs the deathsThisTick collection from the damage loop).
}

// True when one team is wiped, or every alive unit is idle (holding) — i.e. all
// arrived and no engagements remain. Pass 7.8 — the "all holding" path only
// fires after MIN_ROUND_TICKS_FOR_HOLD_END so a no-LoS map can't end a round
// at tick ~5 with zero shots; rotation gets a chance to force contact first.
// Wipe-out is checked unconditionally (an actual elimination ends the round
// whenever it happens).
export function roundFinished(state: GameState): boolean {
  let aliveDef = 0;
  let aliveAtk = 0;
  let allHolding = true;
  for (const u of state.units) {
    if (u.state !== 'alive') continue;
    if (u.team === 'defenders') aliveDef++;
    else aliveAtk++;
    if (state.ai[u.id]?.mode !== 'holding') allHolding = false;
  }
  if (aliveDef === 0 || aliveAtk === 0) return true;
  return allHolding && state.tick >= MIN_ROUND_TICKS_FOR_HOLD_END;
}

// --- helpers ---------------------------------------------------------------

// Keep only buffs whose window still includes this tick.
function pruneBuffs(
  buffs: Record<string, Buff[]>,
  tick: number,
): Record<string, Buff[]> {
  const out: Record<string, Buff[]> = {};
  for (const id of Object.keys(buffs)) {
    const live = buffs[id].filter((b) => b.expiresAtTick >= tick);
    out[id] = live;
  }
  return out;
}

function freshAi(): AiState {
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

function sameHex(a: HexCoord, b: HexCoord): boolean {
  return a.col === b.col && a.row === b.row;
}

// Enemy-spawn push target (middle enemy spawn hex) for the role-movement tendency.
function enemyPushTarget(unit: Unit, state: GameState): HexCoord | null {
  const enemySpawns =
    unit.team === 'defenders' ? state.map.spawns.attackers : state.map.spawns.defenders;
  if (enemySpawns.length === 0) return null;
  return enemySpawns[Math.floor(enemySpawns.length / 2)];
}

// Pass 7.7 — side-aware enemy spawn for face-threat-on-hold. Uses teamSide so
// it's correct post-halftime (when team identity and side are decoupled).
function enemySpawnForSide(unit: Unit, state: GameState): HexCoord | null {
  const oppositeSpawnKey =
    state.teamSide[unit.team] === 'attacker' ? 'defenders' : 'attackers';
  const spawns = state.map.spawns[oppositeSpawnKey];
  if (spawns.length === 0) return null;
  return spawns[Math.floor(spawns.length / 2)];
}

// A hold-angle that sits BEHIND the unit relative to the enemy-approach axis
// (vector pos→enemySpawn) makes a settling unit stare at its own backfield —
// e.g. a defender pushed forward into a_main but told to watch a_site (north),
// so it watches the lane it already passed instead of the attacker approach.
// Detected via the cube-space dot of (angle−pos)·(enemy−pos): < 0 ⇒ >90° apart
// ⇒ behind. Sideways angles (dot ≈ 0, legitimate lane/flank watches) are kept;
// callers fall back to watching the approach (or a tracked enemy) when behind.
function holdAngleBehindApproach(pos: HexCoord, angle: HexCoord, enemy: HexCoord): boolean {
  const p = offsetToAxial(pos.col, pos.row);
  const a = offsetToAxial(angle.col, angle.row);
  const e = offsetToAxial(enemy.col, enemy.row);
  // axial (q,r) → cube (x = q, z = r, y = −q−r)
  const vax = a.q - p.q, vaz = a.r - p.r, vay = -vax - vaz;
  const vex = e.q - p.q, vez = e.r - p.r, vey = -vex - vez;
  return vax * vex + vay * vey + vaz * vez < 0;
}

// Pass E m1 — is a hex a `wall` cell? Used to skip directive-supplied facings
// that point at walls so a holding unit doesn't stare at one indefinitely.
function isWallHex(map: GameState['map'], hex: HexCoord): boolean {
  if (hex.row < 0 || hex.row >= map.height || hex.col < 0 || hex.col >= map.width) return false;
  return map.grid[hex.row][hex.col] === 'wall';
}

// Pass 7.7 — middle passable hex of the mid region, used as the rotation
// target when a unit has been holding too long without contact.
function midCentroid(state: GameState): HexCoord | null {
  const hexes = state.map.regions['mid'];
  if (!hexes || hexes.length === 0) return null;
  const passableHexes = hexes.filter((h) => {
    if (h.row < 0 || h.row >= state.map.height || h.col < 0 || h.col >= state.map.width) return false;
    const t = state.map.grid[h.row][h.col];
    return t !== 'wall' && t !== 'cover';
  });
  if (passableHexes.length === 0) return null;
  return passableHexes[Math.floor(passableHexes.length / 2)];
}

// AI #3 — nearest plantable site centroid, for the pre-plant time scramble.
function nearestPlantTarget(unit: Unit, map: GameState['map']): HexCoord | null {
  let best: HexCoord | null = null;
  let bestD = Infinity;
  for (const site of ['A', 'B'] as const) {
    const hexes = map.sites[site].plantHexes;
    if (hexes.length === 0) continue;
    const centroid = hexes[Math.floor(hexes.length / 2)];
    const d = hexDistance(unit.pos, centroid);
    if (d < bestD) {
      bestD = d;
      best = centroid;
    }
  }
  return best;
}

function aliveTeamCount(units: readonly Unit[], team: Unit['team']): number {
  let n = 0;
  for (const u of units) if (u.team === team && u.state === 'alive') n++;
  return n;
}

// Trader: any living teammate (not self) fired within the last `windowTicks`.
function allyFiredRecently(
  unit: Unit,
  units: readonly Unit[],
  state: GameState,
  tick: number,
): boolean {
  const cutoff = tick - TRAITS.trader.windowTicks;
  for (const a of units) {
    if (a.id === unit.id || a.team !== unit.team || a.state !== 'alive') continue;
    if ((state.ai[a.id]?.lastFiredTick ?? -999) >= cutoff) return true;
  }
  return false;
}

function isWallAdjacent(hex: HexCoord, state: GameState): boolean {
  for (const nb of neighbors(hex)) {
    if (nb.row < 0 || nb.row >= state.map.height || nb.col < 0 || nb.col >= state.map.width) continue;
    if (state.map.grid[nb.row][nb.col] === 'wall') return true;
  }
  return false;
}

function enemiesVisibleTo(
  unit: Unit,
  units: readonly Unit[],
  visibleHexes: Set<string> | undefined,
): Unit[] {
  if (!visibleHexes) return [];
  const out: Unit[] = [];
  for (const e of units) {
    if (e.team === unit.team || e.state !== 'alive') continue;
    if (!visibleHexes.has(hexKey(e.pos))) continue;
    // Pass C2 — Slow Flank invisibility. The enemy is normally visible
    // (their hex is in our cone), but their card flag hides them from AI
    // targeting until they fire OR they're within proximityHexes of us.
    if (e.cardFlags.invisibleUntilFire) {
      const dist = hexDistance(unit.pos, e.pos);
      if (dist > CARD_EFFECTS.slowFlank.proximityHexes) continue;
    }
    out.push(e);
  }
  return out;
}

// Keep the cached route if it still ends at `target` and the unit is on it;
// otherwise recompute from the current hex. Preserving progress lets the sniper
// accumulate its 0.5/tick across ticks. Pass 8: when `perimeter` is true, the
// route is computed via the perimeter A* (Slow Flank); falls back to plain
// findPath if the perimeter variant returns null.
function ensurePathToward(
  move: MoveState | undefined,
  pos: HexCoord,
  target: HexCoord,
  state: GameState,
  perimeter = false,
): MoveState {
  if (move && move.path.length > 0) {
    const last = move.path[move.path.length - 1];
    const cur = move.path[Math.floor(move.progress)];
    const onPath = cur && sameHex(cur, pos);
    if (onPath && sameHex(last, target)) return move;
  }
  const path = perimeter
    ? (findPerimeterPath(state.map, pos, target, CARD_EFFECTS.slowFlank.perimeterPenalty) ?? findPath(state.map, pos, target) ?? [pos])
    : (findPath(state.map, pos, target) ?? [pos]);
  return { path, progress: 0 };
}

function hashSeed(seed: number, tick: number): number {
  return (seed ^ Math.imul(tick + 1, 2654435761)) >>> 0;
}
