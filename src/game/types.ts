// Shared types across game / render / ui layers.
// erasableSyntaxOnly is on in tsconfig, so no enums — union literals only.

export type Axial = { q: number; r: number };

export type Terrain =
  | 'open'
  | 'fullWall'
  | 'halfWall'
  | 'defenderSpawn'
  | 'attackerSpawn';

export type Weapon = 'shotgun' | 'rifle' | 'sniper';

export type Team = 'defenders' | 'attackers';

// Flat-top hex facing directions, clockwise from north.
// 0=N, 1=NE, 2=SE, 3=S, 4=SW, 5=NW
export type Facing = 0 | 1 | 2 | 3 | 4 | 5;

export type UnitState = 'alive' | 'dead';

export type Unit = {
  id: string;
  team: Team;
  weapon: Weapon;
  pos: Axial;
  hp: number;
  facing: Facing;
  state: UnitState;
  // Trait fields are placeholders until Pass 5.
  skillTrait: null;
  behavioralTrait: null;
};

export type GameMap = {
  cols: number;
  rows: number;
  // cells[row][col] — offset indexing matches the map source string.
  cells: Terrain[][];
  defenderSpawns: Axial[];
  attackerSpawns: Axial[];
};

// --- Pass 2 additions -------------------------------------------------------

export type Phase = 'planning' | 'resolution';

export type Waypoint = {
  // Held for this many ticks once the unit reaches the waypoint hex.
  holdTicks: number;
  facing: Facing;
};

// A planned movement path for a single unit. hexes[0] is always the unit's
// spawn position; hexes[1..N] are the move sequence. Waypoints keyed by index
// into `hexes`.
export type Path = {
  hexes: Axial[];
  waypoints: Record<number, Waypoint>;
};

// Resolution-phase bookkeeping for one unit's progress along its path.
export type MoveCursor = {
  // Float distance along the path in hex-units. floor(progress) is the
  // current hexes index; advances by SPEED[weapon] per tick.
  progress: number;
  // Hold counter — ticks remaining at the current waypoint. While >0 the
  // unit doesn't advance and faces the waypoint direction.
  holdRemaining: number;
  // Whether this unit has already consumed the waypoint at its current hex
  // this run (so re-arriving at a waypoint after a circular path would still
  // trigger; but linear paths only consume each waypoint once).
  consumedWaypointAtIndex: number | null;
};

export type PlaybackSpeed = 1 | 2 | 4;
export type Playback = {
  playing: boolean;
  speed: PlaybackSpeed;
};

export type GameState = {
  phase: Phase;
  map: GameMap;
  units: Unit[];
  paths: Record<string, Path>;         // keyed by unit id
  cursors: Record<string, MoveCursor>;  // keyed by unit id
  tick: number;
  playback: Playback;
  // --- Pass 3 ---
  visibility: Visibility;
  ghosts: Record<Team, Record<string, GhostEntry>>;
  tracking: Record<string, TrackEntry | null>;
  prevPos: Record<string, Axial>;
  prevHoldRemaining: Record<string, number>;
  // Whose POV the fog-of-war overlay applies to. Run-time toggle in top bar.
  playerTeam: Team;
};

// --- Pass 3 additions -------------------------------------------------------

// Stringified axial key, used for Set membership in visibility computations.
export type HexKey = string; // `${q},${r}`

export type GhostEntry = {
  hex: Axial;
  ticksRemaining: number;
};

// One viewer's snap-to-track state. Cleared when the tracked enemy dies or has
// been out of sight for VISION.trackLossThreshold consecutive ticks.
export type TrackEntry = {
  enemyId: string;
  lastKnownHex: Axial;
  ticksLost: number;
};

// Team-shared visible hex sets. A hex is visible to a team if any alive
// teammate has it in their cone and unblocked by a full wall.
export type Visibility = {
  defenders: Set<HexKey>;
  attackers: Set<HexKey>;
};
