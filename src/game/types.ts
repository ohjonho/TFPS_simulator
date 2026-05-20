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

export type GameState = {
  map: GameMap;
  units: Unit[];
};
