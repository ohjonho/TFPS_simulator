/**
 * src/maps/foundryv2.ts — Foundryv2 (5v5), authored with the hex map editor
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
  '#######DDDDDDDDDDDDDDDD#######', // 0
  '###DDDDDDDDDDDDDDDDDDDDDDD####', // 1
  '###DDDDDDDDDDDDDDDDDDDDDDDD###', // 2
  '###DDDDDD#####...###DDDDDD####', // 3
  '###.....######....#####....###', // 4
  '##.....#######...######....###', // 5
  '##.....#######....######....##', // 6
  '#.....########...#######....##', // 7
  '#.....########....#######....#', // 8
  'nnnnnnnn777777...88######....#', // 9
  'n#naan#nn777777..888######....', // 10
  'g#aaa#AA######...8888#####....', // 11
  'g#aaa#AA######...#8888NNNNN...', // 12
  'g#aaa#AA#####...##88NNNNNNNNFF', // 13
  'gg#aaa#ff####...####8GGBBB###F', // 14
  'AAAAAAff####...######GGbbbbbbF', // 15
  'eeee##ff####...#########bbbbbB', // 16
  '333#########...######BBBBBBBBB', // 17
  '3333#########...#####BBB##BBBB', // 18
  '3333ccc######...####EEE###EEEE', // 19
  '#3333ccc######...###rrr####555', // 20
  '#333#ccc######kkk##rrr#####555', // 21
  '#####ccc######kkkk#rrr#####555', // 22
  '###444#######kkkkkrrr####5555#', // 23
  '###4444######oo##krrr###CCC5##', // 24
  '###4444#####ooo##rrr###CCC####', // 25
  '###4444llllllMM###rr####CCC###', // 26
  '##4444lllllllMM##rr######666##', // 27
  '###4444######MMMMMr#######666#', // 28
  '###444#######MMMMM########666#', // 29
  '###444#######MMMMM#########666', // 30
  '###444######MMMMMM#########666', // 31
  '###444#######MMMMM#########666', // 32
  '###444#######MMMMM########666#', // 33
  '###444#######MMMMM########666#', // 34
  '###444#######MMMMM#######666##', // 35
  '###444#######MMMMM#######666##', // 36
  '###444444444XXXXXX666666666###', // 37
  '###444444444XXXXXXX66666666###', // 38
  '###444444444XXXXXX666666666###', // 39
];

const parsed = mapFromCharGrid(ROWS);

export const foundryv2: MapDefinition = {
  name: 'Foundryv2',
  width: 30,
  height: 40,
  grid: parsed.grid,
  regions: parsed.regions,
  sites: parsed.sites,
  spawns: parsed.spawns,
  character: 'open_sightlines',
};
