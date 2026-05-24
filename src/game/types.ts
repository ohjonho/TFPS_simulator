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
  weaponHandling: number;         // 0–100; HR modifier
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
export type SkillTrait = 'Sharp Aim' | 'Headhunter' | 'Eagle Eye' | 'First Shot';
export type BehavioralTrait =
  | 'Sentinel'
  | 'Run-n-Gun'
  | 'Lurker'
  | 'Entry'
  | 'Trader'
  | 'Clutch';
export type Role = 'Vanguard' | 'Tactician' | 'Warden' | 'Specialist';
export type Hero = 'Angelic' | 'Techy' | 'Cursed';

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
  role: Role;
  preferredRole: Role;
  hero: Hero;
  // Dynamic modifiers.
  modifiers: Modifiers;
  // Pass 8 — card-driven flags set at round start, cleared at round end.
  // All optional; unset = no card effect on this unit.
  cardFlags: CardFlags;
  // Pass 9 — per-unit directives composing this unit's tactical behavior for
  // the round. Set at round start by applyStrategies (strategy directives) +
  // commitCards (card directives), cleared by startRound. Empty array = legacy
  // default behavior tree (region move + cover-seek + rotation).
  directives: Directive[];
};

// --- Pass 8: cards ---------------------------------------------------------

// Card sources span all three attribute unions (1 card per trait, role, hero).
export type CardSource = BehavioralTrait | Role | Hero;
export type CardType = 'directive' | 'buff' | 'utility';
export type TargetingKind = 'none' | 'enemy' | 'ally' | 'hex' | 'role';

export type CardDef = {
  id: string;
  name: string;
  source: CardSource;
  type: CardType;
  targeting: TargetingKind;
  description: string;
};

// A card in someone's deck/hand/discard — references a CardDef by id and the
// unit that contributed it (for source labels in the UI).
export type CardInstance = { defId: string; contributor: string };

export type TeamDeck = {
  deck: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
};

// A played card snapshot. `target` shape depends on the card's TargetingKind:
//   'none' → undefined; 'enemy'/'ally' → unit id; 'hex' → HexCoord;
//   'role' → Role string; Setup Play uses { hex, allyId } in a HexCoord-shaped
//   target combined with a separate allyId effect (handler reads both).
export type PlayedCard = {
  defId: string;
  contributor: string;
  target?: HexCoord | string | Role;
  // Setup Play needs a hex + ally; rather than overload `target`, carry a
  // second field for the rare two-pick card.
  secondaryTarget?: string;
};

// Round-scoped non-buff effects card handlers register. Read by combat/vision/
// tick each step; cleared on round start.
export type ActiveCardEffect =
  | { kind: 'mark_target'; team: Team; targetId: string }
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
  lastStandActive?: boolean;
  lastStandGhostSkipUntilTick?: number;
  spearhead?: boolean;
  // Spearhead allies wait this many ticks before they start moving.
  delayedMoveUntilTick?: number;
  setupPlayBonus?: boolean;
  holdTheLineAnchor?: HexCoord;
  // Set when an ally reaches a Hold-the-Line anchor; shots vs this unit forced
  // miss while tick < safeWindowUntilTick.
  safeWindowUntilTick?: number;
};

// --- Match flow -------------------------------------------------------------

export type Phase = 'planning' | 'resolution';

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
};

// Range band by hex distance (spec §4.3). Thresholds live in config.RANGE.
export type RangeBand = 'short' | 'medium' | 'long';

// Combat event log (spec §18.4 kill feed source). A discriminated union: each
// resolved shot is one `shot` event; lethal damage adds a `death`.
export type GameEvent =
  | {
      tick: number;
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
  | { tick: number; type: 'death'; target: string }
  | {
      tick: number;
      type: 'cardPlay';
      team: Team;
      defId: string;
      contributor: string;
      target?: HexCoord | string;
    }
  | {
      tick: number;
      type: 'safeWindowBlock';
      shooter: string;
      target: string;
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
  aiStrategy: string | null;              // opponent's pick (set by aiOpponent at Begin Round)
  roundResult: { winner: Team | 'draw' } | null;
  timeoutUsed: Record<Team, boolean>;
  // AI win-rate tracker per team for §16 weighted strategy pick.
  aiStrategyWins: Record<Team, Record<string, number>>;
  matchOver: boolean;
  matchWinner: Team | 'draw' | null;
  // --- Pass 8: cards ---
  cards: Record<Team, TeamDeck>;
  // Card committed for this round by each team (null until played / if skipped).
  // Reset to null on startRound.
  playedCard: Record<Team, PlayedCard | null>;
  // Round-scoped non-buff card effects; cleared on startRound.
  cardEffects: ActiveCardEffect[];
};
