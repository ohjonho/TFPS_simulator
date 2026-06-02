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
  defenders: ['rifle', 'rifle', 'rifle', 'rifle', 'sniper'],
  attackers: ['rifle', 'rifle', 'rifle', 'rifle', 'sniper'],
} as const;

export const UNIT_DEFAULTS = {
  // Rebalance: 3→4. Longer TTK (one extra rifle body-hit; snipers still
  // one-shot on headshot / two-shot body) opens trade windows and mid-fight
  // repositioning, so coordination/positioning carry real weight instead of
  // pure aim deciding the duel. Measured on Foundry II: Leadership gap
  // +15→+25, Improvisation un-inerted, Discipline de-trapped, defenses evened.
  maxHp: 4,
} as const;

// Team size (config knob). createTeam builds this many units per team from the
// LOADOUTS list + the map's spawn cells. INVARIANT: LOADOUTS[team].length,
// DRAFT.picksPerTeam, and every map's spawns per side must all equal this.
// Flip here (with matching LOADOUTS / spawns) to A/B 3v3 vs 5v5.
export const TEAM_SIZE = 5;

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

// Hex-units of movement per tick, per weapon. F2 — sniper bumped to 1.0
// (was 0.5). Sniper risk now comes from the "must stop and settle" rule in
// combat.ts: the sniper uses the stationaryHit table only after
// SNIPER_SETTLED_TICKS ticks of stillness — within that window it's on the
// (much lower) moving table. Net: snipers can move at full speed but lose
// most of their lethality for two ticks after every step. Encourages real
// AWP-style play (rotate fast, peek slow).
export const SPEED: Record<Weapon, number> = {
  shotgun: 1.0,
  rifle: 1.0,
  sniper: 1.0,
};

// F2 — ticks of stillness required for a sniper to qualify for the
// stationary hit table. 2 = "moved within the last 2 ticks → moving table"
// per the playtester-requested change. Lower (e.g. 1) makes snipers feel
// like rifles; higher (3+) makes them very slow to set up.
export const SNIPER_SETTLED_TICKS = 2;

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

// --- Threat model (AI competence foundation) ------------------------------
// Tunables for src/game/threat.ts. The model is two layers: a STATIC per-map
// exposure field (how visible each hex is to the enemy side's territory — a
// sniper-lane proxy) and a DYNAMIC suspected-enemy contribution (visible
// enemies + team-shared ghosts + per-unit tracking projected as LoS danger).
// All deterministic; no RNG. Consumed by the engage gate + approach-IQ
// movement (later concerns) so units respect angles they can't yet see down.
export const THREAT = {
  // A vantage hex farther than this (hexes) doesn't meaningfully threaten a
  // queried hex — caps the static precompute cost and matches "you're not
  // shot from across an unreachable distance."
  maxRange: 22,
  // Weight of the static exposure field (normalized 0..1) in threatAt.
  staticWeight: 1,
  // Per suspected-enemy hex with LoS to the queried hex: this much threat,
  // divided by (1 + dist × distanceFalloff). A known/last-seen enemy with a
  // clean angle dominates the static lane danger.
  dynamicLosWeight: 2,
  distanceFalloff: 0.08,
} as const;

// --- Threat-aware in-region positioning (AI competence — Pillar B) ---------
// When a unit settles into 'holding', instead of the legacy ≤2-hex spawn-bearing
// cover shuffle (findCoverHoldHex) it scores nearby candidate hexes by the
// threat field (threat.ts) — picking the safest hex that still keeps line of
// sight to the angle it should watch and stays near its assigned spot. This is
// the lever that turns a coarse region label into a good actual position, so
// fine positioning emerges without hand-labeling every hex.
//
// `enabled` is an A/B flag: the inert-AI law demands we PROVE a positioning
// change moves outcomes, so the harness probes ON vs OFF. Pure + deterministic
// (threatAt has no RNG; candidate iteration is fixed-order).
export const POSITIONING = {
  enabled: true,
  // Candidate search radius (hexes) from the unit's hold spot, by Map IQ band
  // (ATTRIBUTES.formulas.mapIQ thresholds). Low IQ holds tight; high IQ scans
  // wider for a better angle — keeps Map IQ meaningful.
  radiusLowIQ: 1,
  radiusMidIQ: 2,
  radiusHighIQ: 3,
  // Score weights. safety pulls toward low-threat hexes (the dominant term);
  // los rewards keeping a clean sightline to the watch angle (load-bearing —
  // without it the safest hex is hiding facing a wall); cover rewards
  // sightline-blocking geometry on the threat side; dist gently penalizes
  // straying from the assigned spot so units don't wander out of position.
  wSafety: 1.0,
  wLos: 0.6,
  wCover: 0.25,
  wDist: 0.15,
} as const;

// --- Spawn placement -------------------------------------------------------
// Two layers (see units.placeSpawns + match.applyStrategies):
//
// (1) SPAWN_SPREAD — fan the N units across the zone's back edge (one per ~column
//     band) so a wide painted zone is used instead of only the first-N row-major
//     corner. Pure + deterministic; A/B-flagged.
//     DEFAULT OFF. The A/B harness showed fanning is a pure cost on the open
//     map: both back-edge (−13pp def) and front-edge (−10pp) spreads tank
//     Foundryv2 — spreading breaks the coordinated group-push it's balanced
//     around — while helping nothing elsewhere (originals with 5-cell spawns are
//     unaffected). These maps are balanced around the legacy placement; kept
//     behind the flag for authored maps that specifically want a fanned start.
//
// (2) Per-map strategy-aware optimization lives on the MAP, not here:
//     `MapDefinition.optimizeSpawns`. When true, applyStrategies relocates each
//     DEFENDER onto the spawn-zone cell nearest its resolved target (closing its
//     approach). Also a balance lever — helps defenders on dense maps
//     (Canyon +~9pp) but hurts open-sightline maps, so it's opt-in per map
//     (Canyon only for now) rather than global.
export const SPAWN_SPREAD = {
  enabled: false,
} as const;

// --- Team-trade coordination (Phase 3 — Leadership / comms) -----------------
// Makes the comms (Leadership) attribute mechanically real. When a teammate has
// fired recently (ctx.allyFiredRecently — an engagement to trade into), a unit's
// hit chance shifts by its comms relative to neutral (50): high-Leadership
// rosters convert trades, low ones fumble them. Stacks with the Trader trait's
// flat bonus. `enabled` A/B-flags the whole mechanism. MEASUREMENT-GATED — kept
// only if comms-high vs comms-low rosters show a non-inert win-rate gap at 5v5
// (team coordination was inert at 3v3; more bodies may revive it).
export const COMMS = {
  enabled: true,
  tradeScalePerPt: 0.3, // HR pp per comms point off 50 (±12 at comms 90 / 10)
} as const;

// --- Engagement gate (AI competence #2) -----------------------------------
// Whether a unit commits to a duel it can see, based on estimated odds
// (expected-damage-per-tick share vs the target, from combat.estimateEdpt).
// Probabilistic so personality shows: P(fight) = logistic((odds - threshold) /
// softness). `threshold` is lowered by aggression + risk traits (take worse
// fights) and raised by patient/anchor traits (wait for the good fight). The
// accept roll uses a dedicated seeded RNG stream in tick.ts (determinism safe).
export const ENGAGE = {
  baseThreshold: 0.50,          // a 50/50 fight is a coin flip at neutral discipline
  softness: 0.15,               // logistic band width; smaller = sharper cutoff
  aggressionWeight: 0.003,      // threshold -= (aggression-50) × this (Vanguard 70 → −0.06)
  // Per-trait threshold deltas (negative = takes worse fights). Summed across
  // the unit's skill/behavioral/personality slots. Calibrated so an Ego unit
  // (~0.33 threshold) takes a 40/60 fight ≈62% of the time; a plain Warden
  // (~0.55) ≈28%; Patient/Lurker ≈15%; neutral 50/50 → 50%.
  traitThreshold: {
    Ego: -0.16, 'Hot Head': -0.16, 'Run-n-Gun': -0.10, Entry: -0.08, Clutch: -0.08,
    Patient: 0.12, Lurker: 0.10, Composed: 0.08, Sentinel: 0.08,
  } as Record<string, number>,
  minThreshold: 0.20,
  maxThreshold: 0.75,
  minAccept: 0.02,
  maxAccept: 0.98,
  // An enemy this close (hexes) is engaged regardless of odds — you're already
  // in the fight; freezing point-blank would be absurd.
  forceEngageRange: 2,
  // On a *decline*, if the unit's current-hex threat exceeds this it holds and
  // tucks to cover (don't feed the angle) instead of continuing to advance.
  // Below it, declining just means "don't stop to fight" and movement proceeds.
  holdThreatCutoff: 0.45,
} as const;

// --- Situational read (AI competence #3) ----------------------------------
// A per-tick aggression delta from the round situation, fed through
// modifiers.aggression (→ the #2 engage threshold + the push behavior). Press a
// man-advantage; attackers escalate as the round timer runs down (defenders win
// on timeout); post-plant inverts (attackers hold the plant, defenders must
// retake before detonation). Deterministic, no RNG. Clamped by deltaCap.
export const SITUATION = {
  manAdvantageWeight: 8,            // aggression pts per net alive-unit advantage
  attackerUrgencyStartFrac: 0.45,  // fraction of ROUND_TICK_LIMIT after which attackers escalate
  attackerUrgencyMax: 25,          // max aggression pts added at the timer (pre-plant)
  defenderPatience: -5,            // defenders slightly more passive pre-plant (timeout favors them)
  postPlantAttacker: -12,          // attackers hold the plant, stop over-peeking
  postPlantDefenderBase: 12,       // defenders must retake the site
  postPlantDefenderUrgencyMax: 18, // extra retake urgency as detonation nears
  deltaCap: 35,                    // clamp the total situational swing
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
// (Combat-condition values — Pass 6 originals. Pass H2 added the TRAITS_BY_ID
// metadata registry below for sub-attr bonuses + strategy unlocks.)
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
  // H2 expansion — combat hooks for the new traits with conditional bonuses.
  // Pure-stat traits (Roamer, Hot Head, Paranoid, Old Pro) have no entry here
  // since their entire effect is the sub-attribute bonus in TRAITS_BY_ID.
  // Spray Down keys off engagementTicks (after Entry's 3-tick window closes)
  // — it's the opposite-half of First Shot / Entry's early-engagement bonus.
  sprayDown: { hitPp: 15, afterTicks: 3 },               // post-first-3-engagement-ticks HR retention
  deadeyeLongHitPp: 15,                                  // +HR at the 'long' range band
  closeQuartersShortHitPp: 15,                           // +HR at the 'short' range band
  patient: { hitPp: 15, afterTick: 30 },                 // late-round HR bonus (Patient personality)
} as const;

// Pass H2 — trait metadata registry. Every trait id maps to its category,
// rarity tier, sub-attribute bonus deltas, and a forward-data list of
// strategy ids it unlocks (H3 builds those strategies).
//
// Strategy unlock ids referenced here: Anchor_Hold / Mobile_Push /
// Patient_Flank / Coordinated_Execute / Crossfire_Lockdown /
// Last_Stand_Defense / Mind_Games / Solo_Frag / Hold_Composure /
// Coordinated_Lockdown / Scatter_Push / Rotate_Stack / Aggressive_Peek /
// Wide_Watch / Slow_Burn. Unknown ids are silently skipped by
// availableStrategies(), keeping the system forward-compatible.
//
// 3 trait pools (skill / behavioral / personality), each unit picks one
// trait per pool via rollUnitMeta. Pool sizes after H2 expansion:
// Skill 7 / Behavioral 8 / Personality 8 = 23 trait defs total. With 6
// drafted units × 3 traits = 18 trait picks per match (heavily deduped on
// small rosters).
//
// `tier` — 'starter' / 'earned' / 'event'. v0 sim treats all uniformly;
// v1's progression layer reads this to gate scouting + XP-earned trait
// unlocks (e.g. fresh recruits roll only starters; earned + event come
// from training / in-match triggers).
export const TRAITS_BY_ID: Record<string, {
  category: 'skill' | 'behavioral' | 'personality';
  tier: 'starter' | 'earned' | 'event';
  attrBonuses: Record<string, number>;
  unlocks: readonly string[];
  description: string;
}> = {
  // --- Skill (mechanical) — pure stat, no strategy unlocks ---
  'Sharp Aim':      { category: 'skill', tier: 'starter',
    attrBonuses: { aim: 15 }, unlocks: [],
    description: 'Wide HR bonus across all weapons.' },
  'Headhunter':     { category: 'skill', tier: 'starter',
    attrBonuses: { headshot: 15 }, unlocks: [],
    description: 'Extra HS chance on every hit (rifle-only combat bonus).' },
  'Eagle Eye':      { category: 'skill', tier: 'earned',
    attrBonuses: { vision: 10 }, unlocks: [],
    description: 'Wider vision cone; spots threats earlier.' },
  'First Shot':     { category: 'skill', tier: 'starter',
    attrBonuses: { reflexes: 10 }, unlocks: [],
    description: 'First shot of any engagement gets a big HR bump.' },
  'Spray Down':     { category: 'skill', tier: 'earned',
    attrBonuses: { reflexes: 10 }, unlocks: [],
    description: 'Post-first-3-shots HR bonus; complements First Shot.' },
  'Deadeye':        { category: 'skill', tier: 'earned',
    attrBonuses: { aim: 10 }, unlocks: [],
    description: 'Long-range HR specialist (+HR at long band).' },
  'Close Quarters': { category: 'skill', tier: 'earned',
    attrBonuses: { weaponAffinity: 10 }, unlocks: [],
    description: 'Short-range HR specialist (+HR at short band).' },

  // --- Behavioral — engagement style; each unlocks one strategy variant ---
  'Sentinel':   { category: 'behavioral', tier: 'starter',
    attrBonuses: { tenacity: 10, composure: 5 }, unlocks: ['Anchor_Hold'],
    description: 'Stationary hold; +HR after 3 ticks of stillness.' },
  'Run-n-Gun':  { category: 'behavioral', tier: 'starter',
    attrBonuses: { weaponAffinity: 10, reflexes: 5 }, unlocks: ['Mobile_Push'],
    description: 'No retreat; faster move; HR bonus while moving.' },
  'Lurker':     { category: 'behavioral', tier: 'starter',
    attrBonuses: { mapIQ: 10, composure: 5 }, unlocks: ['Patient_Flank'],
    description: 'Hugs walls + map edges; bonus when wall-adjacent.' },
  'Entry':      { category: 'behavioral', tier: 'starter',
    attrBonuses: { aim: 10, composure: -5 }, unlocks: ['Coordinated_Execute'],
    description: 'First-3-ticks engagement bonus; small penalty after.' },
  'Trader':     { category: 'behavioral', tier: 'starter',
    attrBonuses: { comms: 10, aim: 5 }, unlocks: ['Crossfire_Lockdown'],
    description: 'HR bonus when an ally has fired in the last 3 ticks.' },
  'Clutch':     { category: 'behavioral', tier: 'earned',
    attrBonuses: { composure: 15 }, unlocks: ['Last_Stand_Defense'],
    description: 'Big HR/HS bonus when last alive on the team.' },
  'Roamer':     { category: 'behavioral', tier: 'starter',
    attrBonuses: { reflexes: 10, mapIQ: 10, tenacity: -10 },
    unlocks: ['Rotate_Stack'],
    description: 'Mobile defender; rotates between angles instead of holding.' },
  'Hot Head':   { category: 'behavioral', tier: 'starter',
    attrBonuses: { aim: 15, tenacity: -15 }, unlocks: ['Aggressive_Peek'],
    description: 'Engages on sight; ignores hold orders.' },

  // --- Personality (mental + social) — risky / tricky / veteran flavors ---
  'Big Brain':  { category: 'personality', tier: 'earned',
    attrBonuses: { mapIQ: 10, tenacity: 10, adaptability: 5 }, unlocks: ['Mind_Games'],
    description: 'Sets up fakes / feints; reads enemy rotations.' },
  'Ego':        { category: 'personality', tier: 'event',
    attrBonuses: { aim: 15, tenacity: -15 }, unlocks: ['Solo_Frag'],
    description: 'High Aim, low compliance — freelances even off-plan.' },
  'Composed':   { category: 'personality', tier: 'starter',
    attrBonuses: { composure: 15 }, unlocks: ['Hold_Composure'],
    description: 'Performance under fire stays consistent.' },
  'Leader':     { category: 'personality', tier: 'earned',
    attrBonuses: { comms: 20, tenacity: 5 }, unlocks: ['Coordinated_Lockdown'],
    description: 'Buffs ally aura radius + magnitude (wires fully in H3).' },
  'Lone Wolf':  { category: 'personality', tier: 'event',
    attrBonuses: { aim: 10, comms: -10 }, unlocks: ['Scatter_Push'],
    description: 'Solo plays; weak ally synergy but high individual ceiling.' },
  'Paranoid':   { category: 'personality', tier: 'starter',
    attrBonuses: { vision: 10, reflexes: 5, tenacity: -10 }, unlocks: ['Wide_Watch'],
    description: 'Over-rotates, sees ghosts; wide cone coverage, low patience.' },
  'Patient':    { category: 'personality', tier: 'earned',
    attrBonuses: { composure: 10, mapIQ: 5 }, unlocks: ['Slow_Burn'],
    description: 'Rewards long rounds; +HR after tick 30.' },
  'Old Pro':    { category: 'personality', tier: 'event',
    attrBonuses: { aim: 5, composure: 5, mapIQ: 5, tenacity: 5 }, unlocks: [],
    description: 'Veteran feel; small bonus to multiple sub-attributes.' },
} as const;

// Pass H2 — trait pools by category. rollUnitMeta picks one from each pool
// per unit. v0 sim picks uniformly across tiers; v1 progression can filter
// to starters-only for fresh scouts and surface earned/event via XP.
export const SKILL_TRAIT_IDS = [
  'Sharp Aim', 'Headhunter', 'Eagle Eye', 'First Shot',
  'Spray Down', 'Deadeye', 'Close Quarters',
] as const;
export const BEHAVIORAL_TRAIT_IDS = [
  'Sentinel', 'Run-n-Gun', 'Lurker', 'Entry', 'Trader', 'Clutch',
  'Roamer', 'Hot Head',
] as const;
export const PERSONALITY_TRAIT_IDS = [
  'Big Brain', 'Ego', 'Composed', 'Leader', 'Lone Wolf',
  'Paranoid', 'Patient', 'Old Pro',
] as const;

// Per-role base aggression rating (0–100), spec §13.1.
export const ROLE_AGGRESSION = {
  Vanguard: 70,
  Tactician: 50,
  Warden: 35,
  Specialist: 55,
} as const;

// H3.fix3 — manager-readable one-liner per role. Surfaced in role chip
// tooltips (sidePanel roster, draftPanel pool cards, unit-info DL). Each
// references the role's aggression for context.
export const ROLE_DESCRIPTIONS = {
  Vanguard: 'Aggression 70 — pushes first, takes the entry duel, leads contact.',
  Tactician: 'Aggression 50 — mid-range setup, supports flanks, plays for trades.',
  Warden: 'Aggression 35 — patient anchor, holds angles from cover, rotates late.',
  Specialist: 'Aggression 55 — flex slot, adapts to the picked strategy.',
} as const;

// H3.fix3 — hero passive-ability descriptions. Heroes became passive
// role-tags in H3.3 (card system collapse); each grants one always-on
// effect with no decision surface.
export const HERO_DESCRIPTIONS = {
  Angelic: 'Guardian Aura — allies within 5 hex get +1 max HP, always on.',
  Techy: 'Tactical Scan — round-start reveal of all enemy positions for a few ticks.',
  Cursed: 'Mark Target — the first enemy this unit spots each round is auto-marked all round (+20 HR / +10 HS for allies vs the mark).',
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

// --- Pass H1: per-unit attributes -----------------------------------------
// 10 hidden sub-attributes feed combat / vision math directly. 5 visible
// aggregates surface in the UI via the weighted-sum `aggregation` table.
// All numbers tunable from this one place.
export const ATTRIBUTES = {
  generation: {
    // 'flat': every attribute = 50 (deterministic, removes attribute RNG as
    //   a confound; the v0 debugging default).
    // 'normal': truncated-normal sample, the design-doc default — used for
    //   variety once the rest of the sim is balanced.
    // 'uniform': uniform in [min, max].
    distribution: 'flat' as 'flat' | 'normal' | 'uniform',
    mean: 50,
    stdDev: 12,
    min: 10,
    max: 90,
  },
  formulas: {
    aim: { multiplier: 0.13 },                                  // pp per (rating-50); contributes to HR. Rebalance: 0.2→0.13 to cut aim dominance (Mechanics gap was +80pp, swamping tactics) so positioning/first-contact carry comparable weight. Aim stays the #1 lever, not 2.3× everything.
    weaponAffinity: { multiplier: 0.06 },                       // pp per (rating-50); H1 — replaces per-weapon handling. Rebalance: 0.1→0.06 (paired with aim cut).
    vision: {                                                   // H1 (was awareness)
      coneMultiplier: 0.4,                                      // deg per (rating-50); cone widens with vision
      coneCap: 20,                                              // ±deg cap
      ghostHighThreshold: 70,                                   // +1 ghost tick above
      ghostLowThreshold: 30,                                    // -1 ghost tick below
    },
    composure: {                                                // H1 — absorbs old `clutch` formula
      withTraitMultiplier: 0.15,                                // stacks on Clutch trait
      withoutTraitMultiplier: 0.15,                             // default last-alive bonus
    },
    headshot: { multiplier: 0.13 },                             // pp per (rating-50); linear HS contribution. Rebalance: 0.2→0.13 (reduces headshot-lethality swing that compounds aim dominance).
    reflexes: { firstShotMultiplier: 0.01 },                    // per (rating-50); scales First Shot trait magnitude
    mapIQ: { highThreshold: 70, lowThreshold: 30 },             // H1 — absorbs old `positioning`; widens cover-seek radius
  },
  // H1 — weighted aggregation of the 10 hidden subs into the 5 visible
  // aggregates the UI displays. Per-visible weights must sum to 1.0 so the
  // aggregate stays on the same 0-100 scale. The aggregation is for DISPLAY
  // ONLY — combat / vision math reads sub-attributes directly so per-shot
  // precision is preserved.
  aggregation: {
    mechanics: {
      aim: 0.30, headshot: 0.20, reflexes: 0.20, weaponAffinity: 0.30,
    },
    gameSense: {
      vision: 0.55, mapIQ: 0.45,
    },
    discipline: {
      tenacity: 1.0,
    },
    improvisation: {
      composure: 0.55, adaptability: 0.45,
    },
    leadership: {
      comms: 1.0,
    },
  },
  performanceStats: {
    acs: {
      killValue: 200,
      assistValue: 50,
      // Ace bonus: fires when a unit kills the ENTIRE enemy team in one round.
      // Team-size-agnostic — the threshold is the enemy team's unit count
      // (TEAM_SIZE), not a hard-coded 3. At 3v3 an ace = 3K; at 5v5 = 5K.
      aceWipeBonus: 400,
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
// H3 — `complianceThreshold` (0-100) gates the per-tick directive
// adherence roll (directives.ts). Higher = more demanding; trait-unlocked
// variants raise this above 50 so low-Discipline rosters pay a penalty for
// picking them ("high ceiling, low floor" design).
export const STRATEGY_MODS: Record<string, {
  aggression: number;
  retreatThreshold: number;
  complianceThreshold?: number;
}> = {
  // Baseline (always available) — neutral compliance.
  Execute:  { aggression:   0, retreatThreshold: 0,  complianceThreshold: 50 },
  Rush:     { aggression: +10, retreatThreshold: -1, complianceThreshold: 50 },
  Control:  { aggression: -10, retreatThreshold: 0,  complianceThreshold: 50 },
  Hold:     { aggression:   0, retreatThreshold: 0,  complianceThreshold: 50 },
  Stack:    { aggression:   0, retreatThreshold: 0,  complianceThreshold: 50 },
  Pressure: { aggression: +10, retreatThreshold: 0,  complianceThreshold: 50 },

  // H3 trait-unlocked DEFENDER variants (9). Each unlocked by ≥1 trait on
  // the roster (see TRAITS_BY_ID.unlocks).
  Anchor_Hold:          { aggression: -15, retreatThreshold: 0,  complianceThreshold: 75 }, // Sentinel
  Crossfire_Lockdown:   { aggression:  -5, retreatThreshold: 0,  complianceThreshold: 70 }, // Trader
  Last_Stand_Defense:   { aggression: -10, retreatThreshold: 0,  complianceThreshold: 65 }, // Clutch
  Mind_Games:           { aggression:   0, retreatThreshold: 0,  complianceThreshold: 60 }, // Big Brain (D+A)
  Hold_Composure:       { aggression:  -5, retreatThreshold: 0,  complianceThreshold: 70 }, // Composed
  Coordinated_Lockdown: { aggression:  -5, retreatThreshold: 0,  complianceThreshold: 75 }, // Leader
  Rotate_Stack:         { aggression:  +5, retreatThreshold: 0,  complianceThreshold: 50 }, // Roamer
  Wide_Watch:           { aggression:  -5, retreatThreshold: 0,  complianceThreshold: 55 }, // Paranoid
  Slow_Burn:            { aggression: -15, retreatThreshold: 0,  complianceThreshold: 80 }, // Patient

  // H3 trait-unlocked ATTACKER variants (6 + Mind_Games shared with D).
  Mobile_Push:          { aggression: +20, retreatThreshold: -1, complianceThreshold: 60 }, // Run-n-Gun
  Patient_Flank:        { aggression:  -5, retreatThreshold: 0,  complianceThreshold: 80 }, // Lurker
  Coordinated_Execute:  { aggression: +10, retreatThreshold: 0,  complianceThreshold: 75 }, // Entry
  Solo_Frag:            { aggression: +15, retreatThreshold: -1, complianceThreshold: 30 }, // Ego
  Scatter_Push:         { aggression:  +5, retreatThreshold: 0,  complianceThreshold: 40 }, // Lone Wolf
  Aggressive_Peek:      { aggression: +20, retreatThreshold: 0,  complianceThreshold: 50 }, // Hot Head
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
// v0.19.0 — the channeling unit (planter or defuser) is now committed: it
// cannot move or shoot while its timer runs (enforced in tick.ts). A
// committed unit that drops to retreat HP holds the channel or bails per
// CHANNEL_COMMIT below.
export const PLANT_TICKS = 2;
// Pass B iteration: 15 → 20 ticks. Gives defenders more rotation time to
// actually reach the planted site and defuse (zero defuses across 450 rounds
// at 15-tick suggested defenders couldn't get there in time).
export const DETONATION_TICKS = 20;
// v0.19.0 — 4 → 3. The no-shoot channel lock makes defusing a genuine
// commitment (a defuser can't trade for itself); the shorter timer partly
// offsets the added exposure.
export const DEFUSE_TICKS = 3;

// v0.19.0 — channel commitment. A unit already planting/defusing that drops
// to retreat HP holds the channel (finishing under fire) instead of bailing
// iff its discipline clears `minComplyPct`. Deterministic — no roll: evaluated
// via compliancePct (Tenacity/Composure) at a neutral strategy threshold under
// enemy-visible pressure, so gritty units clutch the defuse and flaky ones run.
// Raise `minComplyPct` to make commitment rarer (more bailing).
export const CHANNEL_COMMIT = {
  strategyThreshold: 50,
  underFirePressure: -15,
  minComplyPct: 70,
} as const;

// v0.20.0 — post-plant hunt. An aggressive / Ego defender designated as the
// retake defuser clears the last attacker BEFORE committing to the spike,
// instead of dying on a no-shoot defuse (v0.19.0). It defers the defuse only
// while a live attacker is visible (a real target — no ghost-chasing) AND
// enough detonation time remains to still defuse after the kill
// (timeLeft > DEFUSE_TICKS + timeMarginTicks); when the clock tightens or the
// threat clears, it commits to the defuse. `aggroBar` is the effective-
// aggression cutoff; the listed traits always qualify regardless of aggression.
export const POST_PLANT_HUNT = {
  aggroBar: 60,
  timeMarginTicks: 2,
  egoTraits: ['Ego', 'Hot Head'] as readonly string[],
};

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
// "Draft" (Pass G — generate 8-unit pool + player/AI snake-pick 3 each;
// drafted units use the same attribute distribution as old Randomize).
// LOADOUT_POOL + RANDOMIZE_ATTRIBUTES kept under their original names so
// Standard mode + the draft generator both reuse them.
export const LOADOUT_POOL: readonly Weapon[] = ['shotgun', 'rifle', 'sniper'];
export const RANDOMIZE_ATTRIBUTES = { min: 40, max: 60 } as const;

// --- Pass G: draft phase --------------------------------------------------
// Pool of N units shared between player and AI; snake-pick 3 each, 2 leftovers
// discarded. AI picks via greedy-Aim with a rifle-floor rule. Pool composition
// is soft-constrained (≥ minPerWeapon of each weapon) so neither team can be
// forced into a degenerate roster — resample loadouts up to maxComposeRetries
// before accepting whatever the pool ended up with.
export const DRAFT = {
  poolSize: 14,
  picksPerTeam: 5,
  // 'P' = player, 'A' = AI. Resolved to actual team identities by startDraft
  // using the player team. 10-pick snake (5 each): P-A-A-P-P-A-A-P-P-A.
  snakeOrder: ['P', 'A', 'A', 'P', 'P', 'A', 'A', 'P', 'P', 'A'] as readonly ('P' | 'A')[],
  minPerWeapon: 2,
  maxComposeRetries: 32,
} as const;

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
