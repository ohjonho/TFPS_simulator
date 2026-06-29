// Post-match-1 story beat — Sam and the player reflect on the team's first match
// (tone branches on win/loss). Lands on the idea that they need to scout deeper
// and start drawing up their own plays — setting up the week-2 scout/playbook
// unlock. No choices; pure setup. Replaces the old post-match-1 free-upgrade pick.

import type { Unit } from '../game/types.ts';
import { playStory, type StoryBeat } from './storyScene.ts';
import { pickNotable } from './squadFlavor.ts';

// A Sam line about a notable player, flavoured by their personality + the result.
function squadFlavor(roster: readonly Unit[], won: boolean): StoryBeat | null {
  const u = pickNotable(roster, ['Firebrand', 'Catalyst', 'Stabilizer', 'Analyst']);
  if (!u) return null;
  const n = u.name;
  const text =
    u.personality === 'Firebrand' ? (won ? `And ${n}? Buzzing. Wanted to queue another the second it ended.` : `${n} was fuming after — the good kind. The kind that wins you the next one.`)
    : u.personality === 'Catalyst' ? (won ? `${n} had the whole booth laughing after the last round. Good for the room.` : `${n} kept everyone's chin up on the way out. Worth their weight, that one.`)
    : u.personality === 'Analyst' ? (won ? `${n}'s already three replays deep, muttering about round timings. Didn't even celebrate.` : `${n}'s already deep in the VOD, hunting for exactly where it slipped.`)
    : (won ? `${n} just nodded, packed up, said "next one." Steady as ever.` : `${n} took it on the chin. Just nodded and said "we go again."`);
  return { who: 'sam', text };
}

function buildBeats(won: boolean, roster: readonly Unit[]): StoryBeat[] {
  const open: StoryBeat[] = won
    ? [
        { art: 'Pixel Perfect after close — you and Sam, two chairs by a dark monitor', who: 'sam', text: 'First win on the board. How\'s it feel?' },
        { who: 'you', text: 'Honestly? Good. Scrappy, but good.' },
        { who: 'sam', text: 'Scrappy\'s the word. Felt a little seat-of-the-pants out there, though — be honest with me.' },
      ]
    : [
        { art: 'Pixel Perfect after close — you and Sam, two chairs by a dark monitor', who: 'sam', text: 'Well. That one stung.' },
        { who: 'you', text: 'Yeah. It did.' },
        { who: 'sam', text: 'First-match nerves, maybe. It happens.' },
      ];
  const flavor = squadFlavor(roster, won);
  const middle: StoryBeat[] = [
    { who: 'you', text: 'It wasn\'t nerves. Our calls were basic. The team\'s still figuring each other out — and I\'m still figuring out how to coach this thing.' },
    { who: 'sam', text: won ? 'Hey — first match. You\'re allowed.' : '...That\'s fair. And it\'s fixable.' },
    ...(flavor ? [flavor] : []),
    { who: 'sam', text: 'But it makes me think. The teams that go far don\'t wing it. They do their homework — they KNOW their opponent before they even sit down.' },
    { who: 'sam', text: 'Maybe we dig deeper. Really study who we\'re up against. And maybe... we start drawing up our own plays, instead of just running the standard stuff.' },
    { who: 'you', text: 'Our own playbook.' },
    { who: 'sam', text: won ? 'Something to chew on. Let\'s test some new ideas next match, yeah?' : 'Something to chew on. We test new ideas next match — and we get this one back. Yeah?' },
    { art: 'You and Sam locking up the café for the night', who: 'narrator', text: 'You lock up together. The neon sign flickers off. Week two starts tomorrow.' },
  ];
  return [...open, ...middle];
}

export function showPostMatch1Beat(won: boolean, roster: readonly Unit[], onDone: () => void): void {
  playStory(buildBeats(won, roster), () => onDone());
}
