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
 * v4 (2026-06-03): full geometry rework, replacing the region-skeleton. Two
 * corner sites (A left / B right) each with anchor + off-angle holds and DUAL
 * pre-aimed entries — the main approach labelled a_main_near and the flank
 * doorway a_entry, so two defenders watch two angles. Central mid spine + lower
 * courtyard, flank mains, cover spread in. Measured ~38% def win (skeleton ~31%)
 * at det=30; anchor-to-anchor rotation pulled in to 23 hexes.
 */
import type { MapDefinition } from './types';
import { mapFromCharGrid } from './gridUtils';

const ROWS: string[] = [
  '#########DDDDDDDDDDDDD########', // 0
  '########DDDDDDDDDDDDDD########', // 1
  '#######..DDDDDDDDDDDDD....####', // 2
  '######...DDDDDDDDDDDD.....####', // 3
  '##.......#######...####....###', // 4
  '#.......########..#####.....##', // 5
  '#......#########...#####.....#', // 6
  '...############...#######....#', // 7
  '#...##########....########....', // 8
  '...###########..##########....', // 9
  '#...##########...##########...', // 10
  '..o###.7777777...#########o...', // 11
  'AAAAAAAnn77777....8888888##...', // 12
  'AAAA#nno#777..##..888888BNNBBB', // 13
  'AAAAa#Agg###oll#rro8888#BBNNFF', // 14
  'AAAaaagg####lllrrr######BBo#FF', // 15
  'ff#aaaA#####llooorrr####BBBBoB', // 16
  'ffAAAAAe...llo##oorr####B#bbbB', // 17
  '##oAA#AAe..llo###orr####BBBbbb', // 18
  '#3333####ollo####orr...EBBbbbB', // 19
  '#333#######llo###orr...EB#BBBB', // 20
  '333#######lloo##orro####G#BBBB', // 21
  '#333#######lllo#orr#####GGBoBB', // 22
  '#333########lloorr#########555', // 23
  '#333o########llorr#########555', // 24
  '#ccc44#######kkkk##...####o555', // 25
  '##ccc44#....##kkk##.....CCC555', // 26
  '#####444.....k##k...#..CCC555#', // 27
  '######444##..MMMMM..###CCo####', // 28
  '######444####MMMM#####666#####', // 29
  '#######444####MMM#####666#####', // 30
  '#######44####MMM######666#####', // 31
  '#######444###MMM#######666####', // 32
  '######444####MM########666####', // 33
  '#######444###MMMM#######666###', // 34
  '######...#####MMM#######666###', // 35
  '######...#####MMM#######.66###', // 36
  '#####...####XXXXXX........####', // 37
  '#####........XXXXX........####', // 38
  '#####.......XXXXXX.###########', // 39
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
