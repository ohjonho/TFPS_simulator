// Pre-draft story beat — the tryouts. You address the room of hopefuls, lay out
// the stakes (win the circuit, save Pixel Perfect), and explain how tryouts work,
// then hand off to the draft board. No choices; pure scene-setting.

import { playStory, type StoryBeat } from './storyScene.ts';

const BEATS: readonly StoryBeat[] = [
  // Transition out of the opening scene — time passes between deciding to form a
  // team and the tryouts, so the two scenes read as separate moments, not one.
  { art: '⏳  A "PLAYERS WANTED" flyer taped to the café window — the days blur past', who: 'narrator', text: 'Word goes out. A flyer in the window, a post in the local Discord, a few favours called in. For a week — nothing. Then the replies start trickling in.' },
  { art: 'Tryouts day — the cleared-out back room, packed with nervous hopefuls', who: 'narrator', text: 'Tryouts day. The back room you cleared out is full of strangers and borrowed peripherals, every one of them hoping to make the cut.' },
  { art: 'The tryout room — a dozen hopefuls, monitors humming', who: 'you', text: 'Thanks for coming out, everyone. Seriously — you saw the post, you showed up. That already means something.' },
  { who: 'you', text: 'Quick version of why we\'re here: we\'re putting a team together to enter the Amateur Circuit. And we\'re not here to make up the numbers — we\'re here to win it.' },
  { who: 'you', text: 'Win it, and we save Pixel Perfect. The shop half of you grew up in.' },
  { art: 'Sam, leaning in the doorway', who: 'sam', text: 'No pressure or anything.' },
  { art: 'The tryout room — players settling in at their stations', who: 'you', text: 'Here\'s how tryouts work. You\'ll run some matches — different roles, different maps — and Sam and I will be watching every round.' },
  { who: 'you', text: 'Then we make our picks. Five players. That\'s the team.' },
  { who: 'you', text: 'So — go show us what you\'ve got.' },
  { art: 'Monitors flickering to life around the room', who: 'narrator', text: 'Headsets on. The room goes quiet but for the clatter of keys. Tryouts begin.' },
];

export function showPreDraftBeat(onDone: () => void, onBack?: () => void): void {
  playStory(BEATS, () => onDone(), onBack);
}
