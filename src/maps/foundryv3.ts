/**
 * src/maps/foundryv3.ts — Foundry III (5v5), authored in the hex map editor.
 * A separate map (does not replace Foundryv2) for evaluation. v3.2 iteration.
 *
 * Same char vocabulary as the other v2/v3 maps (folds to coarse parents in
 * gridUtils):
 *   # wall · . open · o cover · D def-spawn · X atk-spawn
 *   A/a a_site / a_plant · e a_entry · n a_anchor · f a_off · g a_off2
 *   B/b b_site / b_plant · E b_entry · N b_anchor · F b_off · G b_off2
 *   3 a_main (near) / 4 a_main (far) · 5 b_main (near) / 6 b_main (far)
 *   l/r mid (k mid_choke) · c a_choke · C b_choke · 7 a_connector · 8 b_connector
 */
import type { MapDefinition } from './types';
import { mapFromCharGrid } from './gridUtils';

const ROWS: readonly string[] = [
  '#######DDDDDDDDDDDDDDDD#######', // 0
  '######DDDDDDDDDDDDDDDDDD######', // 1
  '######DDDDDDDDDDDDDDDDDDDD####', // 2
  '#####DDD######...#####DDDD####', // 3
  '#####...######...######....###', // 4
  '####...#######...######...####', // 5
  '####...########...######..####', // 6
  '###...########...######..#####', // 7
  '#AA.....######....#####..#####', // 8
  'ggAAAnnn777777...8####..######', // 9
  'Agoaao#nn777777..88###...#####', // 10
  'A#aaa#AA77777o#..8888....#####', // 11
  'A#aaaoAA###77#...#8888BBBBBBB#', // 12
  'AAaaa#AA7777#...##8o#BNNNBBBFF', // 13
  'AAAaaaAAA777o...###88BB#Bo###F', // 14
  'AA#AA#ff####...#####8GGbbobboF', // 15
  '333#eeff####..#o#####Bo#bbbbbB', // 16
  '3o#..#######...######BBBBBBBBB', // 17
  '333#..#######...######BBB#BBBB', // 18
  '333.cccc#####...####EEE###5555', // 19
  '#33..ccc.#####.kk###..o####o55', // 20
  '#....#c..#####kkk##...#####555', // 21
  '#######..#####kkkk#rr.#####..5', // 22
  '###.....#####.kkk.rrr#####..##', // 23
  '###.#...#####..##.orr#####...#', // 24
  '###....#####ooo##rrr###.CC#..#', // 25
  '###........llll###rr###..CCC.#', // 26
  '##..#......lllll#rr###..#CCC##', // 27
  '##44444######lll..r####..CCC##', // 28
  '#4#4#4#########...#####.CC..##', // 29
  '##4444#########..........#...#', // 30
  '#4#4#4########..........##666#', // 31
  '##4444########...##########666', // 32
  '#4#4#4#######...###########666', // 33
  '##4444#######...############66', // 34
  '#4#4#4#######...###########666', // 35
  '##4444########...##########.66', // 36
  '#.#.........XXXXXX...........#', // 37
  '##..........XXXXXXX..........#', // 38
  '##..........XXXXXX..........##', // 39
];

const parsed = mapFromCharGrid(ROWS);

export const foundryv3: MapDefinition = {
  name: 'Foundryv3',
  width: 30,
  height: 40,
  grid: parsed.grid,
  regions: parsed.regions,
  sites: parsed.sites,
  spawns: parsed.spawns,
  character: 'open_sightlines',
};
