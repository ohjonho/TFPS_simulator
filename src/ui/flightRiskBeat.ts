// Mid-season FLIGHT-RISK beat — a player's morale has bottomed out and they're
// pulling away from the team. Sam raises it (in character for that player's
// personality) and you get a fight you can win: intervene the right way and you
// lift them clear of the danger; brush it off and they stay at risk for the
// season-end epilogue. Returns the chosen intervention's effects (or none).

import type { Unit } from '../game/types.ts';
import type { Effect } from '../game/events/types.ts';
import { FLIGHT_RISK } from '../game/config.ts';
import { playStory, type StoryBeat, type StoryFlags, type StoryLine } from './storyScene.ts';

type P = 'Firebrand' | 'Catalyst' | 'Analyst' | 'Stabilizer';
const isP = (s: string | null): s is P => s === 'Firebrand' || s === 'Catalyst' || s === 'Analyst' || s === 'Stabilizer';

// How Sam frames the problem, by personality — each reads as that character coming
// apart in their own way.
const FRAMING: Record<P, (n: string) => string> = {
  Firebrand: (n) => `${n}'s been a thundercloud all week — snapping at the calls, sick of losing. They didn't come here to lose, and right now they're not sure we can win.`,
  Catalyst: (n) => `${n}'s gone quiet. The one who usually lifts the whole room can't lift themselves — and the vibe's sagging right down with them.`,
  Analyst: (n) => `${n} feels like a spare part. Like their reads don't land, like the team plays fine without them. They're drifting, and drifting players leave.`,
  Stabilizer: (n) => `${n} came to me. And you know that's serious — ${n} NEVER complains. Said it quietly: maybe this isn't working anymore.`,
};
const FALLBACK_FRAME = (n: string) => `${n}'s morale has bottomed out. You can feel them pulling away from the team — if you don't act, you might lose them.`;

// The personality-tailored intervention (label + what it does + Sam's read on it).
type Tailored = { label: string; effects: Effect[]; reply: string };
const lift = FLIGHT_RISK.retentionLift;
const TAILORED: Record<P, Tailored> = {
  Firebrand: {
    label: 'Set them a challenge — make them a focal point.',
    effects: [{ op: 'morale', scope: 'self', amount: lift }, { op: 'attr', scope: 'self', agg: 'mechanics', amount: 2 }],
    reply: 'You light the fuse instead of stamping on it. They walk out of that meeting hungry again.',
  },
  Catalyst: {
    label: 'Rally the room — a team night, on you.',
    effects: [{ op: 'morale', scope: 'self', amount: lift }, { op: 'morale', scope: 'team', amount: 4 }],
    reply: 'One good night out and they\'re back to being the glue — and they drag everyone\'s mood up with them.',
  },
  Analyst: {
    label: 'Give them ownership — hand them the film room.',
    effects: [{ op: 'morale', scope: 'self', amount: lift }, { op: 'attr', scope: 'self', agg: 'gameSense', amount: 2 }],
    reply: 'You put them in charge of the prep. Being needed lands harder than any pep talk.',
  },
  Stabilizer: {
    label: 'Just sit with them. Listen.',
    effects: [{ op: 'morale', scope: 'self', amount: lift + 4 }],
    reply: 'You don\'t try to fix it. You just listen. By the end they\'re steady again — and quietly grateful.',
  },
};

function buildBeats(u: Unit, p: P | null): StoryBeat[] {
  const n = u.name;
  const heart: StoryLine[] = [{ who: 'sam', text: `Good. They needed to hear that it matters whether they stay. The weight\'s off their shoulders — you can see it.` }];
  const tailored = p ? TAILORED[p] : null;
  const options = [
    { label: 'Sit them down — a real heart-to-heart.', set: { frChoice: 'heart' }, reply: heart },
    ...(tailored ? [{ label: tailored.label, set: { frChoice: 'tailored' }, reply: [{ who: 'sam' as const, text: tailored.reply }] }] : []),
    { label: 'Give them space. They\'ll sort it out.', set: { frChoice: 'space' }, reply: [{ who: 'sam' as const, text: `...Maybe. I hope you\'re right. But if this doesn\'t turn, come season\'s end they might walk.` }] },
  ];
  return [
    { art: `A quiet word with Sam — ${n}'s name keeps coming up`, who: 'sam', text: `Got a minute? It\'s about ${n}. I\'m worried.` },
    { who: 'sam', text: p ? FRAMING[p](n) : FALLBACK_FRAME(n) },
    { who: 'you', text: 'How bad are we talking?' },
    { who: 'sam', text: 'Bad enough that I\'d do something about it. Your call — how do you want to handle it?' },
    { art: `${n}, somewhere off to the side, not themselves`, prompt: `How do you reach ${n}?`, options },
    { who: 'sam', text: 'Right. Let\'s get back to it.' },
  ];
}

// Returns the chosen intervention's effects (targeting the at-risk player, scope
// 'self') — empty if you gave them space.
export function showFlightRiskBeat(u: Unit, onDone: (effects: Effect[]) => void): void {
  const p = isP(u.personality) ? u.personality : null;
  playStory(buildBeats(u, p), (flags: StoryFlags) => {
    const choice = flags.frChoice ?? 'space';
    const effects: Effect[] = choice === 'heart' ? [{ op: 'morale', scope: 'self', amount: lift }]
      : choice === 'tailored' && p ? TAILORED[p].effects
      : [];
    onDone(effects);
  });
}
