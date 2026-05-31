// Parse pasted text into a row list for mapFromCharGrid. Tolerant of the three
// shapes a user is likely to paste:
//   1. canyon.ts SEGMENTS  — one physical line per row, three quoted 10-char
//      segments per line: ['##########', '##########', '##########'], // 0
//   2. a flat string[]     — one quoted 30-char row per line: '....',
//   3. raw text            — 40 bare lines of 30 legend chars, no quotes.
// Per line we concatenate every quoted substring; lines with no quotes are kept
// only when they're exactly COLS legend chars. Everything else (the `const … =`
// wrapper, `];`, comment-only lines) yields nothing and is dropped. Shape and
// char validity are NOT checked here — mapFromCharGrid does that with precise
// errors.

import { COLS } from '../maps/gridUtils.ts';
import { isLegendChar } from './legend.ts';

const QUOTED = /'([^']*)'|"([^"]*)"/g;

function allLegendChars(s: string): boolean {
  for (const ch of s) {
    if (!isLegendChar(ch)) return false;
  }
  return s.length > 0;
}

/** Best-effort extraction of map rows from pasted source/text. */
export function parsePastedGrid(text: string): string[] {
  const rows: string[] = [];
  for (const rawLine of text.split('\n')) {
    let row = '';
    let m: RegExpExecArray | null;
    QUOTED.lastIndex = 0;
    while ((m = QUOTED.exec(rawLine)) !== null) {
      row += m[1] ?? m[2] ?? '';
    }
    if (row.length > 0) {
      rows.push(row);
      continue;
    }
    // No quotes on this line: accept it only if it reads as a bare map row.
    const bare = rawLine.trim();
    if (bare.length === COLS && allLegendChars(bare)) rows.push(bare);
  }
  return rows;
}
