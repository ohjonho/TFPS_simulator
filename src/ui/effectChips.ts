// Renders an event's effects as a small, distinct chip row so the player can see
// what a beat actually changed (e.g. "Squad Mechanics ▲", "−6 morale", "+15 LP").
// Direction-only for stats/morale (consistent with the qualitative readouts
// elsewhere); League Points show their exact figure since they're a spendable
// resource. Reused by the ambient event screen and (later) story-beat resolutions.

import type { AggKey, Effect } from '../game/events/types.ts';

const AGG_LABEL: Record<AggKey, string> = {
  mechanics: 'Mechanics', gameSense: 'Game Sense', discipline: 'Discipline',
  improvisation: 'Improvisation', leadership: 'Leadership',
};

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

function chip(e: Effect, subjectName: string | null): string {
  if (e.op === 'leaguePoints') {
    const up = e.amount >= 0;
    return `<span class="ev-fx ${up ? 'up' : 'down'}">${up ? '+' : ''}${e.amount} League Points</span>`;
  }
  const who = e.scope === 'self' ? (subjectName ? `${esc(subjectName)}'s ` : '') : 'Squad ';
  const label = e.op === 'attr' ? AGG_LABEL[e.agg] : 'morale';
  const up = e.amount >= 0;
  return `<span class="ev-fx ${up ? 'up' : 'down'}">${who}${label} ${up ? '▲' : '▼'}</span>`;
}

export function effectChipsHtml(effects: readonly Effect[] | undefined, subjectName: string | null): string {
  if (!effects || effects.length === 0) return '';
  return `<div class="ev-effects">
      <div class="ev-effects-head">What changed</div>
      <div class="ev-fx-row">${effects.map((e) => chip(e, subjectName)).join('')}</div>
    </div>`;
}
