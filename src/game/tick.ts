// Per-tick simulation step (spec §21 pipeline):
//   AI decisions → movement → fire/damage → vision recompute → round-end.
// Pass 5 resolves combat via the real nested-roll pipeline (combat.ts) and ticks
// down active buffs.

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
  updateGhosts,
  updateTracking,
  visibleEnemiesByTeam,
} from './vision.ts';
import {
  findCoverHoldHex,
  nearestFacing,
  nearestWallRetreatHex,
  shouldEngage,
  shouldRetreat,
} from './unit-ai.ts';
import { evaluateDirectives } from './directives.ts';
import { resolveShot } from './combat.ts';
import type { ShotContextInput } from './combat.ts';
import { createRng } from './rng.ts';
import {
  AGGRESSION_PUSH_THRESHOLD,
  AI,
  CARD_EFFECTS,
  DEFUSE_TICKS,
  DETONATION_TICKS,
  FIRE_RATE,
  MIN_ROUND_TICKS_FOR_HOLD_END,
  PLANT_TICKS,
  ROTATE_AFTER_HOLD_TICKS,
  STAY_ENGAGED_TICKS,
  TRAITS,
} from './config.ts';
import { hexDistance } from './hex.ts';

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

  // 2. AI decisions + 3. movement (per unit, stable order).
  for (const u of working) {
    prevPos[u.id] = u.pos;
    const prevAi = state.ai[u.id] ?? freshAi();
    if (u.state !== 'alive') {
      newAi[u.id] = prevAi;
      continue;
    }

    const visibleEnemies = enemiesVisibleTo(u, working, perUnit[u.id]);
    const seesEnemy = visibleEnemies.length > 0;
    const ticksSinceEnemySeen = seesEnemy ? 0 : prevAi.ticksSinceEnemySeen + 1;

    const retreat = shouldRetreat(u).retreat;
    const engage = shouldEngage(u, visibleEnemies);

    // Pass 9 — evaluate per-unit directives. Survival (retreat) still trumps;
    // otherwise a directive can override engagement (suppressEngage), supply a
    // movement target, or set facing. Legacy default-behavior tree fires only
    // when the directive returns no useful decision.
    const directiveDecision = retreat ? null : evaluateDirectives(u, state, prevAi, visibleEnemies);
    const directiveSuppressesEngage = directiveDecision?.suppressEngage === true;

    let mode: AiState['mode'];
    let firingTarget: string | null = null;
    let effectiveTarget: HexCoord | null = null;
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
    } else if (engage.engage && !directiveSuppressesEngage) {
      mode = 'engaged';
      firingTarget = engage.targetId;
    } else if (stickyEngage) {
      // Keep the previous engagement alive briefly. Keep the prior firingTarget
      // if it's still alive (combat will skip the shot if not), so a unit that
      // re-acquires next tick continues a clean engagement.
      mode = 'engaged';
      firingTarget = prevAi.firingTarget;
    } else if (directiveDecision?.target) {
      // Pass 9 — directive supplied a target. 'holding' when target === pos,
      // else 'moving'. Bypasses the legacy region/push/rotation tree below.
      effectiveTarget = directiveDecision.target;
      mode = sameHex(directiveDecision.target, u.pos) ? 'holding' : 'moving';
    } else if (ticksSinceEnemySeen >= AI.resumeAfterTicks) {
      const region = state.targets[u.id];
      if (region && !sameHex(u.pos, region)) {
        mode = 'moving';
        effectiveTarget = region;
      } else if (!region && u.modifiers.aggression >= AGGRESSION_PUSH_THRESHOLD) {
        // No assigned region: high-aggression roles advance toward the enemy
        // spawn (lightweight role tendency; superseded by Pass 7 strategy).
        const push = enemyPushTarget(u, state);
        if (push && !sameHex(u.pos, push)) {
          mode = 'moving';
          effectiveTarget = push;
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
      } else {
        mode = 'holding';
      }
    }

    // Pass 7.7 — light stalemate breaker: a unit that's been idle for a long
    // stretch without seeing anyone re-targets to the mid centroid (where
    // contact is most likely). Applies to both sides equally.
    if (mode === 'holding' && ticksSinceEnemySeen >= ROTATE_AFTER_HOLD_TICKS) {
      const midGoal = midCentroid(state);
      if (midGoal && !sameHex(midGoal, u.pos)) {
        mode = 'moving';
        effectiveTarget = midGoal;
        nextTargets[u.id] = midGoal;
      }
    }

    // Pass B — defender retake on plant. Once the spike is down, every
    // alive defender not actively engaged re-targets to the planted site
    // so someone actually arrives to defuse (matrix run after initial
    // Pass B showed zero defuses across 450 rounds — defenders just stayed
    // in position). Engaged defenders keep shooting (the enemy may be the
    // one blocking the plant zone). Retreat (HP 1) still wins.
    if (state.plant.planted && !retreat && mode !== 'engaged') {
      const defTeam: Team = state.teamSide.defenders === 'defender' ? 'defenders' : 'attackers';
      if (u.team === defTeam) {
        const site = state.plant.planted.site;
        const plantHexes = site === 'A' ? state.map.sites.A.plantHexes : state.map.sites.B.plantHexes;
        if (plantHexes.length > 0) {
          const retakeTarget = plantHexes[Math.floor(plantHexes.length / 2)];
          if (!sameHex(u.pos, retakeTarget)) {
            mode = 'moving';
            effectiveTarget = retakeTarget;
          }
        }
      }
    }

    // Pass 7.6 cover-seek: if we'd still hold, see if a neighbor hex offers
    // better defensive geometry (wall- or cover-adjacent). Shuffle there if
    // so, and commit the cover hex as the unit's region target so subsequent
    // ticks don't oscillate back to the strategy centroid. Pass 7.8: pass the
    // enemy spawn as the threat bearing so cover scoring prefers hexes where
    // a wall sits between the unit and where shots will come from (not just
    // any wall-adjacent — which leaves units hugging walls facing nothing).
    if (mode === 'holding') {
      const threat = enemySpawnForSide(u, state) ?? undefined;
      const cover = findCoverHoldHex(u, state.map, claimed, threat);
      if (!sameHex(cover, u.pos)) {
        mode = 'moving';
        effectiveTarget = cover;
        nextTargets[u.id] = cover;
      }
    }

    // Pass 8 — Spearhead delays non-Vanguard allies for the first N ticks of
    // the round (allies follow behind). While the delay window is active, the
    // unit stays put even if moving/retreating was decided. The cardFlag is
    // cleared by match.startRound at round start, so it's per-round automatic.
    const delayedUntil = u.cardFlags.delayedMoveUntilTick ?? -1;
    const moveSuppressedByDelay = tick < delayedUntil;

    // Movement for moving/retreating units (engaged/holding stay put). Block
    // moves into hexes claimed by other live units (Pass 7.7). Pass 7.8: when
    // blocked, try once to recompute a detour around all other live units —
    // fixes the "stuck behind a teammate" clustering when two units share a
    // path through a chokepoint. Pass 8: Slow Flank uses the perimeter
    // variant of A* so the route hugs the map edge.
    if (effectiveTarget && (mode === 'moving' || mode === 'retreating') && !moveSuppressedByDelay) {
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
        // overall destination (so cone leads the path) → movement direction
        // (current fallback). Keeps cones useful while units navigate.
        const tracked = state.tracking[u.id]?.lastKnownHex;
        if (directiveFacing) {
          u.facing = nearestFacing(u.pos, directiveFacing);
        } else if (tracked) {
          u.facing = nearestFacing(u.pos, tracked);
        } else if (effectiveTarget && !sameHex(u.pos, effectiveTarget)) {
          u.facing = nearestFacing(u.pos, effectiveTarget);
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
    if (mode === 'holding') {
      // Pass 9 — directive-supplied facing (e.g. hold_angle.facingHex) wins
      // over the default threat-bearing logic.
      const threat = directiveFacing
        ?? state.tracking[u.id]?.lastKnownHex
        ?? enemySpawnForSide(u, state);
      if (threat) u.facing = nearestFacing(u.pos, threat);
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

  // 4. Fire/damage — nested-roll combat (§7.2). One seeded RNG per tick,
  // consumed in stable unit order; damage applied simultaneously below.
  const rng = createRng(hashSeed(state.seed, tick));
  const damage: Record<string, number> = {};
  // Pass 7.7 turn-on-hit: last shooter to land a hit on each target this tick.
  // After damage application, surviving targets snap facing toward that shooter
  // so they can engage next tick (covers shots from outside the cone).
  const damagedBy: Record<string, string> = {};
  for (const u of working) {
    if (u.state !== 'alive') continue;
    const ai = newAi[u.id];
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

  // Pass 7.7 turn-on-hit: surviving targets snap facing toward the last shooter
  // that hit them this tick — so units shot from outside their cone turn to
  // engage on the next tick (overrides the face-threat-on-hold set earlier).
  for (const targetId of Object.keys(damagedBy)) {
    const t = workingById[targetId];
    if (!t || t.state !== 'alive') continue;
    const shooter = workingById[damagedBy[targetId]];
    if (!shooter) continue;
    t.facing = nearestFacing(t.pos, shooter.pos);
  }

  // Pass 8 — post-damage card-effect housekeeping:
  //   a) Guardian Aura: bring each ally's maxHp/hp in line with current aura
  //      coverage (allies within radius of a live aura source get +1).
  //   b) Hold the Line: any ally on a Warden's anchor hex gets the safe-window
  //      flag set to expire `safeWindowTicks` ticks from now.
  applyCardPostDamage(working, state.cardEffects, tick);

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

  // Pass 9 m3 — Mark Target trigger: for each unit with markTargetPending,
  // if their per-unit visibility includes a live enemy this tick, register a
  // mark_target effect on that enemy and clear the pending flag. First enemy
  // wins (stable: lowest enemy id on tied distance — `pickFiringTarget`
  // semantics). Reads post-move visibility so it fires the tick the contributor
  // first sees an enemy.
  const triggeredEffects = triggerPendingMarks(working, post.perUnit, postMove.cardEffects, tick);

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
function updatePlantState(state: GameState, tick: number): PlantUpdate {
  const events: GameEvent[] = [];
  let roundResult: { winner: Team } | null = null;
  const map = state.map;

  // Per-site plant-hex sets keyed by "col,row" for O(1) lookup.
  const plantHexes: Record<'A' | 'B', Set<string>> = {
    A: new Set(map.sites.A.plantHexes.map((h) => `${h.col},${h.row}`)),
    B: new Set(map.sites.B.plantHexes.map((h) => `${h.col},${h.row}`)),
  };
  const posKey = (u: Unit) => `${u.pos.col},${u.pos.row}`;

  // Resolve teams from current side assignment.
  const atkTeam: Team = state.teamSide.defenders === 'attacker' ? 'defenders' : 'attackers';
  const defTeam: Team = atkTeam === 'defenders' ? 'attackers' : 'defenders';
  const aliveAtk = state.units.filter((u) => u.team === atkTeam && u.state === 'alive');
  const aliveDef = state.units.filter((u) => u.team === defTeam && u.state === 'alive');

  let nextPlant: PlantState = state.plant;

  if (state.plant.planted === null) {
    // No spike down. Look for the first eligible planter — alive attacker on
    // a plant hex of a site with no alive defender on the same site's plant
    // hexes. Site A is checked before B for deterministic tie-break.
    let chosen: { planter: Unit; site: 'A' | 'B' } | null = null;
    for (const site of ['A', 'B'] as const) {
      const defOnSite = aliveDef.some((d) => plantHexes[site].has(posKey(d)));
      if (defOnSite) continue;
      const planter = aliveAtk.find((a) => plantHexes[site].has(posKey(a)));
      if (planter) { chosen = { planter, site }; break; }
    }
    if (chosen) {
      const cur = state.plant.planting;
      const continuing = cur !== null && cur.unitId === chosen.planter.id && cur.site === chosen.site;
      if (continuing && tick - cur.startedAtTick >= PLANT_TICKS) {
        nextPlant = {
          planted: { site: chosen.site, plantedAtTick: tick },
          planting: null,
          defusing: null,
        };
        events.push({ tick, roundIndex: state.round, type: 'plant', unit: chosen.planter.id, site: chosen.site });
      } else if (continuing) {
        // Already counted; keep ticking — next tick will hit the threshold.
        nextPlant = state.plant;
      } else {
        nextPlant = {
          ...state.plant,
          planting: { unitId: chosen.planter.id, site: chosen.site, startedAtTick: tick },
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
    } else {
      // Defuse: alive defender on the site's plant hexes, no alive attacker
      // on the same plant hexes (attackers block defuse).
      const atkOnSite = aliveAtk.some((a) => plantHexes[site].has(posKey(a)));
      const defuser = atkOnSite ? null : aliveDef.find((d) => plantHexes[site].has(posKey(d)));
      if (defuser) {
        const cur = state.plant.defusing;
        const continuing = cur !== null && cur.unitId === defuser.id;
        if (continuing && tick - cur.startedAtTick >= DEFUSE_TICKS) {
          events.push({ tick, roundIndex: state.round, type: 'defuse', unit: defuser.id });
          roundResult = { winner: defTeam };
          nextPlant = { planted: null, planting: null, defusing: null };
        } else if (continuing) {
          nextPlant = state.plant;
        } else {
          nextPlant = {
            ...state.plant,
            defusing: { unitId: defuser.id, startedAtTick: tick },
          };
        }
      } else {
        nextPlant = { ...state.plant, defusing: null };
      }
    }
  }

  return { plant: nextPlant, events, roundResult };
}

// Pass 9 m3 — convert pending Mark Target flags into active mark_target
// effects when the contributor first spots an enemy this round. Pure: returns
// a new cardEffects array; mutates each triggered contributor's cardFlags in
// place (the same `working` array stepTick is about to commit).
function triggerPendingMarks(
  units: Unit[],
  perUnitVis: Record<string, Set<string>>,
  cardEffects: readonly import('./types.ts').ActiveCardEffect[],
  tick: number,
): import('./types.ts').ActiveCardEffect[] {
  let next: import('./types.ts').ActiveCardEffect[] = [...cardEffects];
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
    next = [
      ...next,
      {
        kind: 'mark_target',
        team: u.team,
        targetId: target.id,
        revealUntilTick: tick + CARD_EFFECTS.markTarget.revealTicks,
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
    const wantMax = 3 + (covered ? CARD_EFFECTS.guardianAura.maxHpBonus : 0);
    if (u.maxHp !== wantMax) {
      const delta = wantMax - u.maxHp;
      u.maxHp = wantMax;
      // Only raise current HP when newly covered; reductions clamp.
      if (delta > 0) u.hp = Math.min(u.maxHp, u.hp + delta);
      else u.hp = Math.min(u.hp, u.maxHp);
    }
  }

  // b) Hold the Line — allies on the anchor hex get the safe-window flag.
  for (const fx of cardEffects) {
    if (fx.kind !== 'hold_the_line') continue;
    for (const u of units) {
      if (u.team !== fx.team || u.state !== 'alive') continue;
      if (u.pos.col !== fx.anchorHex.col || u.pos.row !== fx.anchorHex.row) continue;
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
    if (visibleHexes.has(hexKey(e.pos))) out.push(e);
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
