// All tunable values for the simulator live here. No magic numbers in game logic.
// CLAUDE.md rule: pull every tunable into config so the management layer can
// later override per-unit stats without code changes.

export const GRID = {
  cols: 20,
  rows: 30,
} as const;

// Flat-top hex geometry. `size` is the distance from hex center to corner
// (also half the flat-to-flat width / 2 along the q axis).
export const HEX = {
  size: 24,
  orientation: 'flat-top',
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

export const COLORS = {
  bg: '#0e1116',
  open: '#1c2230',
  // Full walls dominate the eye: a brighter, more present stone-grey.
  fullWall: '#7c828e',
  // Half walls fade into the floor: desaturated worn brown, subtle stripe.
  halfWall: '#3a342d',
  halfWallStripe: '#4a4239',
  defenderSpawnTint: 'rgba(59, 130, 246, 0.18)',
  attackerSpawnTint: 'rgba(239, 68, 68, 0.18)',
  hexBorder: '#2a2f3a',
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
