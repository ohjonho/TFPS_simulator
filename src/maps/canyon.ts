/**
 * src/maps/canyon.ts — Canyon (5v5). Authored + hand-refined in the hex paint
 * editor and exported as a char grid through the char-grid pipeline
 * (mapFromCharGrid). Dense, winding, asymmetric: two pillar sites (A left,
 * B right), a long central mid spine, broad main lanes down each flank, and
 * rotational connectors linking the sites.
 *
 * Richer vocabulary (sub-zones fold into their coarse parent in gridUtils, so
 * a_site/a_main/mid still cover their full footprint).
 *   # wall · . open · o cover · D def-spawn · X atk-spawn
 *   A/a a_site / a_plant · e a_entry · n a_anchor · f a_off · g a_off2
 *   B/b b_site / b_plant · E b_entry · N b_anchor · F b_off · G b_off2
 *   1 a_main (3 near / 4 far) · 2 b_main (5 near / 6 far)
 *   M mid (l left / r right / k mid_choke)
 *   c a_choke · C b_choke · 7 a_connector · 8 b_connector
 */
import type { MapDefinition } from './types';
import { mapFromCharGrid } from './gridUtils';

// v3.1 (2026-06-08, user): follow-up to the v3 reshape — opened the B anchor /
// connector to pull Site B's overshoot (76% def when attacked) back toward ~50
// while keeping the B retake viable. Pass 5 diagnostic-driven.
const ROWS: readonly string[] = [
  '##############################', // 0
  '###########DDDDDDDDDDD########', // 1
  '###########DDDDDDDDDDDD#######', // 2
  '###.......DDDDDDDDDDDDD....###', // 3
  '###.......DDDDDDDDDDDDDD....##', // 4
  '##..##.....#...###..###.....##', // 5
  '##..###....#...###..####.....#', // 6
  '#..####...##.......#####.....#', // 7
  '##..AAAn..###......#####...BBB', // 8
  '##.ggAnn77####....#####..##oBB', // 9
  '###Ag##AA77777...######88NNBBG', // 10
  '###AaaaA#77777...8888#88#NoBGG', // 11
  '##fAaaaaA77##o....8888888Bbbbo', // 12
  '#ffa#aoaA7####..o##88888BbbbbB', // 13
  '###oAAAAA#####kk########FbbbbB', // 14
  '###333#ee####kk########FF#B#B#', // 15
  '###333##....#kk#########BBBBBB', // 16
  '##333###...o#kk########EE#5555', // 17
  '#...o####o...kkk########..#o55', // 18
  'ccc#######ll.....#...##..##55#', // 19
  'ccc########ll##.rrr...#CC##55#', // 20
  'cc########ll####rrro..CCCC..##', // 21
  '....#######ll###rrr##..CCC..##', // 22
  '...o######ll###rro#####CC#####', // 23
  '#o444..####ll##rr#######...###', // 24
  '#444...####....rr.######.....#', // 25
  '#444##...###.......######.....', // 26
  '444###..........#..########666', // 27
  '444#####.....oo..#..#######666', // 28
  '444#####........##..#######66#', // 29
  '#444.#####......###..######666', // 30
  '##...#####......###......#666#', // 31
  '###...#####......##.......666#', // 32
  '###...#####.....##..###..666##', // 33
  '####...####.....##..###...66##', // 34
  '####......................####', // 35
  '######..XXXXXXXXXXXX......####', // 36
  '#######XXXXXXXXXXXXX....######', // 37
  '#######XXXXXXXXXXXXXX#########', // 38
  '######XXXXXXXXXXXXXXX#########', // 39
];

const parsed = mapFromCharGrid(ROWS);

export const canyon: MapDefinition = {
  name: 'Canyon',
  width: 30,
  height: 40,
  grid: parsed.grid,
  regions: parsed.regions,
  sites: parsed.sites,
  spawns: parsed.spawns,
  character: 'tight_corridors_asymmetric',
  // Strategy-aware defender spawn optimization — measured +9pp def on Canyon's
  // dense layout (config.SPAWN_SPREAD note). Opt-in; other maps leave it off.
  optimizeSpawns: true,
  // Part 5 A1 — threat-aware initial hold positioning. Defenders start on the
  // best static cell of their slot region (low exposure + LoS to their watch
  // angle + cover) instead of the centroid, so the campaign map's holds read as
  // deliberate angles, not arbitrary centre-of-region spots. Distinct from
  // threatTargeting (left off — Canyon's tight sites want near-edge collapse).
  holdTargeting: true,
};
