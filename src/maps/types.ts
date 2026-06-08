/**
 * src/maps/types.ts
 *
 * Map schema — verbatim from spec §4.6.
 * Import from here in all game-logic modules; do NOT import canvas/DOM.
 */

// ---------------------------------------------------------------------------
// Cell types (§4.2)
// ---------------------------------------------------------------------------

/**
 * | Code  | Vision  | Movement | Notes                                       |
 * |-------|---------|----------|---------------------------------------------|
 * | wall  | BLOCKS  | Blocked  | Architectural void; hex-grid boundary       |
 * | open  | Passes  | Allowed  | Default traversable floor / corridor        |
 * | def   | Passes  | Allowed  | Defender-spawn marker (same as open, v0)    |
 * | atk   | Passes  | Allowed  | Attacker-spawn marker (same as open, v0)    |
 * | site  | Passes  | Allowed  | Site interior; v1 plant-placement target    |
 * | plant | Passes  | Allowed  | Subset of site; primary v1 plant zone       |
 * | mid   | Passes  | Allowed  | Mid zone; region-tagged for AI templates    |
 * | cover | Passes  | Blocked  | Half-wall; −20 pp on incoming hit chance    |
 */
export type CellType =
  | 'wall'
  | 'open'
  | 'def'
  | 'atk'
  | 'site'
  | 'plant'
  | 'mid'
  | 'cover';

// ---------------------------------------------------------------------------
// Coordinate
// ---------------------------------------------------------------------------

/** Pointy-top axial coordinate on the 30 × 40 hex grid. */
export type HexCoord = { col: number; row: number };

// ---------------------------------------------------------------------------
// Site data
// ---------------------------------------------------------------------------

export type SiteData = {
  /** All traversable hexes within the site boundary (site + plant typed). */
  hexes: HexCoord[];
  /** Subset of hexes eligible for spike-plant in v1. */
  plantHexes: HexCoord[];
  /** Geometric centre hex — used by AI as a default rallying point. */
  centerHex: HexCoord;
};

// ---------------------------------------------------------------------------
// Map definition (§4.6)
// ---------------------------------------------------------------------------

export type MapDefinition = {
  name: 'Foundry' | 'Atoll' | 'Canyon' | 'Foundryv2' | 'Atoll_v2' | 'Foundryv3';
  /** Always 30 — the grid is fixed for v0. */
  width: 30;
  /** Always 40 — the grid is fixed for v0. */
  height: 40;
  /** Primary cell data indexed [row][col]. */
  grid: CellType[][];
  /**
   * Named region → member hexes.
   * AI strategy templates reference regions by name, e.g. "rush B via b_main".
   * Required names per map are listed in Appendix B.
   */
  regions: Record<string, HexCoord[]>;
  sites: { A: SiteData; B: SiteData };
  spawns: {
    /** Three defender spawn positions for v0; expanded to 5 in v1. */
    defenders: HexCoord[];
    /** Three attacker spawn positions for v0; expanded to 5 in v1. */
    attackers: HexCoord[];
  };
  character: 'open_sightlines' | 'tight_corridors_asymmetric';
  /**
   * Opt-in strategy-aware spawn optimization (match.applyStrategies). When true,
   * defenders relocate onto the spawn-zone cell nearest their resolved target,
   * closing the approach. Per-map because it's a balance lever — helps on dense
   * maps, hurts on open-sightline ones (see config.SPAWN_SPREAD note). Defaults
   * to off when omitted.
   */
  optimizeSpawns?: boolean;
};
