// Season epilogue — the morale reckoning. Players whose morale never recovered
// (game/flightRisk.seasonLeavers) walk at season's end: a short beat where they
// say their goodbyes, in character. Narrative for now — it colours the ending and
// is the hook for the future roster-lifecycle layer (their slot reopens next
// season). If nobody's leaving, it's skipped (the caller goes straight to the
// result), so a well-managed squad never sees it.

import type { Unit } from '../game/types.ts';
import { playStory, type StoryBeat, type StoryLine } from './storyScene.ts';

type P = 'Firebrand' | 'Catalyst' | 'Analyst' | 'Stabilizer';
const isP = (s: string | null): s is P => s === 'Firebrand' || s === 'Catalyst' || s === 'Analyst' || s === 'Stabilizer';

// Why each kind of player walks when their morale's gone — their parting line.
const GOODBYE: Record<P, string> = {
  Firebrand: 'I came here to win. I don\'t think we were ever going to — not like this. No hard feelings. I just need more.',
  Catalyst: 'The fun went out of it for me. And if I\'m not bringing the room up anymore... I\'m just bringing it down. Better I go.',
  Analyst: 'I had an offer. A team that actually runs my reads. I kept waiting to feel like I mattered here, and I just... didn\'t.',
  Stabilizer: 'You know I don\'t do this. But I\'ve got nothing left in the tank, and pretending otherwise isn\'t fair to anyone. I\'m sorry.',
};
const FALLBACK_GOODBYE = 'I think it\'s time. It hasn\'t been working for a while, and we both know it. Thanks for the run.';

function buildBeats(leavers: readonly Unit[]): StoryBeat[] {
  const beats: StoryBeat[] = [
    { art: 'The café after the season — a couple of the squad lingering by the door, bags packed', who: 'narrator', text: 'The season\'s over. But not everyone\'s staying. A few of them have been quiet all week, and now you know why.' },
  ];
  for (const u of leavers) {
    const p = isP(u.personality) ? u.personality : null;
    beats.push({ who: 'player', name: u.name, text: p ? GOODBYE[p] : FALLBACK_GOODBYE } as StoryLine);
  }
  const names = leavers.map((u) => u.name);
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  beats.push(
    { who: 'sam', text: `${who}... gone. We let their morale rot, and this is the bill. Lesson learned the hard way.` },
    { art: 'You, looking at the empty chairs', who: 'narrator', text: 'A roster spot — maybe two — sits empty now. Next season, you\'ll have to rebuild. Look after your people, and it doesn\'t come to this.' },
  );
  return beats;
}

// Plays the goodbye beat for any season-end leavers, then continues. No leavers ⇒
// calls onDone immediately (no empty scene).
export function showSeasonEpilogue(leavers: readonly Unit[], onDone: () => void): void {
  if (leavers.length === 0) { onDone(); return; }
  playStory(buildBeats(leavers), () => onDone());
}
