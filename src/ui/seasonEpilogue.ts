// Season epilogue — where the season left everyone. Two strands, played as one
// scene: (1) ARC REFLECTIONS — for each drafted character with a story arc, a line
// keyed to how their arc landed (resolved / frozen / neglected / unstarted), so the
// curse you lifted or the newcomer you kept actually pays off at season's end;
// (2) the MORALE GOODBYES — players whose morale never recovered (flightRisk.
// seasonLeavers) walk, in character. If there's nothing to say, it's skipped.

import type { Unit } from '../game/types.ts';
import type { SeasonState } from '../game/season.ts';
import { ARCS } from '../game/story/arcs.ts';
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

// PURE — the arc-outcome reflection lines for a season's drafted arcs, keyed by how
// each landed (resolvedOutcome first, then status). Skips units in `skipIds` (a
// leaver says their own goodbye instead of getting a reflection). Testable.
export function arcEpilogueLines(season: SeasonState, skipIds: ReadonlySet<string> = new Set()): { characterId: string; name: string; line: string }[] {
  const out: { characterId: string; name: string; line: string }[] = [];
  for (const rt of season.arcs ?? []) {
    const arc = ARCS[rt.arcId];
    if (!arc?.epilogue) continue;
    const u = season.playerRoster.find((x) => x.characterId === arc.characterId);
    if (!u || skipIds.has(u.id)) continue;
    const line = (rt.resolvedOutcome && arc.epilogue[rt.resolvedOutcome]) || arc.epilogue[rt.status];
    if (!line) continue;
    out.push({ characterId: arc.characterId, name: u.name, line });
  }
  return out;
}

// A leaver's own arc line, keyed by how their story stood when they walked. Skips a
// 'resolved' arc (a triumphant line would jar against them quitting); those — and any
// arc-less leaver — fall back to the generic personality goodbye.
function leaverArcLine(season: SeasonState, u: Unit): string | null {
  const rt = (season.arcs ?? []).find((r) => r.characterId === u.characterId);
  const arc = rt ? ARCS[rt.arcId] : undefined;
  if (!rt || !arc?.epilogue || rt.status === 'resolved') return null;
  return arc.epilogue[rt.status] ?? null;
}

function leaverBeats(season: SeasonState, leavers: readonly Unit[]): StoryBeat[] {
  const beats: StoryBeat[] = [];
  for (const u of leavers) {
    const arcLine = leaverArcLine(season, u);
    if (arcLine) {
      // Their arc's own authored send-off (how they slipped away), played over their face.
      beats.push({ who: 'narrator', portraitId: u.characterId, clearStage: true, text: arcLine } as StoryLine);
    } else {
      const p = isP(u.personality) ? u.personality : null;
      beats.push({ who: 'player', speakerId: u.characterId, clearStage: true, name: u.name, text: p ? GOODBYE[p] : FALLBACK_GOODBYE } as StoryLine);
    }
  }
  const names = leavers.map((u) => u.name);
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  beats.push(
    { who: 'sam', text: `${who}... gone. We let their morale rot, and this is the bill. Lesson learned the hard way.` } as StoryLine,
    { art: 'You, looking at the empty chairs', who: 'narrator', text: 'A roster spot — maybe two — sits empty now. Next season, you\'ll have to rebuild.' } as StoryLine,
  );
  return beats;
}

// Plays the season-end epilogue: arc reflections (each over the player's face — a
// roll call) + morale goodbyes. Nothing to say (no arcs, no leavers) ⇒ onDone now.
export function showSeasonEpilogue(season: SeasonState, leavers: readonly Unit[], onDone: () => void): void {
  const skip = new Set(leavers.map((u) => u.id));
  const reflections = arcEpilogueLines(season, skip);
  if (reflections.length === 0 && leavers.length === 0) { onDone(); return; }

  const beats: StoryBeat[] = [
    { art: "The café at season's end — chairs up on tables, monitors cooling", who: 'narrator',
      text: leavers.length
        ? "The season's over — and not everyone's staying. Here's where it left them."
        : "The season's over. Before the lights go down, here's where it left everyone." } as StoryLine,
  ];
  // The stayers, each reflected on over their own face.
  for (const r of reflections) beats.push({ who: 'narrator', portraitId: r.characterId, clearStage: true, text: r.line } as StoryLine);
  if (leavers.length) beats.push(...leaverBeats(season, leavers));
  playStory(beats, () => onDone());
}
