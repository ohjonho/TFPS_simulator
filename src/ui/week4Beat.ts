// Week-4 pre-training story beat — a personal check-in with Sam over coffee. A
// conversation hub lets the player ask about the team's progress (contextual on
// the record so far) and/or the shop's situation, in any order. Then Sam reminds
// them of the round-robin format + the week-5 bye and asks what they want to do
// with it — recording a SOFT off-week leaning (offWeekLean) that the week-5 break
// beat will confirm. Payoff is narrative for now (no stat effects here).

import type { Unit } from '../game/types.ts';
import { playStory, type StoryBeat, type StoryFlags, type StoryLine } from './storyScene.ts';
import { pickNotable } from './squadFlavor.ts';

export type OffWeekLean = 'train' | 'morale' | 'balance' | 'undecided';

// A Sam aside about a player, flavoured by personality (prefers the quieter types
// so it tends to spotlight a different player than the post-match beat does).
function playerAside(roster: readonly Unit[]): StoryLine | null {
  const u = pickNotable(roster, ['Analyst', 'Stabilizer', 'Catalyst', 'Firebrand']);
  if (!u) return null;
  const n = u.name;
  const text =
    u.personality === 'Analyst' ? `Oh — and ${n} basically lives in the VODs now. Out-nerding even you, and that's saying something.`
    : u.personality === 'Stabilizer' ? `${n}'s the calmest person I've ever met. Almost annoyingly so. Glue of that locker room, though.`
    : u.personality === 'Catalyst' ? `${n} keeps that group chat alive around the clock. Memes, hype, the lot — holds the room together.`
    : `${n}'s in here every single night, grinding aim till I kick them out at close.`;
  return { who: 'sam', text };
}

// Sam's read on the team, contextual on wins after the first three matches.
function progressLines(wins: number): StoryLine[] {
  if (wins >= 3) return [
    { who: 'sam', text: 'Honestly? Better than I let myself hope. Three from three — we\'re scrappy, but we\'re REAL.' },
    { who: 'sam', text: 'The reads are getting sharper every week. If we keep this up... I\'m not gonna jinx it.' },
  ];
  if (wins === 2) return [
    { who: 'sam', text: 'Good, mostly. Two from three — we\'ve clearly got the level. It\'s consistency that\'s the thing.' },
    { who: 'sam', text: 'When we\'re on, we\'re scary. We just can\'t afford the off nights.' },
  ];
  if (wins === 1) return [
    { who: 'sam', text: 'Mixed bag. One in three. We\'ve had flashes — real ones — but we\'ve let some slip too.' },
    { who: 'sam', text: 'I still see it, though. The pieces fit. We just need it to click.' },
  ];
  return [
    { who: 'sam', text: 'I won\'t sugarcoat it — rough start. Nothing on the board yet.' },
    { who: 'sam', text: 'But I still believe it. The talent\'s there. We sort out the rest, this turns around fast.' },
  ];
}

function buildBeats(wins: number, roster: readonly Unit[]): StoryBeat[] {
  const aside = playerAside(roster);
  return [
    { art: 'Pixel Perfect, a quiet afternoon — you at a monitor, replays scrubbing past', who: 'narrator', text: 'Week four. You\'re hunched over a monitor scrubbing replays when Sam drops into the chair beside you and slides over a coffee.' },
    { who: 'sam', text: 'Brought you one. You\'ve been living in those VODs.' },
    { who: 'you', text: 'Gotta know what\'s coming.' },
    { who: 'sam', text: 'Mm. How are YOU doing, though? Not the team — you.' },
    { who: 'you', text: 'Hanging in there. It\'s a lot... but it\'s the good kind of a lot.' },
    { who: 'sam', text: 'Good. Ask me whatever\'s on your mind — I\'ve got a minute.' },
    {
      art: 'You and Sam, talking over coffee',
      prompt: 'What do you want to talk about?',
      proceedLabel: 'Alright — let\'s get to work.',
      topics: [
        { label: 'How do you feel about the team?', lines: [...progressLines(wins), ...(aside ? [aside] : [])] },
        { label: 'What about the shop? The offer?', lines: [
          { who: 'sam', text: 'My folks are getting antsy. The developer won\'t wait forever — every week we say no, they\'re sure we\'re letting a sure thing walk.' },
          { who: 'sam', text: 'There\'s pressure. Sunday dinners are... tense. But I told them: give me the season.' },
          { who: 'sam', text: 'I believe in this. In us. So we wait, and we see.' },
        ] },
      ],
    },
    { who: 'sam', text: 'Before you bury yourself again — you remember the format, right? Nine teams, everyone plays everyone once.' },
    { who: 'sam', text: 'Which means week five, we\'re on a bye. A whole week. No match.' },
    { who: 'sam', text: 'So I\'ve gotta ask — what do you want to do with it? Been turning it over?' },
    {
      art: 'Sam, leaning back, genuinely curious',
      prompt: 'The off week — your instinct?',
      options: [
        { label: 'Hit the grind. Pure training, get sharper.', set: { offWeekLean: 'train' }, reply: [{ who: 'sam', text: 'The hard road. Risky on the vibe — but it works, if they can take it.' }] },
        { label: 'Pull back. Team-building, look after morale.', set: { offWeekLean: 'morale' }, reply: [{ who: 'sam', text: 'Take care of the people first. ...I really like that about you.' }] },
        { label: 'A bit of both — and fix up the shop while we\'re at it.', set: { offWeekLean: 'balance' }, reply: [{ who: 'sam', text: 'Split it. Sensible. ...And god knows the shop could use the love.' }] },
        { label: 'Not sure yet. I\'ll figure it out.', set: { offWeekLean: 'undecided' }, reply: [{ who: 'sam', text: 'Fair. You\'ve got till week five. Sleep on it.' }] },
      ],
    },
    { who: 'sam', text: 'Whatever you land on — it says something about the team we\'re building. Think on it.' },
    { art: 'You draining the last of the coffee', who: 'narrator', text: 'You drain the coffee. The screens are still glowing. Time to train.' },
  ];
}

export function showWeek4Beat(wins: number, roster: readonly Unit[], onDone: (lean: OffWeekLean) => void): void {
  playStory(buildBeats(wins, roster), (flags: StoryFlags) => onDone((flags.offWeekLean as OffWeekLean) ?? 'undecided'));
}
