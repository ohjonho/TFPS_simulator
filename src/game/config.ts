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
export const HIT_TABLE: Record<string, Record<RangeBand, number>> = {
  shotgun: { short: 90, medium: 30, long: 5 },
  rifle: { short: 70, medium: 75, long: 55 },
  sniperStationary: { short: 30, medium: 60, long: 90 },
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
export const MODIFIERS = {
  aggression: { hrScale: 0.2, earlyTicks: 3 },
  weaponHandlingHrScale: 0.1,
  offPositionHitPp: -10,
  clutchDefault: { hitPp: 10, hsPp: 5 },
} as const;

// Weapon-handling random range at match start (0–100 scale).
export const WEAPON_HANDLING_RANGE = { min: 30, max: 70 } as const;

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
