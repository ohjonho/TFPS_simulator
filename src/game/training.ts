// Part 6 (season meta-loop) — training. Pure logic: each weekly session drills
// ONE of four tracks, raising the underlying SUB-attributes (the visible 5
// aggregates are read-outs of those subs, so they rise in step). The fifth
// aggregate, Improvisation, has no track — it's earned in matches (a later
// increment). Focus-one-player redistribution layers on top later.

import { TRAINING } from './config.ts';
import type { Attributes, Unit } from './types.ts';

export type TrainingTrack = 'aim' | 'tactics' | 'team' | 'setpieces';

// Each track + the subs it drills + which visible aggregate it feeds. Order is
// the display order on the training screen.
export const TRAINING_TRACKS: {
  id: TrainingTrack; name: string; aggregate: string; blurb: string; subs: (keyof Attributes)[];
}[] = [
  { id: 'aim',       name: 'Aim Training',       aggregate: 'Mechanics',  blurb: 'Sharper shooting — hit rate, headshots, reflexes.', subs: ['aim', 'headshot', 'reflexes', 'weaponAffinity'] },
  { id: 'tactics',   name: 'Strategy & Tactics', aggregate: 'Game Sense', blurb: 'Reads, rotations — and a deeper, bolder playbook.',   subs: ['vision', 'mapIQ'] },
  { id: 'team',      name: 'Team-Building',      aggregate: 'Leadership', blurb: 'Coordination and trades — the squad fights as one.', subs: ['comms'] },
  { id: 'setpieces', name: 'Set-Pieces',         aggregate: 'Discipline', blurb: 'Drill the plan so it holds under fire.',             subs: ['tenacity'] },
];

const clamp100 = (n: number): number => Math.max(0, Math.min(100, n));

// Apply one session to the whole squad: +perSession to each sub in the track.
// Pure — returns a fresh roster. (Focus-one-player redistribution comes later.)
export function applyTraining(roster: readonly Unit[], track: TrainingTrack): Unit[] {
  const def = TRAINING_TRACKS.find((t) => t.id === track);
  if (!def) return roster.map((u) => u);
  const g = TRAINING.perSession;
  return roster.map((u) => {
    const a = { ...u.attributes } as unknown as Record<string, number>;
    for (const s of def.subs) a[s] = clamp100(a[s] + g);
    return { ...u, attributes: a as unknown as Attributes };
  });
}
