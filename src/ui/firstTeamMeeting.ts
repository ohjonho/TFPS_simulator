// First Team Meeting — the post-draft story beat (replaces the old "club lean"
// team talk). Congratulates the five drafted players, restates the stakes, gives
// Sam a flavour line, then the highest-Leadership player offers the team-identity
// choice (which sets the season's club lean). Each player then gets a line flavoured
// by their personality — the first threads of the locker-room web. Built per-roster
// on the storyScene runner; onDone returns the chosen lean.

import type { Unit } from '../game/types.ts';
import { playStory, type StoryBeat, type StoryLine } from './storyScene.ts';

export type ClubLean = 'aggressive' | 'disciplined' | 'composed';

// Personality voice lines for the meeting. So two players of the same personality
// never say the SAME thing, each personality has a solo line, an "echo" line for a
// second player (which references/agrees with the first), and a group line for a
// third+. Grouping is done in buildMeeting so each player still speaks once.
type P = 'Firebrand' | 'Catalyst' | 'Analyst' | 'Stabilizer';

const SOLO: Record<P, string> = {
  Firebrand: 'cracks their knuckles. "Look, I didn\'t try out to play scared. Point me at someone and I\'ll frag them."',
  Catalyst: 'grins around the room. "Oh, we\'re going to be GOOD. I can feel it. This is our year."',
  Analyst: 'barely looks up from a notebook. "I\'ve already got tendencies on three of the other teams. Give me tape, I\'ll give you wins."',
  Stabilizer: 'nods slowly. "Whatever we run, I\'ll hold my angle. We win this the boring way — discipline."',
};
const ECHO: Record<P, (first: string) => string> = {
  Firebrand: (f) => `grins at ${f}. "Finally — someone who gets it. We push. We don\'t sit and pray."`,
  Catalyst: (f) => `high-fives ${f}. "See? ${f} gets the vibe! I love the energy in here already."`,
  Analyst: (f) => `slides a page across to ${f}. "${f} — check my rotation notes. Page four. You\'ll want page four."`,
  Stabilizer: (f) => `nods along with ${f}. "Two of us to keep things steady. Good. Someone has to mind the hot-heads."`,
};
const THIRD: Record<P, string> = {
  Firebrand: 'is already bouncing in their seat. "Oh, this locker room is going to be LOUD."',
  Catalyst: 'laughs. "Okay, officially the most fun team I\'ve ever been on and we haven\'t played a round yet."',
  Analyst: 'adjusts their glasses. "Between us, we\'ve basically got the whole league mapped. Good."',
  Stabilizer: 'just shrugs. "Plenty of steady hands here. We\'ll be fine."',
};
const FALLBACK = { solo: 'gives a small nod. "Ready to work."', echo: (f: string) => `nods. "What ${f} said."`, third: 'just nods along.' };

// Distinct lines for a group of players who share a personality (in roster order).
// Each gets a solo spotlight (clearStage) — the round-table introduces the squad one
// face at a time, which also sidesteps the stage's ≤3-portrait cap.
function meetingLinesForGroup(personality: string | null, members: { name: string; id?: string }[]): StoryLine[] {
  const p = personality && personality in SOLO ? (personality as P) : null;
  const names = members.map((m) => m.name);
  return members.map((m, i) => {
    let text: string;
    if (i === 0) text = p ? SOLO[p] : FALLBACK.solo;
    else if (i === 1) text = p ? ECHO[p](names[0]) : FALLBACK.echo(names[0]);
    else text = p ? THIRD[p] : FALLBACK.third;
    return { who: 'player', speakerId: m.id, name: m.name, clearStage: true, text };
  });
}

function buildMeeting(roster: readonly Unit[], leader: Unit): StoryBeat[] {
  const others = roster.filter((u) => u.id !== leader.id);
  const beats: StoryBeat[] = [
    { art: 'The team room — five new faces around a table', who: 'you', text: 'Congrats, all of you. Out of everyone who tried out, you five are the team.' },
    { who: 'you', text: 'Real talk on the goal: making the qualifier isn\'t enough. We finish top two to reach the main tournament — and then we win that. That prize is what keeps Pixel Perfect\'s doors open.' },
    { art: 'Sam, dropping a tray of energy drinks on the table', who: 'sam', text: 'So, you know. Easy. ...I\'ll be in the back if anyone needs me to panic with them.' },
    { art: `${leader.name} leaning into the table`, who: 'player', speakerId: leader.characterId, name: leader.name, text: 'speaks up first — of course they do. "Before we grind a single rep... what are we? What\'s this team\'s identity?"' },
    {
      art: 'The room, waiting on your call',
      prompt: 'Set the team\'s identity:',
      options: [
        { label: 'Fast and fearless — we take our fights.', set: { lean: 'aggressive' }, reply: [{ who: 'player', speakerId: leader.characterId, name: leader.name, text: 'grins. "Now we\'re talking. Aggression it is."' }] },
        { label: 'Disciplined — we run the plan, every round.', set: { lean: 'disciplined' }, reply: [{ who: 'player', speakerId: leader.characterId, name: leader.name, text: 'nods. "Structure. I can lead that."' }] },
        { label: 'Cool heads — we win the rounds that matter.', set: { lean: 'composed' }, reply: [{ who: 'player', speakerId: leader.characterId, name: leader.name, text: 'leans back. "Steady. Win the ones that count. I like it."' }] },
      ],
    },
  ];
  // Each player chimes in once — the leader's already spoken via the choice. Group
  // by personality (preserving roster order) so shared personalities interact
  // instead of repeating the same line.
  const groups: { p: string | null; members: { name: string; id?: string }[] }[] = [];
  for (const u of others) {
    const p = u.personality ?? null;
    let g = groups.find((x) => x.p === p);
    if (!g) { g = { p, members: [] }; groups.push(g); }
    g.members.push({ name: u.name, id: u.characterId });
  }
  for (const g of groups) for (const ln of meetingLinesForGroup(g.p, g.members)) beats.push(ln);
  beats.push({ art: 'The team, fired up', who: 'you', text: 'Good. That\'s who we are. Now let\'s go earn it — first training day starts now.' });
  return beats;
}

// Highest-Leadership (comms) player leads the meeting + offers the identity choice.
function pickLeader(roster: readonly Unit[]): Unit {
  return [...roster].sort((a, b) => b.attributes.comms - a.attributes.comms)[0];
}

export function showFirstTeamMeeting(roster: readonly Unit[], onDone: (lean: ClubLean) => void): void {
  const leader = pickLeader(roster);
  playStory(buildMeeting(roster, leader), (flags) => {
    const lean = (flags.lean as ClubLean) ?? 'disciplined';
    onDone(lean);
  });
}
