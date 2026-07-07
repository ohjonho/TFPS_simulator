// Week-5 bye-week story beat — the mid-season break. The player LOCKS IN how the
// squad spends its only match-free week (anchored to the soft lean they gave Sam
// over coffee in week 4). The squad reacts to the call in character — flavoured by
// a standout player's personality, the team's morale, and the season record — and
// the choice lands as a real trade-off (applied + shown by the caller). Then the
// week rolls on to a "Special Training" bootcamp.

import type { Unit } from '../game/types.ts';
import type { MoraleMap } from '../game/morale.ts';
import type { OffWeekFocus } from '../game/offWeek.ts';
import { playStory, type StoryBeat, type StoryFlags, type StoryLine } from './storyScene.ts';
import { pickNotable } from './squadFlavor.ts';
import { teamMorale, moraleLabel } from '../game/morale.ts';

type P = 'Firebrand' | 'Catalyst' | 'Analyst' | 'Stabilizer';

// Which personality each focus tends to spotlight (so different calls put a
// different face forward) — pickNotable falls through this order.
const SPOTLIGHT: Record<OffWeekFocus, P[]> = {
  train: ['Firebrand', 'Analyst', 'Catalyst', 'Stabilizer'],
  morale: ['Catalyst', 'Stabilizer', 'Firebrand', 'Analyst'],
  balance: ['Stabilizer', 'Catalyst', 'Analyst', 'Firebrand'],
  undecided: ['Analyst', 'Firebrand', 'Stabilizer', 'Catalyst'],
};

// A standout player's in-character reaction to the locked-in call.
const REACTION: Record<OffWeekFocus, Record<P, string>> = {
  train: {
    Firebrand: 'Finally. Let\'s actually WORK. No excuses this week.',
    Catalyst: 'Grind week? Okay — but I\'m bringing snacks so nobody falls apart.',
    Analyst: 'Good. I\'ve had a list of drills ready for exactly this.',
    Stabilizer: 'Hard week. ...We can do hard. I\'ll keep everyone going.',
  },
  morale: {
    Firebrand: 'A team week? ...Fine. I guess we are kind of fried. Don\'t get soft on me.',
    Catalyst: 'YES. We needed this. I\'m planning the whole thing — trust me.',
    Analyst: 'Rest is a variable too. I\'ll allow it. ...Actually, I\'ll enjoy it.',
    Stabilizer: 'Thank you. Honestly. The room\'s been carrying a lot.',
  },
  balance: {
    Firebrand: 'Bit of both, huh. As long as the \'work\' part is real, I\'m in.',
    Catalyst: 'Work hard, hang out, fix the place up — that\'s us. Love it.',
    Analyst: 'A measured split. Sensible. I\'ll draw up the schedule.',
    Stabilizer: 'That feels right. A little of everything, no one left behind.',
  },
  undecided: {
    Firebrand: 'No plan? Come on. A free week and we just... drift? That\'s on you.',
    Catalyst: 'It\'s cool, it\'s cool — we\'ll figure it out as we go. Probably.',
    Analyst: 'Unstructured. ...I\'ll try not to let that bother me. It bothers me.',
    Stabilizer: 'No call\'s a call too, I suppose. We\'ll make our own out of it.',
  },
};

const persona = (u: Unit): P | null => (u.personality && u.personality in REACTION.train ? (u.personality as P) : null);

// The squad's collective read, tinted by morale + the season record so far.
function moodLine(morale: MoraleMap, roster: readonly Unit[], wins: number, played: number): StoryLine {
  const label = moraleLabel(teamMorale(morale, roster));
  const low = label === 'rattled' || label === 'shaky';
  const high = label === 'confident' || label === 'fired-up';
  const losses = played - wins;
  const recordPart =
    wins - losses >= 2 ? 'Riding a good run, there\'s real belief in this room.'
    : losses - wins >= 2 ? 'After a rough stretch, everyone\'s itching to turn it around.'
    : 'It\'s tight in the table — this week could be the one that tips it.';
  const moodPart =
    low ? 'The mood\'s been fragile lately, so the call matters more than usual. '
    : high ? 'Spirits are high, and they\'re behind you whatever you chose. '
    : 'The room\'s steady, ready to follow your lead. ';
  return { who: 'sam', text: moodPart + recordPart };
}

const LEAN_NAME: Record<string, string> = {
  train: 'hitting the grind', morale: 'looking after the squad',
  balance: 'a bit of both', undecided: 'still deciding',
};

function buildBeats(roster: readonly Unit[], morale: MoraleMap, wins: number, played: number, lean: string): StoryBeat[] {
  const leanKnown = lean in LEAN_NAME && lean !== 'undecided';
  const reactionFor = (focus: OffWeekFocus): StoryLine[] => {
    const u = pickNotable(roster, SPOTLIGHT[focus]);
    const lines: StoryLine[] = [];
    if (u) { const p = persona(u); if (p) lines.push({ who: 'player', speakerId: u.characterId, name: u.name, text: REACTION[focus][p] }); }
    lines.push(moodLine(morale, roster, wins, played));
    return lines;
  };
  const opt = (label: string, focus: OffWeekFocus) => ({
    label: label + (lean === focus && leanKnown ? '  (your instinct)' : ''),
    set: { offWeekFocus: focus },
    reply: reactionFor(focus),
  });
  return [
    { art: 'Pixel Perfect, mid-season — no match this week, the squad loose and waiting on you', who: 'narrator', text: 'The bye week. No match, no scoreboard — just seven days that are yours to shape. The squad drifts into the café, half-expecting you to have a plan.' },
    { who: 'sam', text: leanKnown
        ? `Big week. Back over coffee you were leaning toward ${LEAN_NAME[lean]} — still feeling that? It\'s your call to lock in now.`
        : 'Big week. A whole bye to use however you want — what\'s it going to be? Time to call it.' },
    {
      art: 'The squad gathered, watching you decide',
      prompt: 'Lock in how you spend the bye week:',
      options: [
        opt('Hit the grind — pure training.', 'train'),
        opt('Pull back — team-building and morale.', 'morale'),
        opt('A bit of both — and fix up the shop.', 'balance'),
        opt('Keep it loose — no fixed plan.', 'undecided'),
      ],
    },
    { who: 'sam', text: 'Locked in. Let\'s make the week count — special sessions start now.' },
  ];
}

export function showWeek5Break(
  roster: readonly Unit[], morale: MoraleMap, wins: number, played: number, lean: string,
  onDone: (focus: OffWeekFocus) => void,
): void {
  playStory(buildBeats(roster, morale, wins, played, lean), (flags: StoryFlags) => onDone((flags.offWeekFocus as OffWeekFocus) ?? 'undecided'));
}
