/**
 * src/maps/atoll_v2.ts — Atoll_v2 (5v5), authored with the hex map editor
 * (src/editor) by tracing a reference drawing onto the 30×40 grid.
 *
 * Richer vocabulary (sub-zones fold into their coarse parent in gridUtils).
 *   # wall · . open · o cover · D def-spawn · X atk-spawn
 *   A/a a_site / a_plant · e a_entry · n a_anchor · f a_off · g a_off2
 *   B/b b_site / b_plant · E b_entry · N b_anchor · F b_off · G b_off2
 *   1 a_main (3 near / 4 far) · 2 b_main (5 near / 6 far)
 *   M mid (l left / r right / k mid_choke) · c a_choke · C b_choke
 *   7 a_connector · 8 b_connector
 *
 * Skeleton pass — regions placed, no cover (o) yet.
 */
import type { MapDefinition } from './types';
import { mapFromCharGrid } from './gridUtils';

const ROWS: string[] = [
  'DDDDDDDDDDDDDDDDDD...#########', // 0
  'DDDDDDDDDDDDDDDDD....#########', // 1
  'DDDDDDDDDDDDDDD#####..########', // 2
  'DDDD#DDDD##DDD######.....#####', // 3
  '#DDD#DDDD.###########....NNN##', // 4
  'DDDDDD#....##########....NNNNN', // 5
  '#DDDD###....##########...##NNN', // 6
  '#..######...#########NNN###BoB', // 7
  '#..#######...######..#NNBBBBbb', // 8
  '#..#######...####..88NNNoBBbbb', // 9
  '##....#####...###.8888NNBBBBbb', // 10
  '##....####....##.8888##BB##BoB', // 11
  '###....####......888###FFF#BBG', // 12
  '##..............888####FFFBBBG', // 13
  '##nn...7777777MMM88######FF#BG', // 14
  '##nn##7777777MM#rr#########EEE', // 15
  '###nnnnnn#ll##MM#rr########5o5', // 16
  '###nnnngg#ll#MM##rr######55555', // 17
  '###nnn#Agg#ll#MM##rr#####55555', // 18
  '###AoA#AA#ll##MM#rr######CC###', // 19
  '##ffAAA#AAell#MM#rr######CCC##', // 20
  '#ffAAA#aaAell#MM#rr######CCC##', // 21
  '##ffoA#aaa##ll#M##rr######CCC6', // 22
  '###AAAAaaa#ll#MM#rr########666', // 23
  '#33eeAAA###ll#MM#rr#....####66', // 24
  '33o3e######ll#M#rr#.....66666#', // 25
  '3333########kkkkkk#...#.o6666#', // 26
  '33##########kkkkkk...##666####', // 27
  '333############kkkk#####66666#', // 28
  '333cc#####...##k##kr####66666#', // 29
  '#33ccc####....#lllrrr######666', // 30
  '###cc####..#...lllor#######666', // 31
  '###cc...#..##...#llrr#######66', // 32
  '##44o.....#######llrr#######66', // 33
  '###444#...########lorr######66', // 34
  '###444############llrrr####66X', // 35
  '####444############lllrr####XX', // 36
  '####444444444444###lolrr#XXXXX', // 37
  '#####4o44o44444444444llrXXXXXX', // 38
  '#####44444444444444444XXXXXXXX', // 39
];

const parsed = mapFromCharGrid(ROWS);

export const atoll_v2: MapDefinition = {
  name: 'Atoll_v2',
  width: 30,
  height: 40,
  grid: parsed.grid,
  regions: parsed.regions,
  sites: parsed.sites,
  spawns: parsed.spawns,
  character: 'tight_corridors_asymmetric',
};
