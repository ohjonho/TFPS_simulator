// Live validation of the current grid. Runs the real mapFromCharGrid (so the
// editor's verdict is exactly the parser's), then layers the editor-specific
// "usable map" checks on top of the derived regions/sites. Pure — no DOM.

import type { HexCoord } from '../game/types.ts';
import { TEAM_SIZE } from '../game/config.ts';
import { mapFromCharGrid } from '../maps/gridUtils.ts';

export type Check = { label: string; ok: boolean; detail?: string };

export type EditorValidation = {
  /** mapFromCharGrid accepted the rows (shape + chars valid). */
  parsed: boolean;
  /** Thrown message from mapFromCharGrid when parsing failed. */
  error?: string;
  /** True when parsed AND every hard check passes — the green light. */
  ok: boolean;
  checks: Check[];
  /** Cell count per required region (0 when missing). */
  regionCounts: { name: string; count: number }[];
  /** Site center hexes (only present when parsed). */
  sites?: { A: HexCoord; B: HexCoord };
};

// Regions a usable map must define — strategies reference these by name.
const REQUIRED_REGIONS = [
  'a_site', 'b_site', 'a_plant', 'b_plant',
  'a_main', 'b_main', 'mid', 'def_spawn', 'atk_spawn',
] as const;

function meanRow(hexes: readonly HexCoord[]): number {
  return hexes.reduce((s, h) => s + h.row, 0) / hexes.length;
}

export function validate(rows: readonly string[]): EditorValidation {
  let parsed: ReturnType<typeof mapFromCharGrid>;
  try {
    parsed = mapFromCharGrid(rows);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return {
      parsed: false,
      error,
      ok: false,
      checks: [{ label: 'Grid parses (30×40, known chars)', ok: false, detail: error }],
      regionCounts: REQUIRED_REGIONS.map((name) => ({ name, count: 0 })),
    };
  }

  const regions = parsed.regions;
  const count = (name: string): number => regions[name]?.length ?? 0;
  const regionCounts = REQUIRED_REGIONS.map((name) => ({ name, count: count(name) }));

  const defCount = count('def_spawn');
  const atkCount = count('atk_spawn');
  const aPlant = count('a_plant');
  const bPlant = count('b_plant');
  const missing = REQUIRED_REGIONS.filter((name) => count(name) === 0);

  const def = regions['def_spawn'] ?? [];
  const atk = regions['atk_spawn'] ?? [];
  const northSouthOk = def.length > 0 && atk.length > 0 && meanRow(def) < meanRow(atk);

  const checks: Check[] = [
    { label: 'Grid parses (30×40, known chars)', ok: true },
    {
      label: `Defender spawns ≥ ${TEAM_SIZE}`,
      ok: defCount >= TEAM_SIZE,
      detail: `${defCount} D cells`,
    },
    {
      label: `Attacker spawns ≥ ${TEAM_SIZE}`,
      ok: atkCount >= TEAM_SIZE,
      detail: `${atkCount} X cells`,
    },
    { label: 'A site has plant cells', ok: aPlant > 0, detail: `${aPlant} a cells` },
    { label: 'B site has plant cells', ok: bPlant > 0, detail: `${bPlant} b cells` },
    {
      label: 'Defenders north of attackers',
      ok: northSouthOk,
      detail:
        def.length && atk.length
          ? `def row ~${meanRow(def).toFixed(1)} vs atk row ~${meanRow(atk).toFixed(1)}`
          : 'need both spawns',
    },
    {
      label: 'All required regions present',
      ok: missing.length === 0,
      detail: missing.length ? `missing: ${missing.join(', ')}` : undefined,
    },
  ];

  const ok = checks.every((c) => c.ok);

  return {
    parsed: true,
    ok,
    checks,
    regionCounts,
    sites: { A: parsed.sites.A.centerHex, B: parsed.sites.B.centerHex },
  };
}
