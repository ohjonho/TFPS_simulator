// Map A — "Long Sightlines" (spec §4.4). 20 cols × 30 rows.
// Defender-favored: dense pre-positioned cover near the defender spawn,
// long open mid for sniper/rifle sightlines, moderate cover near attacker spawn.
// Side columns (0–1, 18–19) stay open through mid to provide the spec's
// "12+ hex open crossing per side approach" lane.
//
// Symbols: . open, # full wall, = half wall, D defender spawn, A attacker spawn.
// Spaces between symbols are ignored by the loader (purely visual).

export const MAP_A: readonly string[] = [
  // 0
  '. . . . . . . . D D D D . . . . . . . .',
  // 1
  '. . . . . . . . . . . . . . . . . . . .',
  // 2  cover band, dense full-wall edges
  '# # # = = . . . . . . . . . = = # # # #',
  // 3
  '. . . . . . . . . . . . . . . . . . . .',
  // 4
  '. . . . . . . . . . . . . . . . . . . .',
  // 5  cover diamond top
  '. . = = . . . . . . . . . . . . = = . .',
  // 6  central wall block
  '. . . . . . . . . # # # . . . . . . . .',
  // 7
  '. . . . . . . . . # # # . . . . . . . .',
  // 8
  '. . . . . . . . . # # # . . . . . . . .',
  // 9  cover diamond bottom
  '. . = = . . . . . . . . . . . . = = . .',
  // 10 long open mid — start
  '. . . . . . . . . . . . . . . . . . . .',
  // 11
  '. . . . . . . . . . . . . . . . . . . .',
  // 12
  '. . . . . . . . . . . . . . . . . . . .',
  // 13 sparse mid cover (defender-side)
  '. . . . . . = = . . . . = = . . . . . .',
  // 14
  '. . . . . . . . . . . . . . . . . . . .',
  // 15
  '. . . . . . . . . . . . . . . . . . . .',
  // 16
  '. . . . . . . . . . . . . . . . . . . .',
  // 17 sparse mid cover (attacker-side)
  '. . . . . . = = . . . . = = . . . . . .',
  // 18
  '. . . . . . . . . . . . . . . . . . . .',
  // 19
  '. . . . . . . . . . . . . . . . . . . .',
  // 20 cover diamond top (attacker-side feature)
  '. . = = . . . . . . . . . . . . = = . .',
  // 21 second central wall block
  '. . . . . . . . . # # # . . . . . . . .',
  // 22
  '. . . . . . . . . # # # . . . . . . . .',
  // 23
  '. . . . . . . . . # # # . . . . . . . .',
  // 24 cover diamond bottom
  '. . = = . . . . . . . . . . . . = = . .',
  // 25
  '. . . . . . . . . . . . . . . . . . . .',
  // 26
  '. . . . . . . . . . . . . . . . . . . .',
  // 27 cover band near attacker spawn
  '# # # = = . . . . . . . . . = = # # # #',
  // 28
  '. . . . . . . . . . . . . . . . . . . .',
  // 29
  '. . . . . . . . A A A A . . . . . . . .',
];
