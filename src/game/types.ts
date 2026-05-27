// Shared types across game / render / ui layers.
// erasableSyntaxOnly is on in tsconfig, so no enums — union literals only.

import type { CellType, HexCoord, MapDefinition } from '../maps/types.ts';

// Re-export the map schema so game/render/ui import map types from one place.
export type { CellType, HexCoord, MapDefinition };

// Axial cube-ish coordinate, used internally by hex distance math.
export type Axial = { q: number; r: number };

export type Weapon = 'shotgun' | 'rifle' | 'sniper';

// Team is the identity tag (= team color). The role a team plays this half is
// `state.teamSide[team]` (Side). At halftime, teamSide swaps so the team that
// was defending now attacks (and reposistions to the opposite spawn).
export type Team = 'defenders' | 'attackers';
export type Side = 'attacker' | 'defender';

// Pointy-top hex facing directions, clockwise from north.
// 0=N, 1=NE, 2=SE, 3=S, 4=SW, 5=NW
export type Facing = 0 | 1 | 2 | 3 | 4 | 5;

export type UnitState = 'alive' | 'dead';

// Dynamic per-unit modifiers (spec §13). Neutral defaults in Pass 5; Pass 6
// assigns real per-role/handling/off-position values and wires their formulas.
// Pass 7 adds the per-round strategy-driven retreat-threshold delta.
export type Modifiers = {
  aggression: number;             // 0–100; affects push tendency + early-round HR
  // (Pass A3 — `weaponHandling` removed; HR modifier now comes from the three
  // per-weapon attribute sub-ratings: rifleHandling / shotgunHandling /
  // sniperHandling, selected against the shooter's current loadout.)
  offPosition: boolean;           // off-preferred-role penalty
  retreatThresholdMod: number;    // added to AI.retreatHpThreshold (e.g. Rush = −1)
};

// Temporary stat modifier applied by cards (Pass 8) or systems. Read additively
// in the effective-stat summation; expired entries are dropped each tick.
export type Buff = {
  id: string;
  source?: string;
  hitPp?: number;
  headshotPp?: number;
  maxHpDelta?: number;
  expiresAtTick: number;
};

// Trait unions (spec §12), role (§10), hero (§11).
// Pass H2 — added the Personality category (Mental + Social fused into one
// pool). Each unit now carries one trait per category (skill / behavioral /
// personality), up from 2-per-unit. Each trait can declare a `unlocks`
// list of strategy ids that H3 surfaces on the strategy menu.
export type SkillTrait =
  | 'Sharp Aim'
  | 'Headhunter'
  | 'Eagle Eye'
  | 'First Shot'
  // H2 expansion — combat-flavored specialists
  | 'Spray Down'      // post-first-3-shots HR bonus (opposite of First Shot)
  | 'Deadeye'         // long-range HR specialist
  | 'Close Quarters'; // short-range HR specialist
export type BehavioralTrait =
  | 'Sentinel'
  | 'Run-n-Gun'
  | 'Lurker'
  | 'Entry'
  | 'Trader'
  | 'Clutch'
  // H2 expansion — engagement-style flavors
  | 'Roamer'          // mobile defender (rotates, doesn't hold one angle)
  | 'Hot Head';       // first to engage, low Discipline / Tenacity
export type PersonalityTrait =
  | 'Big Brain'   // mental — analytical, reads the map
  | 'Ego'         // mental — high-confidence freelancer
  | 'Composed'    // mental — steady under pressure
  | 'Leader'      // social — coordinates + buffs allies
  | 'Lone Wolf'   // social — works alone, weak comms
  // H2 expansion — round-pressure / vigilance / veteran flavors
  | 'Paranoid'    // mental — over-rotates, sees ghosts
  | 'Patient'     // mental — late-round HR bonus
  | 'Old Pro';    // veteran — small all-around boost; v1 "earned via XP"
export type TraitId = SkillTrait | BehavioralTrait | PersonalityTrait;

// Pass H2 — generic trait shape. Each trait declares sub-attribute deltas
// (consumed by rollUnitMeta) and an unlocks list (consumed by traits.ts'
// availableStrategies to expand the strategy menu beyond the baseline 3).
// `category` lets the UI group traits in the panel; H3 may also read it
// for compliance-roll modifiers (e.g. Ego personality lowers Discipline
// adherence).
// H2 — trait rarity tier. v0 sim treats all tiers as uniform-pickable from
// the trait pool; v1's progression layer reads this to gate scouting +
// match-XP-earned trait unlocks (starters appear on scouted units; earned
// traits require XP / training; event traits require specific in-match
// triggers like ace-1v3-survival).
export type TraitTier = 'starter' | 'earned' | 'event';

export type TraitDef = {
  id: TraitId;
  category: 'skill' | 'behavioral' | 'personality';
  tier: TraitTier;
  attrBonuses: Partial<Attributes>;
  unlocks: string[];                // strategy ids; forward-ref'd from H3
  description: string;
};

export type Role = 'Vanguard' | 'Tactician' | 'Warden' | 'Specialist';
export type Hero = 'Angelic' | 'Techy' | 'Cursed';

// --- Pass H1: per-unit attributes (0-100 ratings, 50 = baseline) ----------
// 10 hidden sub-attributes that combat / vision math reads directly. The UI
// surfaces 5 aggregate visible attributes (see `VisibleAttributes` +
// `aggregateVisible` in attributes.ts) so the manager-game player isn't
// looking at a 14-row spreadsheet. Each sub maps cleanly into one visible
// via the weighted `ATTRIBUTES.aggregation` table in config.
export type Attributes = {
  // --- Mechanics (visible aggregate) ---
  aim: number;              // HR pp contribution (Pass A2)
  headshot: number;         // HS roll pp (F2)
  reflexes: number;         // scales First Shot trait magnitude (F2)
  weaponAffinity: number;   // H1 — single per-unit modifier; replaces
                            // rifleHandling/shotgunHandling/sniperHandling.
                            // Reads against whatever weapon the unit holds.
  // --- Game Sense (visible aggregate) ---
  vision: number;           // cone width + tracking acquisition (was awareness)
  mapIQ: number;            // path quality + cover-seek radius (absorbs old
                            // positioning attribute).
  // --- Discipline (visible aggregate, 1:1 with this sub) ---
  tenacity: number;         // H1 — generated, INERT until H3 (gates the
                            // per-tick compliance roll once strategies have
                            // complianceThreshold).
  // --- Improvisation (visible aggregate) ---
  composure: number;        // post-damage / last-alive HR retention; absorbs
                            // old clutch + composure (was duplicative).
  adaptability: number;     // H1 — generated, INERT until H3 (quality of
                            // fallback-tree decision when compliance fails).
  // --- Leadership (visible aggregate, 1:1 with this sub) ---
  comms: number;            // H1 — generated, INERT until H3 (aura radius +
                            // ally buff magnitude; replaces teamwork +
                            // communication).
  // Cut from the pre-H1 schema: sprayControl (inert), confidence (≈ composure),
  // positioning (folded into mapIQ), discipline-as-sub (becomes the visible
  // primary, derived from tenacity), teamwork + communication (→ comms),
  // rifle/shotgun/sniperHandling (→ weaponAffinity), clutch (→ composure).
};

// Pass H1 — the 5 visible aggregate attributes the player sees in the UI.
// Computed from the 10 hidden subs via the weighted-sum table in
// config.ATTRIBUTES.aggregation; consumed by attributesPanel and the
// draft pool cards. Combat / vision math never reads these — they read the
// hidden subs directly so the formulas stay precise.
export type VisibleAttributes = {
  mechanics: number;     // aim + headshot + reflexes + weaponAffinity
  gameSense: number;     // vision + mapIQ
  discipline: number;    // tenacity (1:1)
  improvisation: number; // composure + adaptability
  leadership: number;    // comms (1:1)
};

export type Unit = {
  id: string;
  team: Team;
  weapon: Weapon;
  // Offset coordinate (col,row), matching MapDefinition.grid indexing.
  pos: HexCoord;
  hp: number;
  // Pass 8 — max HP can be raised by Guardian Aura; restored at round end.
  maxHp: number;
  facing: Facing;
  state: UnitState;
  // Attributes assigned at match start (Pass 6).
  skillTrait: SkillTrait | null;
  behavioralTrait: BehavioralTrait | null;
  // Pass H2 — third trait dimension (mental + social fused). Each unit
  // contributes its three traits' `unlocks` lists to the team's available
  // strategies; cumulative composition decides the strategy menu (H3).
  personalityTrait: PersonalityTrait | null;
  role: Role;
  preferredRole: Role;
  hero: Hero;
  // Dynamic modifiers.
  modifiers: Modifiers;
  // Pass A1 — per-unit attribute ratings (0-100, 50 = baseline). Assigned at
  // match start by assignAttributes(); persists across rounds via the loop
  // snapshot. Combat/vision integration is staged in later sub-passes.
  attributes: Attributes;
  // Pass 8 — card-driven flags set at round start, cleared at round end.
  // All optional; unset = no card effect on this unit.
  cardFlags: CardFlags;
  // Pass 9 — per-unit directives composing this unit's tactical behavior for
  // the round. Set at round start by applyStrategies (strategy directives) +
  // commitCards (card directives), cleared by startRound. Empty array = legacy
  // default behavior tree (region move + cover-seek + rotation).
  directives: Directive[];
};

// --- Pass 8 / H3.4 — card system removed ---------------------------------
//
// H3.4 — CardDef / CardInstance / TeamDeck / PlayedCard / CardSource /
// CardType / TargetingKind all deleted. Strategy + trait + hero synergies
// (set in match.applyStrategies) now own the effect-flag plumbing
// (`cardFlags` + `cardEffects`) that the card-play handlers used to.
// The "card" names on those two state slots are historical; the mechanism
// is generic. Combat / vision / tick hooks unchanged.

// Round-scoped non-buff effects (formerly card handlers, now strategy
// synergies + hero passives). Read by combat/vision/
// tick each step; cleared on round start.
export type ActiveCardEffect =
  // Pass 9 m3 — mark_target gained `revealUntilTick`: while > tick, vision adds
  // the marked enemy's hex to the marking team's visibility set even without
  // LoS. Pass 9 m4 — `expiresAtTick` lets Trade Window's mark expire after
  // 4 ticks while Mark Target's mark (no expiresAtTick) lasts the whole round
  // (cleared by startRound's cardEffects reset).
  | { kind: 'mark_target'; team: Team; targetId: string; revealUntilTick?: number; expiresAtTick?: number }
  | { kind: 'guardian_aura'; team: Team; sourceId: string; radius: number }
  | { kind: 'tactical_scan'; team: Team; expiresAtTick: number }
  | { kind: 'hold_the_line'; team: Team; anchorHex: HexCoord; anchorId: string }
  | { kind: 'setup_play'; team: Team; allyId: string; expiresAtTick: number }
  | { kind: 'spearhead'; team: Team; vanguardId: string };

// --- Pass 9: per-unit directives ------------------------------------------

// A composable behavior the unit follows this round. Strategies + cards both
// inject these. Pure data; evaluators live in `directives.ts`.
//
// `priority` resolves conflicts when multiple directives apply this tick;
// higher priority wins. Convention: survival directives 90+, role-specific
// 50-89, ambient/fallback 0-49.
export type Directive =
  | { kind: 'hold_angle'; priority: number; facingHex: HexCoord }
  | { kind: 'safe_sniper'; priority: number; angleHex: HexCoord; repositionAfterShots: number; repositionRadius: number }
  | { kind: 'rotate_on_team_contact'; priority: number; rotateToHex: HexCoord; watchAllies: string[]; delayTicks: number }
  | { kind: 'trade_for'; priority: number; allyId: string; windowTicks: number }
  | { kind: 'peek_and_retreat'; priority: number; peekHex: HexCoord; coverHex: HexCoord; cadenceTicks: number }
  | { kind: 'commit_site'; priority: number; siteHex: HexCoord; leaveOnContactInRegions: string[] };

// What a directive evaluator returns when it applies this tick. tick.ts
// merges these with the legacy default-behavior tree (directive wins on each
// field it provides; tree fills the rest).
export type DirectiveDecision = {
  // Override the unit's movement target this tick.
  target?: HexCoord;
  // Override the unit's facing (for hold modes); ignored if movement applies.
  facing?: HexCoord;
  // Don't engage even if enemies are visible (sniper waits for the right
  // moment; peek_and_retreat fires only when at peek hex).
  suppressEngage?: boolean;
  // For diagnostics: which directive produced this decision.
  source?: Directive['kind'];
};

// Per-unit card flags. Mostly booleans set by handlers and read by combat/AI;
// some carry numeric counters (e.g. delayedMoveUntilTick for Spearhead allies).
export type CardFlags = {
  anchorPosition?: boolean;
  recklessPush?: boolean;
  slowFlank?: boolean;
  openingPickActive?: boolean;
  crossfireEligible?: boolean;
  // Cap stack: trait gives base; card adds up to 1 extra (max 2 stacks total).
  crossfireBuffsApplied?: number;
  // Pass 9 m4 — Last Stand replaced by Trade Window. Set on the contributor
  // at round start; tick.ts death-handler reads this and, when ANY teammate
  // of the contributor dies, marks the killer + buffs surviving allies.
  tradeWindowEnabled?: boolean;
  spearhead?: boolean;
  // Spearhead allies wait this many ticks before they start moving.
  delayedMoveUntilTick?: number;
  // Pass 9 m3 — Mark Target rework. Set on the contributor at round start;
  // the tick loop watches for their first tracked enemy and converts the
  // pending flag into an active mark_target effect on that enemy, then
  // clears this flag for the rest of the round.
  markTargetPending?: boolean;
  setupPlayBonus?: boolean;
  // Pass C2 — Setup Play anchor hex (the Tactician's chosen position). Allies
  // within `setupPlay.allyRangeHexes` of this hex with `setupPlayBonus` get
  // the +20 HR; combat.ts reads both flags.
  setupPlayAnchor?: HexCoord;
  holdTheLineAnchor?: HexCoord;
  // Set when an ally reaches a Hold-the-Line anchor; shots vs this unit forced
  // miss while tick < safeWindowUntilTick.
  safeWindowUntilTick?: number;
  // Pass C2 — Slow Flank invisibility. While true, the unit is omitted from
  // the OPPOSING team's `enemiesVisibleTo` filter — AI can't acquire them as
  // a target until they fire OR get within `slowFlank.proximityHexes`. Cleared
  // by tick.ts when the unit fires (or by proximity check in vision-filter).
  invisibleUntilFire?: boolean;
};

// --- Match flow -------------------------------------------------------------

// Pass G — `'draft'` is the pre-planning phase where player and AI take
// turns picking from a generated 8-unit pool. Active only when matchMode
// is 'draft' and only at match start (before round 1). Transitions to
// 'planning' on `finalizeDraft`.
export type Phase = 'planning' | 'resolution' | 'draft';

// Pass G — match generation mode (renamed from 'randomize' in Pass E m5).
// 'standard' = fixed 2r+1s loadouts + flat-50 attributes (the v0 default).
// 'draft'    = generate a shared 8-unit pool, player and AI snake-pick 3
//              each (P-A-A-P-P-A). Drafted units get full random attributes
//              ([40, 60] uniform) + random traits/skills/role/hero. Replaces
//              the old 'randomize' mode — the auto-draft sub-toggle within
//              the draft UI recovers the "just RNG it" feel.
export type MatchMode = 'standard' | 'draft';

// Pass G — pre-planning draft state. Present on GameState only while
// phase === 'draft'; cleared on finalizeDraft. `pool` units carry pool-
// scoped ids (P1..P8); finalizeDraft re-IDs picked units to D1/A1/...
export type DraftState = {
  pool: Unit[];                                              // 8 fully-generated units
  pickOrder: Team[];                                         // length 6, e.g. [P,A,A,P,P,A] resolved to teams
  picks: Array<{ pickerTeam: Team; unitId: string }>;        // appended on each commit
  currentPickIdx: number;                                    // 0..6 (6 = ready to finalize)
  autoMode: boolean;                                         // true → player picks auto-resolve via heuristic
};

export type PlaybackSpeed = 1 | 2 | 4;
export type Playback = {
  playing: boolean;
  speed: PlaybackSpeed;
};

// A unit's pending movement: the A* route (inclusive of start hex) and a float
// cursor along it. floor(progress) is the current hex index; the fractional
// part lets the sniper advance half a hex per tick.
export type MoveState = {
  path: HexCoord[];
  progress: number;
};

// --- Pass 3: vision & fog ---------------------------------------------------

// Stringified offset key for Set membership in visibility computations.
export type HexKey = string; // `${col},${row}`

export type GhostEntry = {
  hex: HexCoord;
  ticksRemaining: number;
};

// One viewer's snap-to-track state. Cleared when the tracked enemy dies or has
// been out of sight for VISION.trackLossThreshold consecutive ticks.
export type TrackEntry = {
  enemyId: string;
  lastKnownHex: HexCoord;
  ticksLost: number;
};

// Team-shared visible hex sets. A hex is visible to a team if any alive
// teammate has it in their cone, unblocked by a full wall.
export type Visibility = {
  defenders: Set<HexKey>;
  attackers: Set<HexKey>;
};

// --- Pass 4: per-unit AI ----------------------------------------------------

export type AiMode = 'moving' | 'engaged' | 'retreating' | 'holding';

export type AiState = {
  mode: AiMode;
  // Enemy id this unit is shooting at while engaged (null otherwise).
  firingTarget: string | null;
  // Ticks since this unit last had any enemy in sight (drives resume).
  ticksSinceEnemySeen: number;
  // Counts down to the next allowed shot; gates fire rate (sniper every 2).
  shotClock: number;
  // --- Pass 6 combat-context counters ---
  // Consecutive ticks the unit has not changed hex (Sentinel).
  stationaryTicks: number;
  // Consecutive ticks in the engaged state (Entry window).
  engagementTicks: number;
  // Shots fired in the current engagement (First Shot).
  shotsThisEngagement: number;
  // Tick of this unit's last shot (Trader: ally fired recently).
  lastFiredTick: number;
  // Pass 9 m2 — sticky-engage counter: ticks the unit has held `engaged` mode
  // despite no visible enemy this tick. Lets a unit briefly persist through
  // LoS interruptions (enemy steps behind a wall) instead of flip-flopping
  // between engaged/moving. Resets to 0 when an enemy is visible again.
  engageStickyTicks: number;
};

// Range band by hex distance (spec §4.3). Thresholds live in config.RANGE.
export type RangeBand = 'short' | 'medium' | 'long';

// Combat event log (spec §18.4 kill feed source). A discriminated union: each
// resolved shot is one `shot` event; lethal damage adds a `death`.
// Pass A5 — every event carries `roundIndex` so stats can filter to a single
// round without timestamp-walking the strategyPick markers. Pushed by tick.ts
// and match.ts using state.round at push time.
export type GameEvent =
  | {
      tick: number;
      roundIndex: number;
      type: 'shot';
      shooter: string;
      target: string;
      weapon: Weapon;
      range: RangeBand;
      hit: boolean;
      headshot: boolean;
      damage: number;
      cover: boolean;
    }
  | { tick: number; roundIndex: number; type: 'death'; target: string }
  | {
      // Pass 9 m1 — round-start summary entry. Surfaces both teams' picks in
      // the kill feed so the player can tell what the AI did each round.
      // H3.4 — playerCardDefId/aiCardDefId removed (card system deleted).
      tick: number;
      roundIndex: number;
      type: 'strategyPick';
      round: number;
      playerTeam: Team;
      playerStrategy: string | null;
      aiStrategy: string | null;
    }
  // Pass B — spike plant lifecycle events.
  | { tick: number; roundIndex: number; type: 'plant'; unit: string; site: 'A' | 'B' }
  | { tick: number; roundIndex: number; type: 'defuse'; unit: string }
  | { tick: number; roundIndex: number; type: 'detonate'; site: 'A' | 'B' }
  // Pass A5 — round-end anchor for stats. Survival flags (KAST-S) are derived
  // by checking whether each unit has a 'death' event in this round.
  | {
      tick: number;
      roundIndex: number;
      type: 'roundResult';
      winner: Team | 'draw';
      ticks: number;
    };

// Pass B — spike-plant state on GameState. `planted` is set when a spike is
// down (post-plant, pre-detonation). `planting` / `defusing` track the
// in-progress action (cleared each tick that doesn't continue).
export type PlantState = {
  planted: { site: 'A' | 'B'; plantedAtTick: number } | null;
  planting: { unitId: string; site: 'A' | 'B'; startedAtTick: number } | null;
  defusing: { unitId: string; startedAtTick: number } | null;
};

export type GameState = {
  phase: Phase;
  map: MapDefinition;
  units: Unit[];
  playback: Playback;
  // Whose POV the fog overlay applies to. Run-time toggle in top bar.
  playerTeam: Team;
  // --- Pass 2 ---
  tick: number;
  // Seed for the deterministic PRNG (replay reproducibility).
  seed: number;
  // Assigned destination per unit id (null = no order).
  targets: Record<string, HexCoord | null>;
  // Active movement cursor per unit id.
  moves: Record<string, MoveState>;
  // --- Pass 3 ---
  visibility: Visibility;
  ghosts: Record<Team, Record<string, GhostEntry>>;
  tracking: Record<string, TrackEntry | null>;
  // Pre-tick positions, used for the sniper-stationary cone test.
  prevPos: Record<string, HexCoord>;
  // --- Pass 4 ---
  ai: Record<string, AiState>;
  events: GameEvent[];
  // --- Pass 5 ---
  // Active temporary buffs per unit id (cards/systems). Empty until Pass 8.
  buffs: Record<string, Buff[]>;
  // --- Pass 7: match flow ---
  round: number;                          // 1..MATCH_ROUND_COUNT (extra rounds → sudden death TBD)
  scores: Record<Team, number>;
  teamSide: Record<Team, Side>;           // each team's role this half; swaps at halftime
  playerStrategy: string | null;          // chosen strategy id this round (player team)
  // Pass C — player's chosen variant index for the selected strategy. null
  // until they pick (Begin Round disabled for multi-variant strategies until
  // set). Reset to null on startRound + when the player switches strategy.
  // Single-variant strategies (Control / Pressure) ignore this field. AI
  // continues to pick its variant via the seeded RNG.
  playerVariantChoice: number | null;
  aiStrategy: string | null;              // opponent's pick (set by aiOpponent at Begin Round)
  roundResult: { winner: Team | 'draw' } | null;
  timeoutUsed: Record<Team, boolean>;
  // AI win-rate tracker per team for §16 weighted strategy pick.
  aiStrategyWins: Record<Team, Record<string, number>>;
  matchOver: boolean;
  matchWinner: Team | 'draw' | null;
  // --- Pass 8: cards ---
  // H3.4 — `cards` (TeamDeck) and `playedCard` removed (card system deleted).
  // Round-scoped effects (formerly populated by card handlers, now by
  // strategy synergies + hero passives in match.applyStrategies).
  cardEffects: ActiveCardEffect[];
  // --- Pass B ---
  plant: PlantState;
  // Per-unit visibility snapshot from the PREVIOUS tick. Used by the
  // peeker's-advantage HR penalty: when a shooter fires at a target whose
  // hex is visible this tick but was NOT in prevPerUnitVisible[shooter.id],
  // the first shot takes a small HR hit (modeling the held angle's lag).
  // Persists between rounds is fine; reset at round start for cleanliness.
  prevPerUnitVisible: Record<string, ReadonlySet<HexKey>>;
  // Pass E m5 — generation mode the match was built with. Mirrored from the
  // buildInitialState arg so the UI can show mode-relevant chrome (seed
  // input + Regenerate button) and __sim can introspect.
  matchMode: MatchMode;
  // Pass G — draft state, present only while phase === 'draft'. Cleared on
  // finalizeDraft. Optional so non-draft modes carry no extra payload.
  draft?: DraftState;
};
