// Combat resolution (spec §6).
//
// `resolveShot` is the per-shot nested-roll pipeline:
//   range band → base HR → effective HR (clamped) → hit roll →
//   on hit: headshot roll → damage selection.
//
// The "effective-stat seam" is the contribution hooks below
// (`traitHitPp`, `traitHeadshotPp`, `modifierHitPp`,
// `modifierHeadshotPp`, `cardHitPp`, `cardHeadshotPp`). Every pp
// contribution flows through one of them. Adding a new contributor
// = extending one hook; never touch the roll or clamp logic.
//
// Pure: given shooter/target/map/context/buffs/cardEffects/rng, return
// the shot's outcome. Tick.ts owns the call ordering + per-tick RNG.

import type { ActiveCardEffect, Buff, MapDefinition, RangeBand, Unit, Weapon } from './types.ts';
import type { Rng } from './rng.ts';
import { hexDistance, hexLine } from './hex.ts';
import {
  ATTRIBUTES,
  CARD_EFFECTS,
  COVER_HIT_PENALTY_PP,
  DAMAGE,
  COMMS,
  FIRE_RATE,
  FIRST_SIGHT_HIT_PENALTY_PP,
  HEADSHOT,
  HIT_CLAMP,
  HIT_TABLE,
  MODIFIERS,
  RANGE,
  SNIPER_SETTLED_TICKS,
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
  // (Pass C2 — `flankedByShooter` removed; Setup Play no longer flank-gated.)
  warderAnchorStationary: boolean; // Warden Hold-the-Line stationary at anchor
  spearheadFirstEngagement: boolean;
  // --- Pass B: peeker's advantage ---
  // True when the target's hex is in the shooter's per-unit visibility set
  // THIS tick but was NOT in the previous tick's set ("just appeared"). The
  // first shot in this case takes FIRST_SIGHT_HIT_PENALTY_PP off the HR.
  firstSightShot: boolean;
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
  firstSightShot: boolean;       // Pass B — peeker's advantage
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
// F2 — sniper "settled" now requires SNIPER_SETTLED_TICKS ticks of
// stillness, not just "didn't move this tick". A sniper that moved 1 tick
// ago is still on the moving table (heavily reduced HR). This is what the
// new sniper-speed rule trades for: same movement as other units, but no
// instant-shot lethality after moving.
function hitRow(weapon: Weapon, stationary: boolean, stationaryTicks: number): string {
  if (weapon === 'sniper') {
    const settled = stationary && stationaryTicks >= SNIPER_SETTLED_TICKS;
    return settled ? 'sniperStationary' : 'sniperMoving';
  }
  return weapon;
}

export function baseHitPct(
  weapon: Weapon,
  band: RangeBand,
  stationary: boolean,
  stationaryTicks: number,
): number {
  return HIT_TABLE[hitRow(weapon, stationary, stationaryTicks)][band];
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
    case 'First Shot':
      if (ctx.firstShot) {
        // F2 — Reflexes scales First Shot magnitude. (reflexes - 50) ×
        // multiplier added to 1.0 produces a 0.6×–1.4× scaling at the
        // [10, 90] tails. At rating 50 the scaling is 1.0 (no change).
        const reflexScale = 1 + (unit.attributes.reflexes - 50) * ATTRIBUTES.formulas.reflexes.firstShotMultiplier;
        pp += TRAITS.firstShotHitPp * reflexScale;
      }
      break;
    // H2 expansion — opposite-half of First Shot: sustained-fire retention
    // after the early-engagement window closes (ticks > 3). Pairs naturally
    // with Entry / opposes First Shot for "frame-1 reflex" specialists.
    case 'Spray Down':
      if (ctx.engagementTicks > TRAITS.sprayDown.afterTicks) pp += TRAITS.sprayDown.hitPp;
      break;
    // Range specialists: read shot's resolved range band directly.
    case 'Deadeye':
      if (ctx.band === 'long') pp += TRAITS.deadeyeLongHitPp;
      break;
    case 'Close Quarters':
      if (ctx.band === 'short') pp += TRAITS.closeQuartersShortHitPp;
      break;
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
      // Pass H1 — Composure attribute (was Clutch attribute) scales the
      // magnitude on top of the trait flat: high-Composure trait holders are
      // extra-dangerous when alone, low ones underperform their own trait.
      if (ctx.lastAlive) {
        pp += TRAITS.clutch.hitPp
            + (unit.attributes.composure - 50) * ATTRIBUTES.formulas.composure.withTraitMultiplier;
      }
      break;
    // H2 expansion — Roamer / Hot Head are pure-stat traits (their entire
    // effect lives in TRAITS_BY_ID.attrBonuses). No combat hook needed.
    default: break;
  }
  // H2 expansion — personality trait combat hooks (only Patient is
  // round-time-conditional; Big Brain / Ego / Composed / Leader / Lone Wolf /
  // Paranoid / Old Pro are pure-stat traits via attrBonuses).
  switch (unit.personalityTrait) {
    case 'Patient':
      if (ctx.ticksIntoRound > TRAITS.patient.afterTick) pp += TRAITS.patient.hitPp;
      break;
    default: break;
  }
  // Phase 3 — team-trade coordination scaled by Leadership (comms). When a
  // teammate just fired (a live engagement to trade into), HR shifts by comms
  // relative to neutral. Applies to every unit (stacks with the Trader trait),
  // making Leadership mechanically real. Measurement-gated (config.COMMS).
  if (COMMS.enabled && ctx.allyFiredRecently) {
    pp += (unit.attributes.comms - 50) * COMMS.tradeScalePerPt;
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
      // Pass H1 — Composure attribute scales the trait HS bonus, same shape as HR.
      if (ctx.lastAlive) {
        pp += TRAITS.clutch.hsPp
            + (unit.attributes.composure - 50) * ATTRIBUTES.formulas.composure.withTraitMultiplier;
      }
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
  // Setup Play: Pass C2 — +20 HR when this shooter is the named ally AND
  // within `allyRangeHexes` of the anchor (flank gate dropped). Anchor hex
  // lives on the ally's cardFlags so we range-check at shot time.
  if (unit.cardFlags.setupPlayBonus && unit.cardFlags.setupPlayAnchor) {
    const dist = hexDistance(unit.pos, unit.cardFlags.setupPlayAnchor);
    if (dist <= CARD_EFFECTS.setupPlay.allyRangeHexes) {
      pp += CARD_EFFECTS.setupPlay.allyHitPp;
    }
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

// (Pass C2 — `isFlanking` helper removed; Setup Play no longer needs a
// flank-angle gate. Could be revived for a future card that wants angle-of-
// attack as a condition.)

// Dynamic-modifier hit contribution (spec §13.1). Aggression only counts in the
// first few ticks of a round; clutch-default applies when last alive without the
// Clutch trait (the trait itself is handled in traitHitPp).
function modifierHitPp(unit: Unit, ctx: ShotContext): number {
  let pp = 0;
  if (ctx.ticksIntoRound <= MODIFIERS.aggression.earlyTicks) {
    pp += (unit.modifiers.aggression - 50) * MODIFIERS.aggression.hrScale;
  }
  // (Pass A3 — weapon-handling moved to attributeHitPp as a per-weapon
  // sub-rating; this function now covers only the true flat modifiers.)
  if (unit.modifiers.offPosition) pp += MODIFIERS.offPositionHitPp;
  // Pass A4 — last-alive default bonus is now attribute-driven (the flat
  // `MODIFIERS.clutchDefault.hitPp` is gone). A low-Clutch unit who's last
  // alive takes a *penalty*; a high-Clutch one gets a small bonus. Trait
  // holders pick up their own attribute-scaled bonus in traitHitPp.
  if (ctx.lastAlive && unit.behavioralTrait !== 'Clutch') {
    pp += (unit.attributes.composure - 50) * ATTRIBUTES.formulas.composure.withoutTraitMultiplier;
  }
  return pp;
}

function modifierHeadshotPp(unit: Unit, ctx: ShotContext): number {
  // Pass H1 — same shape on the HS side; reads Composure (was Clutch attr).
  if (ctx.lastAlive && unit.behavioralTrait !== 'Clutch') {
    return (unit.attributes.composure - 50) * ATTRIBUTES.formulas.composure.withoutTraitMultiplier;
  }
  return 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Pass A2 — per-unit attribute contribution to the hit roll. Continuous-rating
// counterpart to the categorical trait/role bonuses; sits in the same
// effective-stat seam.
// Pass H1 — replaces the three per-weapon handling sub-attributes
// (rifle/shotgun/sniperHandling) with a single weaponAffinity sub-attribute
// that reads against whatever weapon the unit currently holds. A unit's
// affinity carries across loadout swaps; per-weapon specialization is now
// expressed via traits (e.g. Headhunter is rifle-only).
function attributeHitPp(unit: Unit): number {
  // Aim: (rating - 50) × multiplier pp. Neutral at 50, ±8pp at the
  // generation tails (10, 90) with the default 0.2 multiplier.
  const aim = (unit.attributes.aim - 50) * ATTRIBUTES.formulas.aim.multiplier;
  // Weapon Affinity (Pass H1): same shape as Aim but with a smaller weight
  // (default 0.1 multiplier → ±4pp at the tails). The contribution is
  // weapon-agnostic; the unit either has a feel for their gear or doesn't.
  const handling = (unit.attributes.weaponAffinity - 50)
                 * ATTRIBUTES.formulas.weaponAffinity.multiplier;
  return aim + handling;
}

export function effectiveHitPct(shooter: Unit, ctx: ShotContext, buffs: readonly Buff[]): number {
  let pct = baseHitPct(shooter.weapon, ctx.band, ctx.stationary, ctx.stationaryTicks);
  pct += traitHitPp(shooter, ctx)
       + modifierHitPp(shooter, ctx)
       + cardHitPp(shooter, ctx)
       + attributeHitPp(shooter)
       + sumBuff(buffs, 'hitPp');
  if (ctx.crossesCover) pct -= COVER_HIT_PENALTY_PP;
  // Pass B — peeker's advantage: first-sight first shot reacts late.
  if (ctx.firstSightShot) pct -= FIRST_SIGHT_HIT_PENALTY_PP;
  return clamp(pct, HIT_CLAMP.minPct, HIT_CLAMP.maxPct);
}

// F2 — Headshot attribute: linear pp shift on the headshot roll. Same shape
// as Aim on the hit roll. Wired through headshotPct alongside traits, cards,
// modifiers, and buffs in the existing effective-stat seam.
function attributeHeadshotPp(unit: Unit): number {
  return (unit.attributes.headshot - 50) * ATTRIBUTES.formulas.headshot.multiplier;
}

export function headshotPct(shooter: Unit, ctx: ShotContext, buffs: readonly Buff[]): number {
  let pct = HEADSHOT.basePct;
  if (shooter.weapon === 'sniper' && ctx.stationary && ctx.band === 'long') {
    pct += HEADSHOT.sniperLongBonusPp;
  }
  pct += traitHeadshotPp(shooter, ctx)
       + modifierHeadshotPp(shooter, ctx)
       + cardHeadshotPp(shooter, ctx)
       + attributeHeadshotPp(shooter)
       + sumBuff(buffs, 'headshotPp');
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

// Decision-time estimate of `shooter`'s expected damage per tick against
// `target` at the current geometry — the input to the AI's engagement gate
// (engage.ts). Routes through the real effective-stat seam, so the mark, traits,
// cover, range, weapon and attributes all flow in; weighs head/body damage and
// fire rate so a sniper's 2/4 every-2-ticks reads as the threat it is. The
// engagement-progression ctx (firstShot / settle / peeker's) is approximated to
// a neutral *settled* steady state — the AI is sizing up the duel before it
// starts, and assuming the other side is settled is the appropriately cautious
// read. Pure, no RNG. (Distinct from resolveShot, which uses the live per-tick
// ctx; this is only a heuristic for "is this fight worth taking?")
export function estimateEdpt(
  shooter: Unit,
  target: Unit,
  map: MapDefinition,
  buffs: readonly Buff[],
  cardEffects: readonly ActiveCardEffect[],
  currentTick: number,
  lastAlive: boolean,
): number {
  const dist = hexDistance(shooter.pos, target.pos);
  const markedTarget = cardEffects.some(
    (e) =>
      e.kind === 'mark_target' &&
      e.team === shooter.team &&
      e.targetId === target.id &&
      (e.expiresAtTick === undefined || currentTick <= e.expiresAtTick),
  );
  const ctx: ShotContext = {
    dist,
    band: rangeBand(dist),
    stationary: true,
    crossesCover: shotCrossesCover(shooter, target, map),
    stationaryTicks: SNIPER_SETTLED_TICKS,
    engagementTicks: 2,
    firstShot: false,
    allyFiredRecently: false,
    lastAlive,
    adjacentToWall: false,
    ticksIntoRound: currentTick,
    markedTarget,
    warderAnchorStationary: false,
    spearheadFirstEngagement: false,
    firstSightShot: false,
  };
  const hr = effectiveHitPct(shooter, ctx, buffs) / 100;
  const hs = headshotPct(shooter, ctx, buffs) / 100;
  const dmg = DAMAGE[shooter.weapon];
  const expDamagePerShot = (1 - hs) * dmg.body + hs * dmg.head;
  return (hr * expDamagePerShot) / FIRE_RATE[shooter.weapon];
}
