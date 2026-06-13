/**
 * src/maps/foundryv4.ts — Foundry IV (5v5), authored in the hex map editor as a
 * ground-up "abandoned factory": large, spread-out sites broken up by building
 * pillars (#) and collapsed-rubble cover (o) near pillars / in site corners.
 * Defender spawn is the old management office (top-left). Diagonal layout: A site
 * top-right, B site bottom-left; defenders top-left, attackers bottom-right.
 *
 * v4.1: reshaped Site B for retake-ability (fixed Execute@B). v4.2: tightened the
 * B approach (narrowed b_main 39->33, b_main_near 14->8 + more walls/cover around
 * B) to slow the Rush flood that v4.1's wider lanes had sped up.
 *
 * Richer vocabulary (sub-zones fold into their coarse parent in gridUtils).
 *   # wall · . open · o cover · D def-spawn · X atk-spawn
 *   A/a a_site / a_plant · e/h a_entry 1/2 · n/j a_anchor 1/2 · f/g a_off 1/2
 *   B/b b_site / b_plant · E/H b_entry 1/2 · N/J b_anchor 1/2 · F/G b_off 1/2
 *   3 a_main_near / 4 a_main_far · 5 b_main_near / 6 b_main_far
 *   M mid (l left / r right / k choke / p off-angle / v anchor)
 *   c a_choke · C b_choke · 7 a_connector · 8 b_connector · y a_lurk · Y b_lurk
 */
import type { MapDefinition } from './types';
import { mapFromCharGrid } from './gridUtils';

const ROWS: string[] = [
  '####..............ooAAAAAAAooo', // 0
  '###..........o...AAAAAAAffAooo', // 1
  '###............##AnAA#AA#oAAoo', // 2
  '##...#o##o##..##AnoAaaaaaAAAo#', // 3
  '##...DDDDDD#..##Ajo#aaoaaaoAA#', // 4
  '#...DDDDDDo..##AAAAAaaaaaoAA##', // 5
  '#...DDDDDD#..##7AAAAAoAA#AAA##', // 6
  '#...DDDDDo..##777oAAAAAAAAAe33', // 7
  '#...#o##o#..##777oooAAoggo#e33', // 8
  '...........##777####hh#####o33', // 9
  '.o...........777#####yyyy###33', // 10
  '..........pp777######yyyy##333', // 11
  '#..#####..#o777########oyy##33', // 12
  '..#####.v#.777########yyy##o..', // 13
  '..#####.vo...7########yyy###cc', // 14
  '..#####...o..########yy####ccc', // 15
  '...ooooo..oo..#######yy#####cc', // 16
  '...ooooo.....k#######yy####o..', // 17
  '....ooooo888.kkk###rrr..444444', // 18
  '..######888##kkMMrrrrr.4444444', // 19
  '..######888##kkMMMrro##44444o4', // 20
  '..#####888###MM###rr###44o444#', // 21
  '..#####888###MMo##orr###..o###', // 22
  '..####888####MM###Mrr###.....#', // 23
  '...###888#####llllll..###...o.', // 24
  'BBBBBBBBBB####llllll..###o...#', // 25
  'BBNNBBBBBFB###YY#####..###...#', // 26
  'BJ#oBBB#oFB##YY######..##...XX', // 27
  'BJo#BBBo#oB##YY#######......XX', // 28
  'BBBbbbbBBB###YY#######..oo.XXX', // 29
  'BBBbbobbBBBH.#Y########..o..XX', // 30
  'BGGbbbbBBBBH.YY#######......XX', // 31
  'ooo#BBB##oo#..o#######..ooo..#', // 32
  'o###BBo##oo#CC#######..oooo###', // 33
  '###ooBBoo##o#CC.66###..#######', // 34
  'oooooBBoooo#CC.66o#o..########', // 35
  '#####EE#####..o6666666########', // 36
  '####55o###o..#6666666#########', // 37
  '#####555.....#6666666#########', // 38
  '#####555....##################', // 39
];

const parsed = mapFromCharGrid(ROWS);

export const foundryv4: MapDefinition = {
  name: 'Foundryv4',
  width: 30,
  height: 40,
  grid: parsed.grid,
  regions: parsed.regions,
  sites: parsed.sites,
  spawns: parsed.spawns,
  character: 'open_sightlines',
  // Large/spread layout → defenders start nearer their holds to cut the long
  // exposed approach. Measured +8pp def on v4.0; kept on through the reshapes.
  optimizeSpawns: true,
  // Large sites → a collapsing defender picks the best covered cell of the
  // contacted site instead of piling on the centroid (trace-verified: spread
  // setups win retakes the centroid pile lost; +14pp def floor, 7/20 paired
  // seeds flipped atk->def, 0 reverse). Tight maps keep this OFF — there the
  // centroid is the contesting spot.
  threatTargeting: true,
};
