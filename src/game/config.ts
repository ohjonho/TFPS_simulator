// All tunable values for the simulator live here. No magic numbers in game logic.
// CLAUDE.md rule: pull every tunable into config so the management layer can
// later override per-unit stats without code changes.

import type { CellType, RangeBand, Weapon } from './types.ts';

export const GRID = {
  cols: 30,
  rows: 40,
} as const;

// Pointy-top hex geometry (spec §4.1, matching hex_maps_foundry_atoll.html).
// `size` is center-to-corner. Derived: column step W = size*√3, row step
// VS = size*1.5. MX/MY pad the grid so edge hexes aren't clipped.
const HEX_SIZE = 13;
export const HEX = {
  size: HEX_SIZE,
  orientation: 'pointy-top',
  w: HEX_SIZE * Math.sqrt(3),
  vs: HEX_SIZE * 1.5,
  mx: 12,
  my: 12,
} as const;

// Loadouts are pre-assigned in v0. Index 0/1/2 maps to unit slot 1/2/3 on each
// team. Pass 1 uses 2 rifles + 1 sniper per team per the prompt.
export const LOADOUTS = {
  defenders: ['rifle', 'rifle', 'sniper'],
  attackers: ['rifle', 'rifle', 'sniper'],
} as const;

export const UNIT_DEFAULTS = {
  maxHp: 3,
} as const;

// Per-CellType fill + stroke. Palette lifted from the HTML prototype's COL/STR
// tables so the rendered map matches the prototype and all 8 types read as
// visually distinct.
export const CELL_COLORS: Record<CellType, { fill: string; stroke: string }> = {
  wall:  { fill: '#0F1215', stroke: '#1A1E22' },
  open:  { fill: '#4E6474', stroke: '#5C7386' },
  def:   { fill: '#6B3030', stroke: '#833838' },
  atk:   { fill: '#2A6655', stroke: '#357A66' },
  site:  { fill: '#9B4545', stroke: '#B05252' },
  plant: { fill: '#C06060', stroke: '#CC6868' },
  mid:   { fill: '#3D5568', stroke: '#4A6578' },
  cover: { fill: '#3B4A36', stroke: '#4A5A44' },
} as const;

export const COLORS = {
  bg: '#0e1116',
  defenderUnit: '#3b82f6',
  attackerUnit: '#ef4444',
  unitLabel: '#ffffff',
  highlight: '#facc15',
} as const;

// Single-letter glyphs used as weapon icons inside the unit square.
export const WEAPON_GLYPH = {
  shotgun: 'G',
  rifle: 'R',
  sniper: 'S',
} as const;

// Real-time tick duration at 1× speed. Higher speeds divide this. (Used by the
// playback loop in the Pass 2 REDO; kept here so the controls placeholder and
// future loop share one source.)
export const TICK = {
  msAt1x: 1000,
} as const;

export const PLAYBACK_SPEEDS = [1, 2, 4] as const;

// Hex-units of movement per tick, per weapon. Sniper 0.5 → one hex every two
// ticks. Behavioral-trait speed bonuses (Run-n-Gun) layer on in Pass 6.
export const SPEED: Record<Weapon, number> = {
  shotgun: 1.0,
  rifle: 1.0,
  sniper: 0.5,
};

// Movement modifiers. runAndGunBonus is a Pass 6 hook — read by effectiveSpeed
// but inert in Pass 2 (all behavioral traits are null until then).
export const MOVE = {
  runAndGunBonus: 0.5,
  // Pass B — cover-aware pathing. A* g-cost adds this much per step when the
  // step lands on a hex with NO cover-adjacent neighbor. Small enough that
  // strictly-shorter paths still win; large enough that equally-short routes
  // prefer cover-adjacent hexes. Iteration: tried 0.5, made Rush worse
  // (detours added exposure ticks faster than cover saved); reverted to 0.3.
  coverPathPreference: 0.3,
} as const;

// Fixed seed for the PRNG so a round resolves identically across replays.
export const RNG_SEED_DEFAULT = 0x1a2b3c4d;

// Pending-route overlay (dev aid): faint breadcrumb along a unit's A* path.
export const ROUTE_STYLE = {
  lineWidth: 2.5,
  upcoming: 'rgba(250, 204, 21, 0.55)',  // hexes not yet traversed
  traversed: 'rgba(250, 204, 21, 0.18)', // already passed
  nodeRadiusFactor: 0.18,                // × HEX.size
} as const;

// Selected-unit outline (distinct from the hover highlight).
export const SELECTION_COLOR = '#22d3ee';

// --- Pass 3: vision -------------------------------------------------------
// Cone HALF-angles in degrees (full cone = 2×). Per spec §5.3/§6.1:
// default 90° (half 45); sniper stationary 45° (half 22.5), moving 90°;
// Eagle Eye adds +30° full (+15 half) → 120° normal / 75° stationary sniper.
// Ghost markers persist `ghostTicks` after losing sight; cone snap reverts once
// the tracked enemy has been unseen for `trackLossThreshold` consecutive ticks.
export const VISION = {
  defaultConeHalfDeg: 45,
  sniperStationaryHalfDeg: 22.5,
  eagleEyeBonusHalfDeg: 15,
  ghostTicks: 5,
  trackLossThreshold: 3,
} as const;

// 'v' / 'V' toggles the debug vision overlay.
export const DEBUG_KEY = 'v';

// --- Pass 4: per-unit AI --------------------------------------------------
// retreatHpThreshold: at or below this HP a unit retreats (default behavior;
// Sentinel/Entry/Clutch override in Pass 6). resumeAfterTicks: ticks of no
// visible enemy before an idle/disengaged unit resumes moving to its region.
export const AI = {
  retreatHpThreshold: 1,
  resumeAfterTicks: 3,
} as const;

// Ticks between shots, per weapon. Snipers fire every 2 ticks (spec §5.3).
export const FIRE_RATE: Record<Weapon, number> = {
  shotgun: 1,
  rifle: 1,
  sniper: 2,
};

// --- Pass 5: combat -------------------------------------------------------
// Range bands by hex distance (spec §4.3): short 1–4, medium 5–10, long 11+.
export const RANGE = { shortMax: 4, mediumMax: 10 } as const;

// Base hit % by weapon × range band (spec §5.3). Snipers split moving vs
// stationary; the table is keyed by an effective "row" the combat code selects.
// Pass A6 recalibration — reduce ceiling clipping. The 95% HIT_CLAMP cap was
// silently absorbing all the high-aim / trait bonuses for two specific cells
// (sniper-stationary-long and shotgun-short), making attribute and trait
// investment invisible at exactly the engagements that should reward them.
// Lowered both 90 → 80 so high-aim attackers grow into headroom rather than
// defenders sitting permanently at the cap. Net effect: long-range sniper
// holds are still dominant (80% base) but not unkillable; attribute variance
// asymmetrically benefits attackers a bit more.
export const HIT_TABLE: Record<string, Record<RangeBand, number>> = {
  shotgun: { short: 80, medium: 30, long: 5 },
  rifle: { short: 70, medium: 75, long: 55 },
  sniperStationary: { short: 30, medium: 60, long: 80 },
  sniperMoving: { short: 15, medium: 30, long: 45 },
};

// Body / head damage per weapon (spec §5.3).
export const DAMAGE: Record<Weapon, { body: number; head: number }> = {
  shotgun: { body: 1, head: 2 },
  rifle: { body: 1, head: 2 },
  sniper: { body: 2, head: 4 },
};

// Headshot chance: 30% base; a stationary sniper at long range gets +10pp (40%).
export const HEADSHOT = { basePct: 30, sniperLongBonusPp: 10 } as const;

// Half-wall cover reduces incoming hit chance by 20pp when the shot crosses it.
export const COVER_HIT_PENALTY_PP = 20;

// Final hit % is clamped to this window (spec §7.2).
export const HIT_CLAMP = { minPct: 5, maxPct: 95 } as const;

// --- Pass 6: traits / roles / modifiers (spec §12–13) --------------------
// Trait hit/headshot bonuses in percentage points. Conditions are evaluated in
// combat.ts against the per-shot context.
export const TRAITS = {
  sharpAimHitPp: 10,
  headhunterHsPp: 10,
  firstShotHitPp: 20,
  sentinel: { hitPp: 25, hsPp: 20, stationaryTicks: 3 },
  runAndGunMovingHitPp: 15,
  lurker: { hitPp: 20, hsPp: 10 },
  entry: { hitPp: 20, hsPp: 15, postPenaltyHitPp: -10, windowTicks: 3 },
  trader: { hitPp: 15, windowTicks: 3 },
  clutch: { hitPp: 20, hsPp: 15 },
} as const;

// Per-role base aggression rating (0–100), spec §13.1.
export const ROLE_AGGRESSION = {
  Vanguard: 70,
  Tactician: 50,
  Warden: 35,
  Specialist: 55,
} as const;

// Dynamic modifier scales (spec §13.1).
// (Pass A3 — `weaponHandlingHrScale` removed; per-weapon handling is now an
// attribute sub-rating with its scale in `ATTRIBUTES.formulas.weaponHandling`.)
// (Pass A4 — `clutchDefault` removed; the no-trait last-alive bonus is now
// attribute-driven via `ATTRIBUTES.formulas.clutch.withoutTraitMultiplier`.)
export const MODIFIERS = {
  aggression: { hrScale: 0.2, earlyTicks: 3 },
  offPositionHitPp: -10,
} as const;

// --- Pass A1: per-unit attributes (docs/attributes-design.md §6.7) -------
// All numbers tunable. Pass A1 only consumes `generation`; combat/vision
// formulas come online in A2-A4; performance-stats config in A5.
export const ATTRIBUTES = {
  generation: {
    // 'flat': every attribute = 50 (deterministic, removes attribute RNG as
    //   a confound; the v0 debugging default).
    // 'normal': truncated-normal sample, the design-doc default — used for
    //   variety once the rest of the sim is balanced.
    // 'uniform': uniform in [min, max].
    // v1 plan: per-unit base attributes will live on the roster (35-45 range
    //   for rookies with a standout, training raises individuals into the
    //   60s-80s over time). Generation here will then only fill missing slots.
    distribution: 'flat' as 'flat' | 'normal' | 'uniform',
    mean: 50,
    stdDev: 12,
    min: 10,
    max: 90,
  },
  formulas: {
    aim: { multiplier: 0.2 },                                   // pp per (rating-50); A2
    weaponHandling: { multiplier: 0.1 },                        // pp per (rating-50); A3
    awareness: {
      coneMultiplier: 0.4,                                      // deg per (rating-50); A4
      coneCap: 20,                                              // ±deg cap
      ghostHighThreshold: 70,                                   // +1 ghost tick above
      ghostLowThreshold: 30,                                    // -1 ghost tick below
    },
    clutch: {
      withTraitMultiplier: 0.15,                                // stacks on Clutch trait; A4
      withoutTraitMultiplier: 0.15,                             // default last-alive bonus; A4
    },
  },
  performanceStats: {
    acs: {
      killValue: 200,
      assistValue: 50,
      multikill3K: 400,                                         // 3v3-scaled (3K = ace)
      damageMultiplier: 1,
    },
    assistWindowTicks: 5,
    tradeWindowTicks: 5,
  },
} as const;

// At or above this aggression an idle, order-less unit advances toward the
// enemy spawn; below it the unit holds. Lightweight role-movement tendency
// (superseded by Pass 7 strategy/region assignment).
export const AGGRESSION_PUSH_THRESHOLD = 55;

// --- Pass 7: strategies (spec §14) --------------------------------------
// Per-strategy aggression and retreat-threshold deltas applied at round start.
// retreatThreshold is added to AI.retreatHpThreshold (a −1 here means a unit
// won't retreat until hp <= 0, i.e., effectively no retreat).
export const STRATEGY_MODS: Record<string, { aggression: number; retreatThreshold: number }> = {
  Execute:  { aggression:   0, retreatThreshold: 0 },
  Rush:     { aggression: +10, retreatThreshold: -1 },
  Control:  { aggression: -10, retreatThreshold: 0 },
  Hold:     { aggression:   0, retreatThreshold: 0 },
  Stack:    { aggression:   0, retreatThreshold: 0 },
  Pressure: { aggression: +10, retreatThreshold: 0 },
};

// Match length: first team to this many round wins.
export const MATCH_WIN_SCORE = 4;
// Number of regular rounds before sudden-death territory (Pass 9).
export const MATCH_ROUND_COUNT = 6;
// Halftime occurs after this round number.
export const HALFTIME_AFTER_ROUND = 3;

// Round time limit in ticks. If a round runs this long without one team being
// eliminated, the team currently on the defender side wins (Pass 7.5 fix —
// tactical-FPS "attackers ran out of time" semantics). Pass 7.7 lowered from
// 90 → 60 so no-engagement rounds resolve faster on v2 maps.
export const ROUND_TICK_LIMIT = 60;

// Pass 7.7 — light stalemate breaker. A unit in mode='holding' that has not
// seen any enemy for this many ticks since round start re-targets to the mid
// centroid (where contact is most likely). Applies to both sides.
export const ROTATE_AFTER_HOLD_TICKS = 15;

// Pass 7.8 — minimum tick before "all units holding" can end a round. Without
// this, on a no-LoS map a round can end at tick ~5 with zero shots fired (all
// units reach spawn-adjacent region targets and settle to holding before any
// engagement). Set above ROTATE_AFTER_HOLD_TICKS so rotation has fired first.
export const MIN_ROUND_TICKS_FOR_HOLD_END = 20;

// Pass 7.8 — exploration noise added to AI strategy weights so a single early
// win doesn't lock the AI into one option for the whole match. Per pick, a
// uniform [0, AI_STRATEGY_EXPLORATION) is added on top of `1 + wins`.
export const AI_STRATEGY_EXPLORATION = 2;

// --- Pass B: spike-plant mechanic + peeker's advantage -------------------
// Plant: an alive attacker must remain on a plant hex (a_plant / b_plant)
// for PLANT_TICKS contiguous ticks with no alive defender on the same site's
// plant hexes. Once the spike is down, DETONATION_TICKS later the attacker
// team wins. Defenders can defuse by standing on the planted site's plant
// hexes for DEFUSE_TICKS contiguous ticks with no attacker present.
export const PLANT_TICKS = 2;
// Pass B iteration: 15 → 20 ticks. Gives defenders more rotation time to
// actually reach the planted site and defuse (zero defuses across 450 rounds
// at 15-tick suggested defenders couldn't get there in time).
export const DETONATION_TICKS = 20;
export const DEFUSE_TICKS = 4;

// Pass B — peeker's advantage. When a shooter fires at a target whose hex
// was in their team's per-unit visibility set this tick but NOT the previous
// tick ("first sight"), the first shot takes this HR penalty. Models the
// held angle's reaction lag. Symmetric on first sight; in practice defenders
// pay it more often (attackers enter their cones more than vice versa).
export const FIRST_SIGHT_HIT_PENALTY_PP = 10;

// Pass 9 m2 — sticky-engage window. Once a unit transitions to `engaged`, it
// stays in that mode for up to this many ticks of no visible enemy before
// reverting to the default behavior tree. Prevents the 1-tick flip-flop when
// an engaged enemy briefly steps behind a wall.
export const STAY_ENGAGED_TICKS = 2;

// Pass E m2 — post-plant attacker cover-seek. After the spike is planted,
// remaining alive attackers not on the plant zone re-target to a
// cover-adjacent hex within this radius (of their current pos) that has line
// of sight to the plant centroid, so they can pick off defusers. Pre-Pass-E
// they kept their pre-plant directive (wandering); now they hold the angle.
// `PreferredRange` biases the candidate score toward rifle/sniper sweet-spot
// distances — anything in [min, max] gets a flat bonus.
export const POST_PLANT_SEARCH_RADIUS = 6;
export const POST_PLANT_PREFERRED_RANGE = { min: 4, max: 10 } as const;

// Pass E m5 — Randomize Units mode. The top-bar toggle flips matches between
// "Standard" (today's fixed 2r+1s loadout + flat-50 attributes) and
// "Randomize" (seeded random loadouts + attributes uniform in [40, 60] +
// random traits/skills). Foundation for the v1 management/training layer.
export const LOADOUT_POOL: readonly Weapon[] = ['shotgun', 'rifle', 'sniper'];
export const RANDOMIZE_ATTRIBUTES = { min: 40, max: 60 } as const;

// --- Pass 8: cards (spec §15) --------------------------------------------
// Every per-card tunable. Card handlers read these — no magic numbers in the
// handler bodies. Hit-pp values are additive to the effective-stat sum in
// combat.ts; HS-pp likewise to the headshot pct.
export const CARD_EFFECTS = {
  // Anchor Position adds these on top of the Sentinel trait bonus when active
  // and the unit is stationary 3+ ticks (so total = trait 25/20 + card 25/20).
  // Pass C2: the card no longer locks the unit to spawn — it follows the
  // strategy normally, and the bonus fires wherever the unit ends up
  // stationary 3+ ticks (canonically the strategy target).
  anchorPosition: { hitPp: 25, hsPp: 20 },
  // Reckless Push: ignores retreat, +1 speed, +15 HR when moving.
  // Pass C2: card-owning attacker plants `plantTicksReduction` ticks faster
  // (PLANT_TICKS - reduction, min 1) — adds a plant-mechanic-specific hook.
  recklessPush: { speedBonus: 1.0, movingHitPp: 15, plantTicksReduction: 1 },
  // Slow Flank: A* weight for non-perimeter hexes (added to base step cost).
  // Pass C2: also makes the unit invisible to the OPPOSING team's AI vision
  // (enemiesVisibleTo filter) until they fire OR get within `proximityHexes`
  // hexes of any opposing alive unit. Real Lurker identity.
  slowFlank: { perimeterPenalty: 0.5, proximityHexes: 3 },
  // Opening Pick overrides Entry's stock first-3-tick bonus and skips post.
  openingPick: { hitPp: 30, hsPp: 15, windowTicks: 3 },
  // Crossfire: when an ally fires, push a 5-tick +25 HR buff (cap 1 extra).
  crossfire: { hitPp: 25, durationTicks: 5, extraStack: 1 },
  // Pass 9 m4 — Trade Window: when any teammate of the contributor dies, the
  // killer is auto-marked for markTicks; surviving allies get a 4-tick HR buff
  // vs the marked killer.
  tradeWindow: { markTicks: 4, allyHitPp: 20, allyBuffTicks: 4 },
  // Spearhead: Vanguard +15 HR first engagement; allies delayed N ticks.
  spearhead: { firstEngagementHitPp: 15, allyDelayTicks: 2 },
  // Setup Play: Pass C2 — drops the flank-angle gate. Tactician moves to the
  // chosen hex; the named ally gets +20 HR for the round when within
  // `allyRangeHexes` of the anchor. Simpler and fires reliably.
  setupPlay: { allyHitPp: 20, allyRangeHexes: 5, windowTicks: 30 },
  // Hold the Line: Warden stationary +20 HR; ally at anchor takes 0 dmg N ticks.
  // Pass C2: when the anchor hex is on the planted site's plant hexes, the
  // safe-window extends to ANY ally on the planted site's plant zone — so
  // the Warden anchoring near a planted spike protects defusers too.
  holdTheLine: { stationaryHitPp: 20, safeWindowTicks: 3 },
  // Adapt: Pass C2 — invokes a role card's handler on the Specialist AND
  // additionally grants a flat +10 HR buff for the full round (60 ticks).
  adapt: { allRoundHitPp: 10, durationTicks: 60 },
  // Guardian Aura: +1 maxHp within N hexes of source.
  guardianAura: { radius: 5, maxHpBonus: 1 },
  // Tactical Scan: reveal all enemies for N ticks at round start.
  // Pass C2 tone-down: 5 → 3 ticks.
  tacticalScan: { ticks: 3 },
  // Mark Target: all allied attacks vs the marked enemy +20 HR / +10 HS.
  // Pass 9 m3 — first-spotted trigger model; reveal lasts `revealTicks` even
  // past LoS once the mark is set.
  markTarget: { hitPp: 20, hsPp: 10, revealTicks: 5 },
} as const;

// AI plays a card this fraction of rounds (spec §15.6).
export const AI_CARD_PLAY_CHANCE = 0.7;

// Card themes per strategy — AI weighting prefers these for the chosen strategy.
// Card ids match cardData.ts. Cards not in a theme are still eligible at lower
// weight (fallback uniform when none of the themed ids are in hand).
export const STRATEGY_CARD_THEMES: Record<string, readonly string[]> = {
  Execute:  ['spearhead', 'setup_play', 'mark_target'],
  Rush:     ['spearhead', 'opening_pick', 'reckless_push'],
  Control:  ['setup_play', 'tactical_scan', 'mark_target'],
  Hold:     ['anchor_position', 'hold_the_line', 'crossfire'],
  Stack:    ['crossfire', 'setup_play', 'spearhead'],
  Pressure: ['spearhead', 'opening_pick', 'trade_window'],
};

export const VISION_COLORS = {
  fog: 'rgba(0, 0, 0, 0.55)',
  coneEdgeDefender: 'rgba(59, 130, 246, 0.7)',
  coneEdgeAttacker: 'rgba(239, 68, 68, 0.7)',
  coneHex: 'rgba(250, 204, 21, 0.07)',
  visibleHex: 'rgba(250, 204, 21, 0.18)',
  traceLine: 'rgba(34, 197, 94, 0.85)',
  ghostDefender: 'rgba(59, 130, 246, 0.35)',
  ghostAttacker: 'rgba(239, 68, 68, 0.35)',
} as const;

// --- Pass D: card-effect visuals (drawCardEffects.ts) --------------------
// Per-card colors + pulse cadence; all tunable here so render code carries no
// magic numbers. Pulse periods are in TICKS (deterministic from state.tick),
// not wall-clock — preserves seed → render equivalence.
export const CARD_VISUAL = {
  // Guardian Aura ring (dashed, team-colored, faint).
  guardianAura: {
    dash: [6, 4] as readonly number[],
    lineWidth: 1.5,
    alpha: 0.30,
    badgeAlpha: 0.70,            // "+1 HP" badge over auraed allies
  },
  // Mark Target / Trade Window crosshair (pulses via state.tick).
  markTarget: {
    color: 'rgba(250, 204, 21, 0.9)',  // amber — neutral vs both team colors
    pulseTicks: 4,                     // full pulse cycle in ticks
    radiusFactor: 0.95,                // × HEX.size at peak
    lineWidth: 2.0,
  },
  // Hold the Line anchor flag (small inverted triangle at the anchor hex).
  holdTheLine: {
    color: 'rgba(96, 165, 250, 0.85)', // defender-team-leaning blue
    safeWindowPulseColor: 'rgba(34, 197, 94, 0.55)',
    lineWidth: 2.0,
  },
  // Setup Play pivot + faint 5-hex range ring around the anchor.
  setupPlay: {
    pivotColor: 'rgba(168, 85, 247, 0.85)',  // purple (distinct from team colors)
    ringColor: 'rgba(168, 85, 247, 0.20)',
    ringDash: [4, 6] as readonly number[],
    ringLineWidth: 1.5,
  },
  // Spearhead Vanguard arrow above the unit square (fades after 3 engaged ticks).
  spearhead: {
    color: 'rgba(248, 113, 113, 0.95)', // attacker-leaning red
    fadeAfterEngagementTicks: 3,
  },
  // Tactical Scan tint on enemy hexes (faint yellow overlay).
  tacticalScan: {
    color: 'rgba(250, 204, 21, 0.18)',
  },
  // Anchor Position glyph on the Sentinel hex (small anchor symbol).
  anchorPosition: {
    color: 'rgba(125, 211, 252, 0.85)',
    lineWidth: 1.5,
  },
  // Reckless Push speed-trail outline (3 fading segments behind the unit).
  recklessPush: {
    color: 'rgba(248, 113, 113, 0.45)',
    lineWidth: 1.5,
  },
  // Slow Flank dotted outline on the Lurker (player team only — enemies
  // never see them per the invisibility rule).
  slowFlank: {
    color: 'rgba(167, 139, 250, 0.65)',
    dash: [2, 3] as readonly number[],
    lineWidth: 1.5,
  },
} as const;

// Region-label overlay (toggleable with R key). Drawn faded so it doesn't
// fight the grid; rendered above the grid but below routes/units.
export const REGION_LABEL = {
  font: '11px ui-sans-serif, system-ui, sans-serif',
  color: 'rgba(255, 255, 255, 0.55)',
  outlineColor: 'rgba(0, 0, 0, 0.85)',
  outlineWidth: 3,
  // Region names not worth showing on the overlay (spawn boxes already obvious
  // from unit color; small plant boxes covered by site label).
  skip: ['def_spawn', 'atk_spawn'] as readonly string[],
} as const;

// 'r' / 'R' toggles the region-name overlay (Pass D).
export const REGION_LABEL_KEY = 'r';
