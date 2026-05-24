// Pass 5 — combat resolution (spec §7.2 nested rolls) + the effective-stat
// summation seam that traits/role/hero (Pass 6) and cards (Pass 8) feed.
// Pure: given shooter/target/map/state, roll a shot and return its outcome.

import type { ActiveCardEffect, Buff, MapDefinition, RangeBand, Unit, Weapon } from './types.ts';
import type { Rng } from './rng.ts';
import { hexDistance, hexLine, offsetToPixel } from './hex.ts';
import {
  CARD_EFFECTS,
  COVER_HIT_PENALTY_PP,
  DAMAGE,
  HEADSHOT,
  HIT_CLAMP,
  HIT_TABLE,
  MODIFIERS,
  RANGE,
  TRAITS,
} from './config.ts';

export type ShotContext = {
  dist: number;
  band: RangeBand;
  stationary: boolean;
  crossesCover: boolean;
  // --- Pass 6 context (supplied by the tick loop) ---
  stationaryTicks: number;
  engagementTicks: number;
  firstShot: boolean;
  allyFiredRecently: boolean;
  lastAlive: boolean;
  adjacentToWall: boolean;
  ticksIntoRound: number;
  // --- Pass 8 card-derived flags (precomputed by combat from cardEffects) ---
  markedTarget: boolean;        // shooter's team has Mark Target on this target
  flankedByShooter: boolean;    // shooter is >60° off target's facing
  warderAnchorStationary: boolean; // Warden Hold-the-Line stationary at anchor
  spearheadFirstEngagement: boolean;
};

// Caller-supplied context for resolveShot (everything not derivable from
// shooter/target/map alone).
export type ShotContextInput = {
  stationary: boolean;
  stationaryTicks: number;
  engagementTicks: number;
  firstShot: boolean;
  allyFiredRecently: boolean;
  lastAlive: boolean;
  adjacentToWall: boolean;
  ticksIntoRound: number;
};

export type ShotResult = {
  hit: boolean;
  headshot: boolean;
  damage: number;
  band: RangeBand;
  cover: boolean;
};

export function rangeBand(dist: number): RangeBand {
  if (dist <= RANGE.shortMax) return 'short';
  if (dist <= RANGE.mediumMax) return 'medium';
  return 'long';
}

// HIT_TABLE row: snipers split moving/stationary; others use their own row.
function hitRow(weapon: Weapon, stationary: boolean): string {
  if (weapon === 'sniper') return stationary ? 'sniperStationary' : 'sniperMoving';
  return weapon;
}

export function baseHitPct(weapon: Weapon, band: RangeBand, stationary: boolean): number {
  return HIT_TABLE[hitRow(weapon, stationary)][band];
}

// True when a half-wall cover hex lies on the shot line adjacent to the target
// (the target is hugging cover toward the shooter). Cover never blocks the
// line of sight (Pass 3) — it only penalizes the incoming hit chance.
export function shotCrossesCover(shooter: Unit, target: Unit, map: MapDefinition): boolean {
  const line = hexLine(shooter.pos, target.pos);
  for (let i = 1; i < line.length - 1; i++) {
    const h = line[i];
    if (h.row < 0 || h.row >= map.height || h.col < 0 || h.col >= map.width) continue;
    if (map.grid[h.row][h.col] === 'cover' && hexDistance(h, target.pos) === 1) return true;
  }
  return false;
}

// --- Effective-stat summation (the single seam later passes extend) ---------
// In Pass 5 only weapon/range/cover + buffs contribute; the trait/role/hero/
// modifier hooks return 0 until Pass 6/8 fills them.

function sumBuff(buffs: readonly Buff[], key: 'hitPp' | 'headshotPp'): number {
  let s = 0;
  for (const b of buffs) s += b[key] ?? 0;
  return s;
}

// Skill + behavioral trait hit-rate contribution (spec §12). A unit has at most
// one of each, so the matching branches simply sum. Pass 8: Opening Pick (Entry
// card) overrides the Entry trait branch — skips the post-engagement penalty.
function traitHitPp(unit: Unit, ctx: ShotContext): number {
  let pp = 0;
  switch (unit.skillTrait) {
    case 'Sharp Aim': pp += TRAITS.sharpAimHitPp; break;
    case 'First Shot': if (ctx.firstShot) pp += TRAITS.firstShotHitPp; break;
    default: break; // Headhunter (HS only), Eagle Eye (vision) — no HR effect
  }
  switch (unit.behavioralTrait) {
    case 'Sentinel': if (ctx.stationaryTicks >= TRAITS.sentinel.stationaryTicks) pp += TRAITS.sentinel.hitPp; break;
    case 'Run-n-Gun': if (!ctx.stationary) pp += TRAITS.runAndGunMovingHitPp; break;
    case 'Lurker': if (ctx.adjacentToWall) pp += TRAITS.lurker.hitPp; break;
    case 'Entry':
      // Opening Pick replaces the trait branch (card handles both phases).
      if (unit.cardFlags.openingPickActive) break;
      pp += ctx.engagementTicks <= TRAITS.entry.windowTicks ? TRAITS.entry.hitPp : TRAITS.entry.postPenaltyHitPp;
      break;
    case 'Trader': if (ctx.allyFiredRecently) pp += TRAITS.trader.hitPp; break;
    case 'Clutch':
      // Pass 9 m4 — Last Stand removed (replaced by Trade Window); Clutch
      // trait reverts to its base lastAlive bonus.
      if (ctx.lastAlive) pp += TRAITS.clutch.hitPp;
      break;
    default: break;
  }
  return pp;
}

function traitHeadshotPp(unit: Unit, ctx: ShotContext): number {
  let pp = 0;
  if (unit.skillTrait === 'Headhunter' && unit.weapon === 'rifle') pp += TRAITS.headhunterHsPp;
  switch (unit.behavioralTrait) {
    case 'Sentinel': if (ctx.stationaryTicks >= TRAITS.sentinel.stationaryTicks) pp += TRAITS.sentinel.hsPp; break;
    case 'Lurker': if (ctx.adjacentToWall) pp += TRAITS.lurker.hsPp; break;
    case 'Entry':
      if (unit.cardFlags.openingPickActive) break;
      if (ctx.engagementTicks <= TRAITS.entry.windowTicks) pp += TRAITS.entry.hsPp;
      break;
    case 'Clutch':
      // Pass 9 m4 — Last Stand removed; Clutch trait reverts to base.
      if (ctx.lastAlive) pp += TRAITS.clutch.hsPp;
      break;
    default: break;
  }
  return pp;
}

// Pass 8 — card-derived hit-rate contribution. Reads shooter.cardFlags + ctx
// flags. Independent of the trait/modifier sums above (additive on top).
function cardHitPp(unit: Unit, ctx: ShotContext): number {
  let pp = 0;
  // Anchor Position: extra Sentinel-style bonus while stationary 3+.
  if (unit.cardFlags.anchorPosition && ctx.stationaryTicks >= TRAITS.sentinel.stationaryTicks) {
    pp += CARD_EFFECTS.anchorPosition.hitPp;
  }
  // Reckless Push: +15 HR while moving (on top of Run-n-Gun's +15 if also that trait).
  if (unit.cardFlags.recklessPush && !ctx.stationary) {
    pp += CARD_EFFECTS.recklessPush.movingHitPp;
  }
  // Opening Pick: +30 HR first 3 engagement ticks (replaces Entry's +20).
  if (unit.cardFlags.openingPickActive && ctx.engagementTicks <= CARD_EFFECTS.openingPick.windowTicks) {
    pp += CARD_EFFECTS.openingPick.hitPp;
  }
  // Spearhead: +15 HR while in first engagement of the round.
  if (ctx.spearheadFirstEngagement) {
    pp += CARD_EFFECTS.spearhead.firstEngagementHitPp;
  }
  // Setup Play: +20 HR when this shooter is the named ally AND flanked.
  if (unit.cardFlags.setupPlayBonus && ctx.flankedByShooter) {
    pp += CARD_EFFECTS.setupPlay.flankHitPp;
  }
  // Hold the Line: Warden stationary at the anchor → +20 HR.
  if (ctx.warderAnchorStationary) {
    pp += CARD_EFFECTS.holdTheLine.stationaryHitPp;
  }
  // Mark Target: shots vs marked enemy +20 HR.
  if (ctx.markedTarget) {
    pp += CARD_EFFECTS.markTarget.hitPp;
  }
  return pp;
}

function cardHeadshotPp(unit: Unit, ctx: ShotContext): number {
  let pp = 0;
  if (unit.cardFlags.anchorPosition && ctx.stationaryTicks >= TRAITS.sentinel.stationaryTicks) {
    pp += CARD_EFFECTS.anchorPosition.hsPp;
  }
  if (unit.cardFlags.openingPickActive && ctx.engagementTicks <= CARD_EFFECTS.openingPick.windowTicks) {
    pp += CARD_EFFECTS.openingPick.hsPp;
  }
  if (ctx.markedTarget) {
    pp += CARD_EFFECTS.markTarget.hsPp;
  }
  return pp;
}

// Compute whether the shooter is flanking the target (>60° off target's facing
// bearing). Used by Setup Play.
function isFlanking(shooter: Unit, target: Unit, angleDeg: number): boolean {
  const a = offsetToPixel(target.pos.col, target.pos.row);
  const b = offsetToPixel(shooter.pos.col, shooter.pos.row);
  const shooterBearing = Math.atan2(b.y - a.y, b.x - a.x);
  // Target facing bearing (canonical neighbor order in unit-ai/vision; use the
  // pointy-top neighbor at the facing index as the reference).
  // Reproducing the bearing without circular import: facing 0..5 maps to angle
  // offsets along the 6 neighbors. We approximate via canonical hex directions.
  // For pointy-top w/ neighbor order E(0)/NE(1)/NW(2)/W(3)/SW(4)/SE(5):
  const FACING_RAD = [0, -Math.PI / 3, -2 * Math.PI / 3, Math.PI, 2 * Math.PI / 3, Math.PI / 3];
  const facingBearing = FACING_RAD[target.facing];
  let delta = Math.abs(shooterBearing - facingBearing);
  while (delta > Math.PI) delta = 2 * Math.PI - delta;
  return (delta * 180) / Math.PI > angleDeg;
}

// Dynamic-modifier hit contribution (spec §13.1). Aggression only counts in the
// first few ticks of a round; clutch-default applies when last alive without the
// Clutch trait (the trait itself is handled in traitHitPp).
function modifierHitPp(unit: Unit, ctx: ShotContext): number {
  let pp = 0;
  if (ctx.ticksIntoRound <= MODIFIERS.aggression.earlyTicks) {
    pp += (unit.modifiers.aggression - 50) * MODIFIERS.aggression.hrScale;
  }
  pp += (unit.modifiers.weaponHandling - 50) * MODIFIERS.weaponHandlingHrScale;
  if (unit.modifiers.offPosition) pp += MODIFIERS.offPositionHitPp;
  if (ctx.lastAlive && unit.behavioralTrait !== 'Clutch') pp += MODIFIERS.clutchDefault.hitPp;
  return pp;
}

function modifierHeadshotPp(unit: Unit, ctx: ShotContext): number {
  if (ctx.lastAlive && unit.behavioralTrait !== 'Clutch') return MODIFIERS.clutchDefault.hsPp;
  return 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function effectiveHitPct(shooter: Unit, ctx: ShotContext, buffs: readonly Buff[]): number {
  let pct = baseHitPct(shooter.weapon, ctx.band, ctx.stationary);
  pct += traitHitPp(shooter, ctx) + modifierHitPp(shooter, ctx) + cardHitPp(shooter, ctx) + sumBuff(buffs, 'hitPp');
  if (ctx.crossesCover) pct -= COVER_HIT_PENALTY_PP;
  return clamp(pct, HIT_CLAMP.minPct, HIT_CLAMP.maxPct);
}

export function headshotPct(shooter: Unit, ctx: ShotContext, buffs: readonly Buff[]): number {
  let pct = HEADSHOT.basePct;
  if (shooter.weapon === 'sniper' && ctx.stationary && ctx.band === 'long') {
    pct += HEADSHOT.sniperLongBonusPp;
  }
  pct += traitHeadshotPp(shooter, ctx) + modifierHeadshotPp(shooter, ctx) + cardHeadshotPp(shooter, ctx) + sumBuff(buffs, 'headshotPp');
  return clamp(pct, 0, 100);
}

// One shot: hit roll → (on hit) headshot roll → head/body damage. Pass 8:
// Hold-the-Line "safe window" short-circuits to a forced miss (the target is
// the ally inside a Warden's anchor window); the kill feed shows it as cover.
export function resolveShot(
  shooter: Unit,
  target: Unit,
  map: MapDefinition,
  input: ShotContextInput,
  buffs: readonly Buff[],
  cardEffects: readonly ActiveCardEffect[],
  currentTick: number,
  rng: Rng,
): ShotResult {
  // Forced-miss: Hold the Line safe window protects this target for N ticks.
  if ((target.cardFlags.safeWindowUntilTick ?? -1) > currentTick) {
    return { hit: false, headshot: false, damage: 0, band: rangeBand(hexDistance(shooter.pos, target.pos)), cover: false };
  }
  const dist = hexDistance(shooter.pos, target.pos);
  // Card-derived flags computed here so callers don't need to know the wiring.
  // Pass 9 m4 — honor optional expiresAtTick (Trade Window marks expire; Mark
  // Target marks don't carry the field so stay active round-long).
  const markedTarget = cardEffects.some(
    (e) =>
      e.kind === 'mark_target' &&
      e.team === shooter.team &&
      e.targetId === target.id &&
      (e.expiresAtTick === undefined || currentTick <= e.expiresAtTick),
  );
  const flankedByShooter = isFlanking(shooter, target, CARD_EFFECTS.setupPlay.flankAngleDeg);
  const warderAnchorStationary =
    shooter.cardFlags.holdTheLineAnchor !== undefined &&
    shooter.cardFlags.holdTheLineAnchor.col === shooter.pos.col &&
    shooter.cardFlags.holdTheLineAnchor.row === shooter.pos.row &&
    input.stationary;
  // Spearhead: while the flag is on, +15 HR during engagement.
  const spearheadFirstEngagement = !!shooter.cardFlags.spearhead && input.engagementTicks > 0;
  const ctx: ShotContext = {
    dist,
    band: rangeBand(dist),
    crossesCover: shotCrossesCover(shooter, target, map),
    markedTarget,
    flankedByShooter,
    warderAnchorStationary,
    spearheadFirstEngagement,
    ...input,
  };
  const hit = rng.chance(effectiveHitPct(shooter, ctx, buffs) / 100);
  let headshot = false;
  let damage = 0;
  if (hit) {
    headshot = rng.chance(headshotPct(shooter, ctx, buffs) / 100);
    const dmg = DAMAGE[shooter.weapon];
    damage = headshot ? dmg.head : dmg.body;
  }
  return { hit, headshot, damage, band: ctx.band, cover: ctx.crossesCover };
}
