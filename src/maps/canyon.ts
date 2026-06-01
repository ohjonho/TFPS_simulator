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

const ROWS: readonly string[] = [
  '##############################', // 0
  '###########DDDDDDDDDDD########', // 1
  '###########DDDDDDDDDDDD#######', // 2
  '#####.....DDDDDDDDDDDDD....###', // 3
  '######....DDDDDDDDDDDDDD....##', // 4
  '######.....#lll###rr###.....##', // 5
  '#######....#lll###rr####.....#', // 6
  '#######...##llllrrr#####.....#', // 7
  '#######...###lllrrr#####..#...', // 8
  '####nnnn77##llllrr#####..###..', // 9
  '####noong7777lllrr#####888##NG', // 10
  '###AaaaA#7777lllrr888#88FN#NNo', // 11
  '###Aa#aaA#####llrrr88888#NNNNN', // 12
  '##faaa#aA#####lrrr#8888#BbbbBo', // 13
  '###oaaaaAA####kk#####88#Bbb#bB', // 14
  '###eee#eee###kk######88Bbb#bB#', // 15
  '###ccc##....#kk#######88BbbbbB', // 16
  '#cccc###...##kk#########EEEEE#', // 17
  '#ccc######.lllrr####.######CCC', // 18
  'cc########llllrrr#r...#55##CC#', // 19
  '33#########ll##rrrr....5555CC#', // 20
  '33########ll####rrr##.55555C##', // 21
  '333########ll###rrr###.55#####', // 22
  '333#######ll###rr######55#####', // 23
  '##334..####ll##rr#######555###', // 24
  '#444...####lllrrr.######55555#', // 25
  '#444##...###llrrr..######55555', // 26
  '444###..lllllr###..########666', // 27
  '444#####lllllr####..#######666', // 28
  '444#####lllllr####..#######66#', // 29
  '#4444####lllllr####..######666', // 30
  '##444####lllllr####666666#666#', // 31
  '###444#####lllrrr##6666666666#', // 32
  '###444#####lllrr##66###66666##', // 33
  '####444####lllrr##66###66666##', // 34
  '####4444..llllr....6666666####', // 35
  '######44XXXXXXXXXXXX666666####', // 36
  '#######XXXXXXXXXXXXX6666######', // 37
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
