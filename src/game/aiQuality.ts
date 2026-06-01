// AI-quality probe — measures whether the AI is *good*, not whether the map is
// *balanced*. Those are orthogonal: aggregate atk/def win% is a balance signal
// (a coin flip scores 50%) and is confounded by map geometry, loadout, strategy
// set, and AI behavior all at once. This module isolates AI quality with three
// balance-independent signals, all cheaper than a full strategy matrix:
//
//   1. Skill pays — sweep one visible attribute group HIGH on the defenders /
//      LOW on the attackers, then the reverse, and take the *gap*. The gap
//      cancels map bias (it's symmetric), so a positive, magnitude-monotone gap
//      means the AI actually reads that attribute. A flat/negative gap means the
//      attribute is inert or mis-wired.
//   2. Structure — read the 3x3 baseline strategy matrix for *spread* and
//      *counters*, not the mean. Good AI+strategies => meaningful spread + no
//      single dominant strategy (the best defensive answer varies by attacker
//      pick). A flat or single-peaked matrix means strategy choice is inert.
//   3. Behavior — automatable plausibility proxies from the event log:
//      participation (fraction of units that fire at all — parked units are the
//      classic "facing a wall" symptom), decisiveness (elimination vs timeout),
//      and round length. The real signal-3 check is still a 30s browser watch;
//      these just flag gross pathologies cheaply.
//
// All deterministic (pure runStrategyRound calls). Run on ONE canonical map
// (Foundry II) with the fixed standard 4R/1S roster and no unlocks/powers/
// heroes, so an AI change is the only thing that moves a number.

import type { Attributes, GameEvent, MapDefinition } from './types.ts';
import type { AttributeOverride } from './attributes.ts';
import { runStrategyRound, runStrategyMatrix } from './batch.ts';

const DEF_IDS = ['D1', 'D2', 'D3', 'D4', 'D5'] as const;
const ATK_IDS = ['A1', 'A2', 'A3', 'A4', 'A5'] as const;

const ALL_ATTRS: readonly (keyof Attributes)[] = [
  'aim', 'headshot', 'reflexes', 'weaponAffinity',
  'vision', 'mapIQ', 'tenacity', 'composure', 'adaptability', 'comms',
];

// Visible aggregate -> the hidden sub-attributes that compose it (see
// attributes.aggregateVisible). Sweeping the whole group moves the aggregate
// the player actually sees. (adaptability is still inert, so Improvisation
// moves only via composure — the probe will show that honestly.)
const GROUPS: readonly { name: string; attrs: readonly (keyof Attributes)[] }[] = [
  { name: 'Mechanics',     attrs: ['aim', 'headshot', 'reflexes', 'weaponAffinity'] },
  { name: 'Game Sense',    attrs: ['vision', 'mapIQ'] },
  { name: 'Discipline',    attrs: ['tenacity'] },
  { name: 'Improvisation', attrs: ['composure', 'adaptability'] },
  { name: 'Leadership',    attrs: ['comms'] },
];

const round1 = (n: number) => Math.round(n * 10) / 10;

// Build a both-teams override: every attribute pinned to 50, then the swept
// group set to `defVal` on defenders and `atkVal` on attackers. Pinning the
// rest to 50 removes attribute RNG entirely so the gap is pure signal.
function skillOverride(
  group: readonly (keyof Attributes)[],
  defVal: number,
  atkVal: number,
): Record<string, AttributeOverride> {
  const base: Partial<Attributes> = {};
  for (const k of ALL_ATTRS) base[k] = 50;
  const defAttrs: Partial<Attributes> = { ...base };
  const atkAttrs: Partial<Attributes> = { ...base };
  for (const k of group) { defAttrs[k] = defVal; atkAttrs[k] = atkVal; }
  const o: Record<string, AttributeOverride> = {};
  for (const id of DEF_IDS) o[id] = { attributes: { ...defAttrs } };
  for (const id of ATK_IDS) o[id] = { attributes: { ...atkAttrs } };
  return o;
}

function defWinPct(
  seeds: number,
  mapName: MapDefinition['name'],
  overrides: Record<string, AttributeOverride>,
): number {
  let def = 0;
  for (let i = 0; i < seeds; i++) {
    const r = runStrategyRound(5000 + i, {
      defenderStrategy: 'Hold',
      attackerStrategy: 'Execute',
      mapName,
      overrides,
    });
    if (r.winner === 'defenders') def++;
  }
  return round1((def / seeds) * 100);
}

// ---- Signal 1: skill pays --------------------------------------------------

export type SkillPaysRow = {
  group: string;
  // gap = defWin(def-favored) - defWin(atk-favored) at each delta. Positive =
  // the side with the higher attribute wins more, i.e. skill pays.
  gapMildPp: number;    // +/-20 around 50 (70 vs 30)
  gapStrongPp: number;  // +/-40 around 50 (90 vs 10)
  paysOff: boolean;     // strong gap clears the noise floor
  monotone: boolean;    // gap grows with the skill delta (strong >= mild >= 0)
};

export function runSkillPays(
  seeds: number,
  mapName: MapDefinition['name'],
): SkillPaysRow[] {
  const NOISE_FLOOR_PP = 4; // below this, treat as inert given seed variance
  return GROUPS.map(({ name, attrs }) => {
    const mildDef = defWinPct(seeds, mapName, skillOverride(attrs, 70, 30));
    const mildAtk = defWinPct(seeds, mapName, skillOverride(attrs, 30, 70));
    const strongDef = defWinPct(seeds, mapName, skillOverride(attrs, 90, 10));
    const strongAtk = defWinPct(seeds, mapName, skillOverride(attrs, 10, 90));
    const gapMild = round1(mildDef - mildAtk);
    const gapStrong = round1(strongDef - strongAtk);
    return {
      group: name,
      gapMildPp: gapMild,
      gapStrongPp: gapStrong,
      paysOff: gapStrong > NOISE_FLOOR_PP,
      monotone: gapStrong + 1e-9 >= gapMild && gapMild + 1e-9 >= -NOISE_FLOOR_PP,
    };
  });
}

// ---- Signal 2: strategy-matrix structure -----------------------------------

export type StructureResult = {
  spreadPp: number;       // max - min defWin across the 9 cells
  stdevPp: number;
  defRowMeans: Record<string, number>;  // how good each defense is on average
  atkColMeans: Record<string, number>;  // how good each offense is on average
  bestDefenseVs: Record<string, string>; // attacker pick -> best defensive answer
  countersExist: boolean; // the best defensive answer varies by attacker pick
  dominantDefense: string | null; // a defense that's the best answer to everything
};

export function runStructure(
  seeds: number,
  mapName: MapDefinition['name'],
): StructureResult {
  const matrix = runStrategyMatrix(seeds, mapName, false);
  const defStrats = ['Hold', 'Stack', 'Pressure'];
  const atkStrats = ['Execute', 'Rush', 'Control'];

  const cell = (d: string, a: string) => matrix[`${d} vs ${a}`].defenderWinPct;
  const values: number[] = [];
  for (const d of defStrats) for (const a of atkStrats) values.push(cell(d, a));

  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;

  const defRowMeans: Record<string, number> = {};
  for (const d of defStrats) {
    defRowMeans[d] = round1(atkStrats.reduce((s, a) => s + cell(d, a), 0) / atkStrats.length);
  }
  const atkColMeans: Record<string, number> = {};
  for (const a of atkStrats) {
    // Attacker is "good" when defender win% is LOW, so report defender win%.
    atkColMeans[a] = round1(defStrats.reduce((s, d) => s + cell(d, a), 0) / defStrats.length);
  }

  // For each attacker pick, which defense holds best (max defender win%)?
  const bestDefenseVs: Record<string, string> = {};
  for (const a of atkStrats) {
    let best = defStrats[0];
    for (const d of defStrats) if (cell(d, a) > cell(best, a)) best = d;
    bestDefenseVs[a] = best;
  }
  const distinctAnswers = new Set(Object.values(bestDefenseVs));
  const countersExist = distinctAnswers.size > 1;
  const dominantDefense = countersExist ? null : [...distinctAnswers][0];

  return {
    spreadPp: round1(Math.max(...values) - Math.min(...values)),
    stdevPp: round1(Math.sqrt(variance)),
    defRowMeans,
    atkColMeans,
    bestDefenseVs,
    countersExist,
    dominantDefense,
  };
}

// ---- Signal 3: behavioral plausibility proxies -----------------------------

export type BehaviorResult = {
  rounds: number;
  avgTicks: number;
  timeoutPct: number;       // rounds ending with both teams alive (no elimination)
  participationPct: number; // avg fraction of the 10 units that fired >=1 shot
  minParticipationPct: number; // worst single round (catches parked units)
};

export function runBehavior(
  seeds: number,
  mapName: MapDefinition['name'],
): BehaviorResult {
  const matchups: [string, string][] = [
    ['Hold', 'Execute'], ['Stack', 'Rush'], ['Pressure', 'Control'],
  ];
  const s = Math.min(seeds, 12);
  let rounds = 0;
  let totalTicks = 0;
  let timeouts = 0;
  let partSum = 0;
  let minPart = 1;
  for (const [def, atk] of matchups) {
    for (let i = 0; i < s; i++) {
      const r = runStrategyRound(6000 + i, {
        defenderStrategy: def, attackerStrategy: atk, mapName,
      });
      rounds++;
      totalTicks += r.ticks;
      if (r.defAlive > 0 && r.atkAlive > 0) timeouts++;
      const shooters = new Set<string>();
      for (const e of r.events as readonly GameEvent[]) {
        if (e.type === 'shot') shooters.add(e.shooter);
      }
      const part = shooters.size / 10; // 5v5 = 10 units
      partSum += part;
      if (part < minPart) minPart = part;
    }
  }
  return {
    rounds,
    avgTicks: round1(totalTicks / rounds),
    timeoutPct: round1((timeouts / rounds) * 100),
    participationPct: round1((partSum / rounds) * 100),
    minParticipationPct: round1(minPart * 100),
  };
}

// ---- Full report -----------------------------------------------------------

export type AiQualityReport = {
  map: MapDefinition['name'];
  seeds: number;
  skillPays: SkillPaysRow[];
  structure: StructureResult;
  behavior: BehaviorResult;
};

export function runAiQuality(
  seeds = 20,
  mapName: MapDefinition['name'] = 'Foundryv2',
): AiQualityReport {
  return {
    map: mapName,
    seeds,
    skillPays: runSkillPays(seeds, mapName),
    structure: runStructure(seeds, mapName),
    behavior: runBehavior(seeds, mapName),
  };
}

// Glanceable text summary — used by the headless runner and the __sim hook.
export function formatAiQuality(r: AiQualityReport): string {
  const L: string[] = [];
  L.push(`=== AI quality on ${r.map} (${r.seeds} seeds/cell, std 4R/1S, no unlocks) ===`);
  L.push('');
  L.push('[1] SKILL PAYS  (gap = defWin% when DEF has the edge minus when ATK does)');
  for (const s of r.skillPays) {
    const flag = s.paysOff ? (s.monotone ? 'OK' : 'OK*non-monotone') : 'INERT';
    L.push(`    ${s.group.padEnd(14)} mild ${fmt(s.gapMildPp)}  strong ${fmt(s.gapStrongPp)}   ${flag}`);
  }
  L.push('');
  L.push('[2] STRUCTURE  (3x3 baseline matrix, defender win%)');
  L.push(`    spread ${r.structure.spreadPp}pp  stdev ${r.structure.stdevPp}pp`);
  L.push(`    counters exist: ${r.structure.countersExist}` +
    (r.structure.dominantDefense ? `  (DOMINANT defense: ${r.structure.dominantDefense})` : ''));
  L.push(`    best defense vs each attack: ${Object.entries(r.structure.bestDefenseVs).map(([a, d]) => `${a}->${d}`).join('  ')}`);
  L.push(`    defense row means: ${Object.entries(r.structure.defRowMeans).map(([d, v]) => `${d} ${v}`).join('  ')}`);
  L.push('');
  L.push('[3] BEHAVIOR  (automatable proxies; real check is a browser watch)');
  L.push(`    avgTicks ${r.behavior.avgTicks}  timeout ${r.behavior.timeoutPct}%  ` +
    `participation ${r.behavior.participationPct}% (worst round ${r.behavior.minParticipationPct}%)`);
  return L.join('\n');
}

function fmt(pp: number): string {
  const s = pp >= 0 ? `+${pp}` : `${pp}`;
  return s.padStart(6);
}
