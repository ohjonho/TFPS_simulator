// Pass 5 — combat resolution (spec §7.2 nested rolls) + the effective-stat
// summation seam that traits/role/hero (Pass 6) and cards (Pass 8) feed.
// Pure: given shooter/target/map/state, roll a shot and return its outcome.

import type { Buff, MapDefinition, RangeBand, Unit, Weapon } from './types.ts';
import type { Rng } from './rng.ts';
import { hexDistance, hexLine } from './hex.ts';
import {
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
// one of each, so the matching branches simply sum.
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
    case 'Entry': pp += ctx.engagementTicks <= TRAITS.entry.windowTicks ? TRAITS.entry.hitPp : TRAITS.entry.postPenaltyHitPp; break;
    case 'Trader': if (ctx.allyFiredRecently) pp += TRAITS.trader.hitPp; break;
    case 'Clutch': if (ctx.lastAlive) pp += TRAITS.clutch.hitPp; break;
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
    case 'Entry': if (ctx.engagementTicks <= TRAITS.entry.windowTicks) pp += TRAITS.entry.hsPp; break;
    case 'Clutch': if (ctx.lastAlive) pp += TRAITS.clutch.hsPp; break;
    default: break;
  }
  return pp;
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
  pct += traitHitPp(shooter, ctx) + modifierHitPp(shooter, ctx) + sumBuff(buffs, 'hitPp');
  if (ctx.crossesCover) pct -= COVER_HIT_PENALTY_PP;
  return clamp(pct, HIT_CLAMP.minPct, HIT_CLAMP.maxPct);
}

export function headshotPct(shooter: Unit, ctx: ShotContext, buffs: readonly Buff[]): number {
  let pct = HEADSHOT.basePct;
  if (shooter.weapon === 'sniper' && ctx.stationary && ctx.band === 'long') {
    pct += HEADSHOT.sniperLongBonusPp;
  }
  pct += traitHeadshotPp(shooter, ctx) + modifierHeadshotPp(shooter, ctx) + sumBuff(buffs, 'headshotPp');
  return clamp(pct, 0, 100);
}

// One shot: hit roll → (on hit) headshot roll → head/body damage.
export function resolveShot(
  shooter: Unit,
  target: Unit,
  map: MapDefinition,
  input: ShotContextInput,
  buffs: readonly Buff[],
  rng: Rng,
): ShotResult {
  const dist = hexDistance(shooter.pos, target.pos);
  const ctx: ShotContext = {
    dist,
    band: rangeBand(dist),
    crossesCover: shotCrossesCover(shooter, target, map),
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
