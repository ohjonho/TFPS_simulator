// Attribute breakpoint beats (3e) — chains a short assistant-coach milestone for
// each tier the squad just crossed, naming the real capability it unlocks, then
// hands back to the flow. No-op (calls onDone immediately) when nothing crossed.

import { showModal } from './modal.ts';
import { playbookCapacity } from '../game/playbookGating.ts';
import type { Crossing } from '../game/breakpoints.ts';
import type { Unit } from '../game/types.ts';

function beat(c: Crossing, capacity: number): { title: string; body: string } {
  switch (c.aggregate) {
    case 'gameSense':
      return { title: 'Sharper reads',
        body: `Your squad's <strong>Game Sense</strong> crossed ${c.tier}. They see the map a step ahead — you can now keep up to <strong>${capacity} set plays</strong>, and your units can run <strong>more elaborate routes</strong> in the Playbook.` };
    case 'discipline':
      return { title: 'Locked in',
        body: `Your squad's <strong>Discipline</strong> crossed ${c.tier}. Your plays will <strong>hold together better under fire</strong> — fewer units breaking off the call when it gets loud.` };
    case 'mechanics':
      return { title: 'Aim breakthrough',
        body: `Your squad's <strong>Mechanics</strong> crossed ${c.tier}. Sharper shooting across the roster — more duels tilting your way.` };
    case 'leadership':
      return { title: 'In sync',
        body: `Your squad's <strong>Leadership</strong> crossed ${c.tier}. Tighter coordination — they trade and follow up as a unit.` };
    case 'improvisation':
      return { title: 'Ice in the veins',
        body: `Your squad's <strong>Improvisation</strong> crossed ${c.tier}. Steadier under pressure — they read and adapt better when the plan breaks.` };
  }
}

export function showBreakpoints(crossings: readonly Crossing[], roster: readonly Unit[], onDone: () => void): void {
  if (!crossings.length) { onDone(); return; }
  const capacity = playbookCapacity(roster);
  let i = 0;
  const next = (): void => {
    if (i >= crossings.length) { onDone(); return; }
    const { title, body } = beat(crossings[i], capacity);
    i++;
    showModal(`🧑‍🏫 ${title}`, `<div class="season-intro"><p>${body}</p></div>`, [
      { label: i >= crossings.length ? 'Nice' : 'Next', primary: true, onClick: next },
    ]);
  };
  next();
}
