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

import type { ActiveCardEffect, Attributes, Buff, MapDefinition, Modifiers, RangeBand, Unit, Weapon } from './types.ts';
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
  HERO_ABILITIES,
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
  // Pass 3 (heroes) — shooter is inside an active Angelic Rally (+HR). A team
  // decision buff like markedTarget, so it's carried on ctx (survives the
  // neutral odds clone); the odds estimate sets it false to avoid the rally
  // double-counting (its primary lever is the engage-threshold drop).
  rallied: boolean;
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

// v0.29.0 — tactical-trait hit-rate contribution (spec §12). A unit has up to 2
// tactical traits; each combat-relevant one adds its conditional bonus. (Aggressor
// /Freelancer/Disciplined own the engage threshold + compliance, not a per-shot
// HR hook; personalities are stat-only.)
function traitHitPp(unit: Unit, ctx: ShotContext): number {
  let pp = 0;
  const t = unit.tacticalTraits;
  // Marksman — flat HR on every shot (the prized mechanical edge).
  if (t.includes('Marksman')) pp += TRAITS.marksmanHitPp;
  // Aggressor — +HR while moving (pushes in, shooting).
  if (t.includes('Aggressor') && !ctx.stationary) pp += TRAITS.aggressorMovingHitPp;
  // Anchor — +HR once settled (stationary 3+ ticks).
  if (t.includes('Anchor') && ctx.stationaryTicks >= TRAITS.anchor.stationaryTicks) pp += TRAITS.anchor.hitPp;
  // Flanker — +HR hugging walls / map edges.
  if (t.includes('Flanker') && ctx.adjacentToWall) pp += TRAITS.flanker.hitPp;
  // Trader — +HR right after a teammate fired (a trade to punish).
  if (t.includes('Trader') && ctx.allyFiredRecently) pp += TRAITS.trader.hitPp;
  // Clutch — surge when last alive (Composure scales the magnitude).
  if (t.includes('Clutch') && ctx.lastAlive) {
    pp += TRAITS.clutch.hitPp + (unit.attributes.composure - 50) * ATTRIBUTES.formulas.composure.withTraitMultiplier;
  }
  // Team-trade coordination scaled by Leadership (comms) — applies to every unit
  // when a teammate just fired (stacks with the Trader trait). config.COMMS.
  if (COMMS.enabled && ctx.allyFiredRecently) {
    pp += (unit.attributes.comms - 50) * COMMS.tradeScalePerPt;
  }
  return pp;
}

function traitHeadshotPp(unit: Unit, ctx: ShotContext): number {
  let pp = 0;
  const t = unit.tacticalTraits;
  if (t.includes('Anchor') && ctx.stationaryTicks >= TRAITS.anchor.stationaryTicks) pp += TRAITS.anchor.hsPp;
  if (t.includes('Flanker') && ctx.adjacentToWall) pp += TRAITS.flanker.hsPp;
  if (t.includes('Clutch') && ctx.lastAlive) {
    pp += TRAITS.clutch.hsPp + (unit.attributes.composure - 50) * ATTRIBUTES.formulas.composure.withTraitMultiplier;
  }
  return pp;
}

// Pass 8 — card-derived hit-rate contribution. Reads shooter.cardFlags + ctx
// flags. Independent of the trait/modifier sums above (additive on top).
function cardHitPp(unit: Unit, ctx: ShotContext): number {
  let pp = 0;
  // Anchor Position: extra Sentinel-style bonus while stationary 3+.
  if (unit.cardFlags.anchorPosition && ctx.stationaryTicks >= TRAITS.anchor.stationaryTicks) {
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
  // Pass 3 — Angelic Rally: allies inside the active rally hit harder.
  if (ctx.rallied) {
    pp += HERO_ABILITIES.angelicRally.hitPp;
  }
  // Pass 3 — Cursed weak passive ("hunter"): flat self +HR. Behind a cardFlag
  // (not a hero check) so the neutral odds clone strips it — it wins the fights
  // Cursed takes without making Cursed take more.
  if (unit.cardFlags.hunterBonus) {
    pp += HERO_ABILITIES.cursedSelfHitPp;
  }
  return pp;
}

function cardHeadshotPp(unit: Unit, ctx: ShotContext): number {
  let pp = 0;
  if (unit.cardFlags.anchorPosition && ctx.stationaryTicks >= TRAITS.anchor.stationaryTicks) {
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
  if (ctx.lastAlive && !unit.tacticalTraits.includes('Clutch')) {
    pp += (unit.attributes.composure - 50) * ATTRIBUTES.formulas.composure.withoutTraitMultiplier;
  }
  return pp;
}

function modifierHeadshotPp(unit: Unit, ctx: ShotContext): number {
  // Pass H1 — same shape on the HS side; reads Composure (was Clutch attr).
  if (ctx.lastAlive && !unit.tacticalTraits.includes('Clutch')) {
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
    rallied: (shooter.cardFlags.rallyUntilTick ?? -1) > currentTick,
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

// v0.25.0 — neutral per-unit power, used by the skill-neutral engage-odds path.
// Mirrors units.ts NEUTRAL_ATTRIBUTES + the construction-time neutral Modifiers
// (all 50 / no off-position), so a shooter cloned with these contributes zero
// attribute/modifier HR — the effective-stat seam then reflects only the
// tactical matchup (weapon/range/cover/fire-rate/mark).
const NEUTRAL_ATTRS: Attributes = {
  aim: 50, headshot: 50, reflexes: 50, weaponAffinity: 50,
  vision: 50, mapIQ: 50, tenacity: 50, composure: 50, adaptability: 50, comms: 50,
};
const NEUTRAL_MODS: Modifiers = {
  aggression: 50, baseAggression: 50, offPosition: false, retreatThresholdMod: 0,
};

// Decision-time estimate of `shooter`'s expected damage per tick against
// `target` at the current geometry — the input to the AI's engagement gate
// (engage.ts). `skillOddsWeight` (config.ENGAGE.skillOddsWeight, 0..1) blends
// this between FULL personal power (1.0 = the original full effective-stat read)
// and a power-stripped NEUTRAL clone (0.0 — attributes/modifiers 50, no trait
// HR/HS, no card flags, no buffs). Below 1.0 it partially decouples combat POWER
// from the commit DECISION, so skill traits win the fights you take rather than
// (perversely) making you take more. Real damage (resolveShot) is unaffected.
// The neutral read is byte-equivalent to the unit for a flat-50 / no-trait
// roster, so the vanilla baseline is provably unchanged at any weight. Routes through the real effective-stat seam, so the mark, traits,
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
  skillOddsWeight = 1,
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
    rallied: false, // rally's odds lever is the threshold drop, not inflated EDPT
    firstSightShot: false,
  };
  const dmg = DAMAGE[shooter.weapon];
  const fr = FIRE_RATE[shooter.weapon];
  const edptOf = (s: Unit, b: readonly Buff[]): number => {
    const hr = effectiveHitPct(s, ctx, b) / 100;
    const hs = headshotPct(s, ctx, b) / 100;
    return (hr * ((1 - hs) * dmg.body + hs * dmg.head)) / fr;
  };
  // Full personal-power read (the original behavior). At weight 1.0 we're done.
  const full = edptOf(shooter, buffs);
  if (skillOddsWeight >= 1) return full;
  // Neutral read: power stripped to baseline so the odds carry only the tactical
  // matchup. Real weapon kept (sniper vs rifle IS tactical), as is the mark bonus
  // (ctx.markedTarget — a team state, not personal skill). Blend toward full by
  // skillOddsWeight (0 = fully neutral). Byte-equal to `full` for a flat-50 /
  // no-trait unit, so the vanilla baseline is unchanged at any weight.
  const neutralShooter: Unit = {
    ...shooter, attributes: NEUTRAL_ATTRS, modifiers: NEUTRAL_MODS,
    tacticalTraits: [], personality: null, cardFlags: {},
  };
  const neutral = edptOf(neutralShooter, []);
  return neutral + skillOddsWeight * (full - neutral);
}
