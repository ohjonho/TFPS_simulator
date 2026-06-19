// All tunable values for the simulator live here. No magic numbers in game logic.
// CLAUDE.md rule: pull every tunable into config so the management layer can
// later override per-unit stats without code changes.

import type { CellType, RangeBand, Role, Side, Weapon } from './types.ts';

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
  // Short-range peripheral sense: a live enemy within this many hexes (with a
  // clear line of sight) is noticed regardless of facing, so units don't walk
  // past each other when their cones happen not to cross. Feeds tracking +
  // engagement, not just fog.
  proximityRadius: 2,
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

// --- Attacker pre-round site appraisal (AI competence) ---------------------
// The AI attacker's A/B-site variant pick was a blind coin flip. At round start
// the belief store is empty (no enemies seen yet), so the only fair signal is
// STATIC map geometry: which site is easier to take/hold, via the attacker-side
// exposure of its plant hexes (threat.siteAttackDifficulty). The pick is a SOFT
// weighted draw toward the easier site — not argmax — so it stays unpredictable
// (a hard-stack defender can't simply pre-counter it). A mid-round re-read is a
// separate concern (read_and_commit, belief-driven, Control only). Cross-round
// scouting (remember last round's setup) is the future legibility layer.
export const ATTACKER_APPRAISAL = {
  // Lean strength: weight_i = max(0.05, 1 − bias·difficulty_i), difficulty 0..1.
  // 0 = coin flip; 1 = strongly favor the easier site. 0.6 ≈ ~70/30 at full
  // exposure asymmetry — a real lean that still picks the hard site sometimes.
  bias: 0.6,
} as const;
// A/B flag (mirrors HERO_ABILITIES_ENABLED): the harness flips it to probe ON vs
// OFF. Default false until a measured ON proves it doesn't over-favor attackers.
export let ATTACKER_SITE_APPRAISAL_ENABLED = false;
export function setAttackerSiteAppraisalEnabled(enabled: boolean): void {
  ATTACKER_SITE_APPRAISAL_ENABLED = enabled;
}

// --- Cross-round scouting (AI read/adapt — Workstream B slice) --------------
// The defender gets a deterministic per-roster site LEAN (a scoutable "tell");
// the attacker accumulates a decayed cross-round read of the enemy's defensive
// site and biases its variant pick toward the soft (under-defended) site. Soft
// on both ends so a correct read TILTS (~55-65%), never predetermines. Only
// manifests across rounds (runMatch) — so it can't touch the per-round floor/
// matrices (those force picks). A/B-flagged; determinism-safe (seeded, fixed order).
export const SCOUTING = {
  // Roster-hash defender lean toward variant 0, clamped to [lo, hi].
  defenderLeanLo: 0.32,
  defenderLeanHi: 0.68,
  // Per-round memory: prior scouting counts decay by this before the new round's
  // site is added (recent rounds weigh more; ~0.6 ≈ a 2–3 round horizon).
  decay: 0.6,
  // How hard the attacker favors the under-defended site (0 = ignore the read,
  // 1 = strong). Soft so the tilt stays bounded.
  attackerExploitBias: 0.6,
} as const;
export let SCOUTING_ENABLED = false;
export function setScoutingEnabled(enabled: boolean): void {
  SCOUTING_ENABLED = enabled;
}
// Test seam: force the defender's variant-0 lean (all teams) for a clean A/B;
// null = use the roster-hash lean.
export let SCOUTING_DEFENDER_LEAN_OVERRIDE: number | null = null;
export function setScoutingDefenderLeanOverride(p: number | null): void {
  SCOUTING_DEFENDER_LEAN_OVERRIDE = p;
}

// --- Strategy-pick history (for the pre-round Scout / legibility) -----------
// Each team's picks accumulate a decayed lean per strategy id (state.strategyLean,
// recorded in match.applyStrategies). The pre-round Scout surfaces the ENEMY's
// lean ("they've leaned Stack this match") so the player's pick becomes a read,
// not a gamble. Read-only data — nothing in the sim acts on it (determinism-safe).
// NOTE: an AI counter-pick consumer of this was tried and removed — the
// defender's existing win-momentum (pickAiStrategy `1 + wins`) already self-adapts
// to a repeated opponent, so an explicit read was redundant + inert (see memory
// matrix-forced-vs-realistic).
export const STRATEGY_LEAN = {
  // Prior picks decay by this before the new round's pick (+1) is added
  // (recent rounds weigh more; ~0.6 ≈ a 2–3 round horizon).
  decay: 0.6,
} as const;

// --- Campaign opponent identity (scoutable lean) ----------------------------
// Each season opponent has a fixed, pre-scoutable tendency: a strategy lean per
// side + a preferred site. The AI picks the leaned strategy `pickChance` of the
// time (else a normal weighted pick among the rest, so the rate is exact); when
// it DOES run the leaned strategy, `siteWeight` biases its A/B variant toward
// the preferred site so "they lean Rush A" reads reliably instead of leaving a
// 50/50 site guess. Strong by design (the player should feel the read pay off);
// the soft-counter margins keep it from being oppressive. Only set on the live
// season match (GameState.opponentLean) → the harness/standard path is untouched.
export const OPPONENT_LEAN = {
  pickChance: 0.67,  // ~67% the leaned strategy (the rest weighted among others)
  siteWeight: 6,     // leaned-site variant weight vs 1 → ~86% the preferred site
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

// --- Threat-matrix target selection (AI competence — Pillar B, Phase 1) -----
// Lifts MACRO target selection from raw region/site centroids to the threat
// matrix: a converging defender picks the best CELL in its target region
// (safest, with LoS to the watch angle + cover) instead of the geometric
// centroid. Distinct from POSITIONING, which only refines the final tuck within
// a few hexes of where the unit already stands — this chooses WHICH cell to head
// to. A/B flag: the inert-AI law demands we PROVE a target change moves outcomes,
// so the harness probes ON vs OFF. Pure + deterministic (no RNG; fixed iteration).
export const THREAT_TARGETING = {
  // Score weights for bestHoldCellInRegion (same shape as POSITIONING): safety
  // pulls toward low-threat cells (dominant); los keeps a sightline to the watch
  // angle; cover rewards sightline-blocking geometry; dist gently prefers cells
  // near the region centroid so the pick stays "in position".
  wSafety: 1.0,
  wLos: 0.6,
  wCover: 0.25,
  wDist: 0.1,
} as const;
// --- Persistent belief store (AI read/adapt substrate, Phase 2) -------------
// Tunables for src/game/belief.ts — the per-team "where are the unseen enemies"
// grid that fixes perception starvation (teams previously knew ≤2/5 enemies and
// forgot in ~3 ticks). Three properties make reads/fakes well-defined:
// decay-not-deletion, negative evidence (watched-empty cells zero out), and a
// redistribution prior (alive enemies always sum to full mass somewhere).
export const BELIEF = {
  // Per-tick blend of the prior toward uniform: 0 = beliefs never fade,
  // 1 = no memory at all. ~0.08 ≈ a stale sighting halves in ~8 ticks.
  decayLambda: 0.08,
  // Floor added to every unobserved cell's redistribution factor so fully
  // decayed maps still spread mass (and the normalizer can't hit 0).
  epsilon: 0.0001,
  // read_and_commit: commit to the lighter site only when the belief-mass gap
  // between sites exceeds this (in expected enemies). Below it → no confident
  // read → the directive stays silent. 0.75 ≈ "about one defender heavier",
  // safely above the site-size asymmetry of a uniform spread (~0.05).
  readMargin: 0.75,
} as const;

// Per-map enablement lives on MapDefinition.threatTargeting (the optimizeSpawns
// precedent — trace-verified geometry-dependent lever: on a LARGE map, spreading
// collapsers across covered site cells beats the centroid pile; on TIGHT maps the
// centroid IS the contesting spot and the safety-weighted cell cedes the breach).
// This mutable override (mirrors HERO_ABILITIES_ENABLED) lets the harness force
// ON/OFF regardless of map for A/B boards; null = use the map's own field.
export let THREAT_TARGETING_OVERRIDE: boolean | null = null;
export function setThreatTargetingOverride(v: boolean | null): void {
  THREAT_TARGETING_OVERRIDE = v;
}

// --- Threat-aware INITIAL hold positioning (Part 5 A1) ----------------------
// A separate, finer seam from THREAT_TARGETING (which gates the *dynamic*
// collapse/rotate near-edge convergence). HOLD targeting lifts the DEFENDER's
// round-start hold target from the raw region centroid to the best static cell
// of its slot region (low exposure + LoS to its watch angle + cover), scored at
// round start (no live enemies yet → static exposure only). This is the direct
// "units hold bad angles" fix: a coarse region label resolves to a genuinely
// good actual position. Distinct from the collapse flag because tight maps
// (Canyon) WANT near-edge collapse/rotate (they meet the breach) yet still
// benefit from a better *starting* angle. Per-map via MapDefinition.holdTargeting;
// this override mirrors THREAT_TARGETING_OVERRIDE for harness A/B (null = map).
// Reuses the THREAT_TARGETING score weights (same bestHoldCellInRegion scorer).
export let HOLD_TARGETING_OVERRIDE: boolean | null = null;
export function setHoldTargetingOverride(v: boolean | null): void {
  HOLD_TARGETING_OVERRIDE = v;
}

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
  // v0.25.0 — partial skill-decoupling of the engage odds. The "should I take
  // this duel?" odds (estimateEdpt) blend between FULL personal power (1.0) and a
  // power-stripped NEUTRAL read (0.0 — attributes 50, no trait HR/HS, no card
  // flags/buffs/modifier HR; weapon/range/cover/fire-rate/mark kept). This
  // decouples combat POWER from the commit DECISION so skill/aim traits WIN the
  // fights you take (resolveShot is untouched) instead of perversely making you
  // TAKE more — taming the map-chaotic skill-trait win% swings. Behavior intent
  // stays in `threshold` below (aggression + traitThreshold). Measured: full
  // neutral (0.0) over-corrects (blinds the AI to real skill gaps → strong units
  // no longer respected, balanced Foundry slips); a partial weight keeps skilled
  // units partly confident + partly feared while still cutting the swing.
  skillOddsWeight: 0.5,
  baseThreshold: 0.50,          // a 50/50 fight is a coin flip at neutral discipline
  softness: 0.15,               // logistic band width; smaller = sharper cutoff
  aggressionWeight: 0.003,      // threshold -= (aggression-50) × this (Vanguard 70 → −0.06)
  // Per-trait engage-threshold deltas (negative = takes worse fights). Summed
  // across the unit's tactical traits. v0.29.0 — two tactical traits own this
  // lever: Aggressor (peeks/commits) and Anchor (waits for the good fight).
  // Magnitudes provisional (retune with the full stack); the structural finding
  // is that this is the cleanest behavior lever (see [[lever-board]]).
  traitThreshold: {
    Aggressor: -0.10, // kept (reducing it backfired — less aggression → attackers execute the plant instead of brawling, MORE attacker-favored; the reactive-ai-inert law). Aggressor's attacker lean is its identity; combat cut (movingHitPp 15→8) does the bounding.
    Anchor: 0.10,
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

// v0.26.0 — per-trait directive-compliance delta (pp added to compliancePct in
// directives.ts, summed across the unit's three trait slots). This is the
// "freelance" channel, distinct from the engage threshold: a negative delta
// makes a unit more likely to BREAK its strategy directives and fall through to
// the legacy behavior tree (leave its hold, peek off-plan), independent of
// whether it takes a given duel. Ego (the high-ceiling freelancer) lives here
// instead of in ENGAGE.traitThreshold — that's what differentiates it from Hot
// Head (the on-sight peeker, who stays in traitThreshold). Coherent with Ego's
// Solo_Frag unlock (complianceThreshold 30 = "accepts freelancing").
export const COMPLIANCE_TRAIT_DELTA: Record<string, number> = {
  Freelancer: -25,  // plays off-plan — breaks directives ~half the time
  Disciplined: 20,  // executes the plan reliably
};

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
// v0.29.0 — combat-condition constants for the 8 tactical traits (evaluated in
// combat.ts against the per-shot context). Only traits with a per-shot combat
// hook appear here; Aggressor/Freelancer/Disciplined's levers are the engage
// threshold + compliance (ENGAGE.traitThreshold / COMPLIANCE_TRAIT_DELTA) and
// attribute bonuses, not a combat-condition hook.
export const TRAITS = {
  marksmanHitPp: 5,                                      // Marksman — flat HR across weapons (stacks with its aim+15). Pass 6: 10→5 (sym −15.6 → bound).
  aggressorMovingHitPp: 8,                               // Aggressor — +HR while moving (absorbs Run-n-Gun). Pass 6: 15→8.
  anchor: { hitPp: 25, hsPp: 20, stationaryTicks: 3 },   // Anchor — +HR/HS after 3 ticks stationary (in-bound, kept)
  flanker: { hitPp: 8, hsPp: 4 },                        // Flanker — +HR/HS when wall-adjacent. Pass 6: 20/10→8/4 (sym −22.2 → bound).
  trader: { hitPp: 15, windowTicks: 3 },                 // Trader — +HR when an ally fired recently
  clutch: { hitPp: 20, hsPp: 15 },                       // Clutch — +HR/HS when last alive
} as const;

// v0.29.0 — TACTICAL trait registry (8). Each unit draws TWO distinct. `tier`
// gates v1 progression (Marksman is the prized 'earned' find). attrBonuses are
// applied on top of the rolled attributes in rollUnitMeta.
export const TACTICAL_TRAITS: Record<string, {
  tier: 'starter' | 'earned' | 'event';
  attrBonuses: Record<string, number>;
  description: string;
}> = {
  Aggressor:   { tier: 'starter', attrBonuses: { aim: 5, tenacity: -5 },
    description: 'Pushes and peeks — lower bar to take a duel, never retreats, hunts before defusing. Strong on attack; over-extends on defense.' },
  Anchor:      { tier: 'starter', attrBonuses: { tenacity: 10 },
    description: 'Holds an angle — patient (waits for the good fight), +HR/HS after settling, never retreats.' },
  Freelancer:  { tier: 'event',   attrBonuses: { aim: 10, comms: -10 },
    description: 'High ceiling, uncoachable — frequently breaks the team plan to play its own game.' },
  Disciplined: { tier: 'starter', attrBonuses: { tenacity: 5, composure: 5 },
    description: 'Executes the plan reliably — sticks to its assigned role under pressure.' },
  Flanker:     { tier: 'starter', attrBonuses: { mapIQ: 10 },
    description: 'Takes the long way — perimeter routing, unseen until it fires, +HR hugging walls.' },
  Trader:      { tier: 'earned',  attrBonuses: { comms: 10, aim: 5 },
    description: 'Punishes trades — +HR right after a teammate fires (scales with Leadership).' },
  Marksman:    { tier: 'earned',  attrBonuses: { aim: 15 },
    description: 'Pure mechanical edge — high Aim + a flat hit-rate bonus on every shot. A prized find.' },
  Clutch:      { tier: 'earned',  attrBonuses: { composure: 10 },
    description: 'Rises when alone — big HR/HS surge as the last one standing (scales with Composure).' },
};
export const TACTICAL_TRAIT_IDS = [
  'Aggressor', 'Anchor', 'Freelancer', 'Disciplined',
  'Flanker', 'Trader', 'Marksman', 'Clutch',
] as const;

// v0.29.0 — PERSONALITY registry (4-quadrant: Extroversion × Task/People). Each
// unit draws ONE. In-match effect is only the minor attrBonuses below. `axes`
// (−1..+1) is stored for the FUTURE management layer's chemistry matrix.
// MANAGEMENT STUB (not built — needs the v1 persistence layer): pre/post-match
// interactions between teammates' personalities would adjust attributes for the
// match (positive → both up, risky → one up/one down, negative → both down) and
// could grant strategy/trait unlocks, sponsor cash, EXP, or quests. See
// docs/spec.md §15 + [[v1-direction]].
export const PERSONALITIES: Record<string, {
  axes: { extroversion: number; people: number };
  attrBonuses: Record<string, number>;
  description: string;
}> = {
  Firebrand:  { axes: { extroversion: 1,  people: -1 }, attrBonuses: { aim: 5, tenacity: -5 },
    description: 'Extrovert · task-driven — vocal competitor who plays for the highlight.' },
  Catalyst:   { axes: { extroversion: 1,  people: 1 },  attrBonuses: { comms: 10 },
    description: 'Extrovert · people-first — rallies the team and keeps everyone talking.' },
  Analyst:    { axes: { extroversion: -1, people: -1 }, attrBonuses: { mapIQ: 5, composure: 5 },
    description: 'Introvert · task-driven — quiet and methodical; studies the game.' },
  Stabilizer: { axes: { extroversion: -1, people: 1 },  attrBonuses: { composure: 5, tenacity: 5 },
    description: 'Introvert · people-first — loyal, low-ego glue that steadies the room.' },
};
export const PERSONALITY_IDS = ['Firebrand', 'Catalyst', 'Analyst', 'Stabilizer'] as const;

// v0.29.0 / Pass 2c — CHEMISTRY engine tunables. The pairwise personality
// interaction model (src/game/chemistry.ts) is a STUB for the v1 management
// layer: it is NOT consumed by the live sim, so these numbers have no in-match
// effect yet. They define the score→interaction buckets + the per-unit
// attribute-point delta the management layer would apply pre/post-match.
//   score range is −2..+2 (see chemistry.classifyPair):
//     >= positiveAt → positive (both members +delta)
//     == riskyAt    → risky    (task member +delta, people member −delta)
//     <= negativeAt → negative (both members −delta)
//     otherwise     → neutral  (0)
export const CHEMISTRY = {
  delta: 2,          // attribute-point swing per interaction (management-applied)
  positiveAt: 2,     // score ≥ this → positive
  riskyAt: 1,        // score == this → risky (one up / one down)
  negativeAt: -2,    // score ≤ this → negative
} as const;

// Per-role base aggression rating (0–100), spec §13.1.
export const ROLE_AGGRESSION = {
  Vanguard: 70,
  Tactician: 50,
  Warden: 35,
  Specialist: 55,
} as const;

// v0.27.0 — role POSITIONING + ENGAGE-POSTURE profile (Pass 1 of the trait/role/
// hero redesign). Role used to be only the aggression number above, so a Warden
// and a Vanguard in the same strategy slot played identically. Now role also
// modulates micro-position WITHIN the slot + the engage threshold.
//   - positionOffset: hexes applied via applyAnchorOffset ON TOP of the slot's
//     own offset (+ = deeper toward own spawn, − = forward toward the enemy).
//   - engageDelta: added to engage.engageThreshold (− = commits to worse duels,
//     + = more selective). Gives posture teeth (role aggression alone is weak).
//   - crossfire: same-side group fans laterally (index-based, ±crossfireSpreadCols)
//     so cones onto the choke DIVERGE — a peeker is caught from two bearings (the
//     "crossfire fork"). Also guarantees same-role holders never collapse onto
//     one hex/path. Applied additively on the slot's already-distinct position,
//     so 2-3 of the same role degrade to a hole-y composition but never stack.
//
// SIDE-AWARE (the first cut was side-agnostic — a passive Warden was dead weight
// on attack, so mixed comps lost; measured). A unit keeps its role across the
// halftime swap but adapts posture to the side it's playing:
//   - Vanguard: ATTACK = entry (forward, commits); DEFENSE = aggressive info-peek
//     (still proactive, takes early duels) — never passive.
//   - Warden: DEFENSE = deep crossfire anchor that holds + trades; ATTACK =
//     disciplined SUPPORT (trails slightly, ~neutral threshold so it still fights
//     and contributes to the push — NOT a passive decliner).
//   - Tactician / Specialist: neutral both sides (Specialist will read its
//     adaptability attr in a later pass).
export const ROLE_PROFILE: Record<Role, Record<Side, {
  positionOffset: number;
  engageDelta: number;
  crossfire: boolean;
}>> = {
  Vanguard: {
    attacker: { positionOffset: -2, engageDelta: -0.08, crossfire: false },
    defender: { positionOffset: -1, engageDelta: -0.06, crossfire: false },
  },
  Warden: {
    attacker: { positionOffset: +1, engageDelta: +0.02, crossfire: false },
    defender: { positionOffset: +2, engageDelta: +0.08, crossfire: true  },
  },
  Tactician: {
    attacker: { positionOffset: 0, engageDelta: 0, crossfire: false },
    defender: { positionOffset: 0, engageDelta: 0, crossfire: false },
  },
  Specialist: {
    attacker: { positionOffset: 0, engageDelta: 0, crossfire: false },
    defender: { positionOffset: 0, engageDelta: 0, crossfire: false },
  },
};

// Lateral columns between adjacent same-site Warden holders for the crossfire
// fan. Index-based: the i-th of n Wardens shifts by round((i-(n-1)/2)*this).
export const CROSSFIRE_SPREAD_COLS = 3;

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
// Pass 3 — heroes are now hybrid: a weak always-on passive + ONE once-per-round
// active that fires on a tactical condition.
export const HERO_DESCRIPTIONS = {
  Angelic: 'Field Medic (active): the first time a teammate in sight is hurt but survives, the Angelic rushes a step to them, heals a big chunk of their health, and pumps their aim for a few ticks. A pure support.',
  Techy: 'Recon (passive): slightly wider vision cone. Tactical Scan (active): held until first contact, then briefly reveals enemies lurking around the nearer bomb site — targeted intel for the hit or the hold.',
  Cursed: 'Hunter (passive): a small flat aim edge. Hunter’s Mark (active): the first enemy the team spots is revealed and takes +20 HR / +10 HS from your team — until you damage it or the hunt times out.',
  Bulwark: 'Anchor (passive): a little extra max HP. Fortify (active): the first time the Bulwark is hit, it and nearby allies harden up — enemies hit them less for a few ticks. The defensive wall.',
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

  // Promoted plays (v0.28.0) — the genuinely-distinct concepts kept when the
  // trait-unlock strategy system was retired in Pass 2a. Demanding (higher
  // compliance threshold so a low-Discipline roster pays for picking them).
  // Pass 7: the 12 retired trait-unlock entries (Anchor_Hold, Mobile_Push,
  // Solo_Frag, …) were dead data — deleted.
  Mind_Games:           { aggression:   0, retreatThreshold: 0,  complianceThreshold: 60 }, // fake-and-swing (D+A)
  Coordinated_Lockdown: { aggression:  -5, retreatThreshold: 0,  complianceThreshold: 75 }, // all-5 stack
  Rotate_Stack:         { aggression:  +5, retreatThreshold: 0,  complianceThreshold: 50 }, // rotating mobile D
  // Mid_Control — large-map defense: 3 hold the central rotation hub + 1 anchors
  // each site; the hub collapses onto whichever site makes contact. Scale-fit
  // answer to maps where an even split can't reinforce across a long rotation.
  Mid_Control:          { aggression:   0, retreatThreshold: 0,  complianceThreshold: 55 },
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
// v0.21.0: 20 → 25. The attacker bias is structural (defenders split across
// two sites + mid while attackers concentrate), so combat tweaks barely move
// it — extra fuse is a rotation/retake-window lever instead. Measured +4.5pp
// defender win across the three live maps (Foundry +2, Atoll +5, Canyon +6 —
// the dense map where retakes were arriving at the detonation wire). Banked as
// a partial step toward the ~50/50 target.
// v0.23.0: 25 → 30. Even with the defensive collapse, cross-map retakes arrived
// at the wire (a retake needs rotation ~20-30 ticks + defuse, vs a 25-tick fuse).
// 30 roughly matches real tac shooters (post-plant window is several× a
// rotation). Kept identical on every map for player consistency; per-map balance
// (e.g. Foundry, already ~even) is handled by other levers, not the fuse.
export const DETONATION_TICKS = 30;
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
  egoTraits: ['Aggressor'] as readonly string[],
};

// v0.22.0 — defensive collapse-on-commit (pre-plant). The attacker bias is
// structural: defenders split across two sites + mid while attackers
// concentrate, so the defense arrives at the contested site a man short
// (measured ~2.5 attackers vs ~0.2 defenders on-site at the plant, with ~3
// defenders alive but elsewhere). When the defense collectively SEES at least
// `commitThreshold` attackers committing to one site (and more than the other),
// the off-site defenders converge on it — keeping `minWatchers` nearest the
// quiet site so a fake-and-switch can't walk in free.
//   `readRadius`: an attacker counts toward a site when it's within this many
//     hexes of that site's centroid AND closer to it than the other site —
//     wide enough to catch the push out in the approach (entry/choke/main), so
//     the collapse fires early enough for off-site defenders to actually arrive
//     (a tight centroid-only read triggered when attackers were already on-site).
//   `siteRadius`: a converging defender stops overriding once this close to the
//     target, handing back to the legacy hold/engage instead of pinning deep.
export const DEFENSIVE_COLLAPSE = {
  readRadius: 14,
  siteRadius: 7,
  commitThreshold: 2,
  minWatchers: 1,
} as const;

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
  // Season (campaign) draft is player-only — a smaller pool the player picks
  // their whole squad from (5 of 8), no AI co-draft. Kept deliberately small so
  // a new manager isn't overwhelmed at the start of the campaign.
  seasonPoolSize: 8,
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
  // Guardian Aura: +1 maxHp within N hexes of source. Pass 3 — radius cut
  // 5→3: this is now Angelic's *weak passive* (the rally active does the work).
  guardianAura: { radius: 3, maxHpBonus: 1 },
  // Tactical Scan: reveal all enemies for N ticks at round start.
  // Pass C2 tone-down: 5 → 3 ticks.
  tacticalScan: { ticks: 3 },
  // Mark Target: all allied attacks vs the marked enemy +20 HR / +10 HS.
  // Pass 9 m3 — first-spotted trigger model; reveal lasts `revealTicks` even
  // past LoS once the mark is set.
  markTarget: { hitPp: 20, hsPp: 10, revealTicks: 5 },
} as const;

// v0.30.0 / Pass 3 — HERO abilities. Each hero keeps a *weak passive* and gains
// ONE condition-triggered ACTIVE that arms at round start and fires once, the
// first tick its tactical condition is met (fair info only — own-team state).
// Magnitudes provisional (mechanics-now-tune-later); the full-stack 50/50 tune
// is a later pass.
export const HERO_ABILITIES = {
  // Angelic — SUPPORT/HEALER (Pass 4). No standing passive. ACTIVE "Field Medic":
  // the first time an ally in LOS takes damage and survives, the Angelic steps 1
  // hex toward them, heals them to full HP, and grants +hitPp for `buffTicks`
  // (combat reads it via cardFlags.rallyUntilTick → ctx.rallied).
  angelicHeal: { buffTicks: 3, hitPp: 5, healHp: 40 },
  // Techy — passive: +cone half-angle (deg) for Techy himself. ACTIVE "Tactical
  // Scan" (Pass 4): held until the team's FIRST enemy contact, then reveals
  // enemies within `radius` of the NEARER site's plant hexes for `ticks` ticks
  // (targeted recon at the objective, not a whole-map wallhack).
  techyConeBonusDeg: 6,
  techyScan: { ticks: 2, radius: 4 },
  // Cursed — passive: flat self +HR (the "hunter", ~weak; a trait's attr bonus is
  // only ~2pp). ACTIVE "Hunter's Mark" (Pass 4): the first enemy the team spots is
  // revealed + takes +HR/+HS from allies (CARD_EFFECTS.markTarget pp) for `ticks`
  // ticks OR until it takes damage from the team — a short, intense hunt.
  cursedSelfHitPp: 3,
  cursedMark: { ticks: 10 },
  // Bulwark — DEFENSIVE ANCHOR (Pass 4). Passive: self +maxHP (via a radius-0
  // guardian_aura). ACTIVE "Fortify": the first time the Bulwark takes damage,
  // it + allies within `radius` gain a fortify for `durationTicks` — shots vs a
  // fortified unit take a `hitPenaltyPp` HR penalty (a deliberate pro-DEF knob).
  bulwarkFortify: { radius: 2, durationTicks: 4, hitPenaltyPp: 6 },
} as const;

// Pass 5 — hero-neutral measurement toggle (test seam). When false, NO hero
// effect originates: arming (match.applyTraitStrategySynergies), the Bulwark
// passive (match.computeHeroPassiveEffects), and the Techy cone bonus
// (vision.coneHalfRad) all no-op, so every downstream combat/vision/tick hook
// reads inert. Lets the harness measure the pure STRUCTURAL A/D floor without
// hero noise (Cursed is no longer a neutral baseline post Pass 4). Module-global
// + deterministic (set once before a board; not part of the seed). Default true
// (live play always has heroes).
export let HERO_ABILITIES_ENABLED = true;
export function setHeroAbilitiesEnabled(enabled: boolean): void {
  HERO_ABILITIES_ENABLED = enabled;
}

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
