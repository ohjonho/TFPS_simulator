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

// v4 (2026-06-08, user reshape "Canyon_v3"): clearer choke/entry/main sub-region
// labelling; reshaped both sites + their entry points to fix Site B's 0% retake
// (the old B was a one-way corner pocket). Diagnostic-driven (Pass 5).
const ROWS: readonly string[] = [
  '##############################', // 0
  '###########DDDDDDDDDDD########', // 1
  '###########DDDDDDDDDDDD#######', // 2
  '###.......DDDDDDDDDDDDD....###', // 3
  '###.......DDDDDDDDDDDDDD....##', // 4
  '##..##.....#...###..###.....##', // 5
  '##..###....#...###..####.....#', // 6
  '#..####...##.......#####.....#', // 7
  '##..AAAn..###......#####..#BBB', // 8
  '##.ggAnn77####....#####.N##oBB', // 9
  '###Ag##AA77777...######8NNNBBG', // 10
  '###AaaaA#77777...8888#88NNoBGG', // 11
  '##fAaaaaA#7##o....888888#BbbBo', // 12
  '#ffa#a#aA7####..o##88888BbbbBB', // 13
  '###oAAAAAo####kk#####88#FbbbbB', // 14
  '###333#eee###kk######88FF###B#', // 15
  '###333##....#kk#######88BBBBBB', // 16
  '#3333###...o#kk########EE#555#', // 17
  '#...#####o...kkk########..#o55', // 18
  'cco#######ll.....#...##..##55#', // 19
  'cco########ll##.rrr...#CC##55#', // 20
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
};
