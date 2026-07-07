// Week-2 pre-match story beat — a nerdy teenager (Remi) ambushes the player outside
// the café with a binder of homemade scouting notes and begs to help. Accepting
// unlocks detailed scouting (the player picks a focus) AND the custom playbook.
// Replaces the old week-2 authoring tutorial. Returns the chosen scout focus.

import { playStory, type StoryBeat, type StoryFlags } from './storyScene.ts';

export type ScoutFocus = 'attack' | 'defense' | 'weakness';

const BEATS: readonly StoryBeat[] = [
  { art: 'Outside Pixel Perfect at dusk — a nervous teenager clutching an overstuffed binder', who: 'narrator', text: 'You\'re locking up when a voice stops you. A kid — maybe sixteen — is hovering by the door, hugging a binder to their chest like a shield.' },
  { who: 'npc', speakerId: 'remi', text: 'Um — hi! Hi. You\'re the manager. Of Pixel Perfect. The team. I just—' },
  { who: 'narrator', text: 'They lunge to shake your hand, trip over their own backpack, and send a blizzard of paper across the pavement.' },
  { who: 'npc', speakerId: 'remi', text: 'No— oh no, no, no—' },
  { who: 'narrator', text: 'You crouch to help. The pages aren\'t homework. They\'re scouting notes — round timings, site-hold percentages, hand-drawn map diagrams. For half the Amateur League.' },
  { who: 'you', text: '...Did you make all of this?' },
  { who: 'npc', speakerId: 'remi', text: 'Maybe? I really like spreadsheets. And, um. This game. A lot.' },
  { who: 'npc', speakerId: 'remi', text: 'I used to come here all the time — with my brother. He wanted to go pro. Then he left for college, and I didn\'t really want to come alone.' },
  { who: 'npc', speakerId: 'remi', text: 'I heard the café might close. And I just— I want to help. I don\'t want money, or a job, or anything. Here— take it.' },
  { art: 'Sam appearing in the doorway, squinting at a page', who: 'sam', text: '...Kid. Did you chart an entire team\'s defensive rotation by hand?' },
  { who: 'npc', speakerId: 'remi', text: 'It\'s only MOSTLY complete!' },
  { who: 'sam', text: 'We\'re keeping them.' },
  { who: 'npc', speakerId: 'remi', set: { 'remi-met': 'true' }, text: 'Wait — really? You\'re keeping them? I— okay. Okay! Sorry, I never actually said — I\'m Remi. That\'s me. Hi.' },
  { who: 'sam', text: 'Then welcome aboard, Remi — our junior analyst. You do the reads, the coach makes the calls. ...Fair warning, the pay is exactly nothing.' },
  { who: 'npc', speakerId: 'remi', text: 'Analyst. On a real team. I would\'ve paid YOU.' },
  { who: 'you', text: 'Alright, analyst — what should we dig into first?' },
  {
    art: 'Remi, suddenly all business, flipping the binder open',
    prompt: 'Point the scouting at:',
    options: [
      { label: 'Their attack — how they hit sites.', set: { scoutFocus: 'attack' }, reply: [{ who: 'npc', speakerId: 'remi', text: 'Their entries and executes — got it. I\'ll have their tendencies mapped.' }] },
      { label: 'Their defense — how they hold.', set: { scoutFocus: 'defense' }, reply: [{ who: 'npc', speakerId: 'remi', text: 'Setups and rotations — on it. You\'ll know where they sit.' }] },
      { label: 'Their weak spot — how to game-plan them.', set: { scoutFocus: 'weakness' }, reply: [{ who: 'npc', speakerId: 'remi', text: 'Where they crack under pressure — I\'ll find the angle you exploit.' }] },
    ],
  },
  { who: 'npc', speakerId: 'remi', text: 'I\'ll have a full breakdown before your next match. This is the best day of my LIFE.' },
  { art: 'Remi sprinting off down the street, binder flapping', who: 'narrator', text: 'They\'re gone before you can answer. Sam watches them go.' },
  { who: 'sam', text: 'Half this town grew up in here, you know. ...We\'re not losing it.' },
  { who: 'sam', text: 'And hey — there\'s a whiteboard in the back gathering dust. Maybe it\'s time we drew up some plays of our own.' },
  { who: 'narrator', text: 'Detailed scouting unlocked — Remi will report in before each match. And the playbook is open: you can author your own strategies now.' },
];

export function showScoutIntroBeat(onDone: (focus: ScoutFocus) => void): void {
  playStory(BEATS, (flags: StoryFlags) => onDone((flags.scoutFocus as ScoutFocus) ?? 'attack'));
}
