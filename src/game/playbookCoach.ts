// Assistant Coach (Part 5 B1b) — turns a play's MEASURED matchup (defender-win%
// per opponent, from measureMatchups, run in a background worker) into a
// QUALITATIVE read for the manager. Deliberately number-free: the precise
// percentages are reserved for the AI / counter-web (B2), while the player gets
// a viability verdict + character + one improvement nudge — same "read under
// uncertainty" philosophy as the Scout's qualitative leans, so showing it never
// collapses the round-to-round pick into "deploy the highest number". Pure logic.

import type { Strategy } from './strategies.ts';

export type CoachVerdict = 'trap' | 'shaky' | 'viable' | 'strong';
export type CoachRead = {
  verdict: CoachVerdict;
  headline: string;   // coach voice, the bottom line
  character: string;  // what it beats / what beats it (no numbers)
  advice: string;     // one directional nudge tied to its softest matchup
};

// Built-in strategy id → short archetype phrase (what the opponent *does*), so
// the read talks in tactical character, not strategy names. Unknown ids fall
// back to a prettified id.
const ARCHETYPE: Record<string, string> = {
  Rush: 'fast aggression',
  Execute: 'structured executes',
  Control: 'methodical map control',
  Mind_Games: 'fakes and misdirection',
  Hold: 'balanced holds',
  Stack: 'site stacks',
  Pressure: 'mid pressure',
  Coordinated_Lockdown: 'hard site lockdowns',
  Rotate_Stack: 'rotations',
  Mid_Control: 'central control',
};
function archetype(id: string): string {
  return ARCHETYPE[id] ?? id.replace(/_/g, ' ');
}

// One directional improvement nudge for the play's softest matchup. Honest and
// modest — a hint, not a guarantee.
const COUNTER_TIP: Record<string, string> = {
  Rush: 'against fast pushes, a tighter forward hold or an extra entry-watcher buys time.',
  Execute: 'against structured hits, keep a rotator free to reinforce the struck site.',
  Control: 'against slow map control, contest space earlier — push an anchor toward mid.',
  Mind_Games: "against fakes, hold your read longer — don't over-rotate on first contact.",
  Hold: 'against balanced holds, vary your entry so you are not walking the same angle.',
  Stack: 'against stacks, split your angles so a committed site cannot trade up.',
  Pressure: 'against mid pressure, deny the choke with a crossfire.',
  Coordinated_Lockdown: 'against a hard lockdown, hit the other site or bait the lock.',
  Rotate_Stack: 'against rotations, hit fast before they settle.',
  Mid_Control: 'against central control, pressure a flank to pull the garrison.',
};

// Qualitative band for the play's win% in a single matchup.
function band(win: number): 'dominates' | 'beats' | 'trades evenly with' | 'is behind' | 'loses to' {
  if (win >= 62) return 'dominates';
  if (win >= 53) return 'beats';
  if (win >= 47) return 'trades evenly with';
  if (win >= 38) return 'is behind';
  return 'loses to';
}

// Translate a measured matchup into the coach's read. `matchups` is
// defender-win% per opponent id; normalize to the PLAY's win% by side.
export function coachRead(play: Strategy, matchups: Record<string, number>): CoachRead | null {
  const ids = Object.keys(matchups);
  if (ids.length === 0) return null;
  const winOf = (id: string): number =>
    play.side === 'defender' ? matchups[id] : 100 - matchups[id];

  const entries = ids.map((id) => ({ id, win: winOf(id) })).sort((a, b) => b.win - a.win);
  const best = entries[0];
  const worst = entries[entries.length - 1];
  const avg = entries.reduce((s, e) => s + e.win, 0) / entries.length;

  let verdict: CoachVerdict;
  let headline: string;
  if (avg < 42 && best.win < 50) {
    verdict = 'trap';
    headline = "I can't get behind this one yet — it's losing more matchups than it wins.";
  } else if (avg >= 62 && worst.win >= 48) {
    verdict = 'strong';
    headline = 'Strong almost everywhere — so strong the real edge will be when you deploy it, not the play itself.';
  } else if (worst.win < 38) {
    verdict = 'shaky';
    headline = 'A real weapon with one clear hole — deploy it when that hole is unlikely.';
  } else {
    verdict = 'viable';
    headline = 'A solid, situational call — good in the right matchup.';
  }

  const character = best.id === worst.id
    ? `${cap(band(best.win))} ${archetype(best.id)}.`
    : `Best against ${archetype(best.id)}; ${band(worst.win)} ${archetype(worst.id)}.`;

  const tip = COUNTER_TIP[worst.id] ?? `consider retargeting a slot toward where ${archetype(worst.id)} tends to play.`;
  const advice = worst.win < 50 ? `To shore up: ${tip}` : 'No glaring weakness to patch — pick your spots.';

  return { verdict, headline, character, advice };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
