// Training day — the first beat of each week (Part 6 meta-loop). Pick one focus
// for the squad; the whole team improves in that area's sub-attributes. Optionally
// focus ONE player first (doubles their gain, halves the rest's) — with recovering
// diminishing returns. Set-Pieces additionally lets you drill a specific saved
// play (raising its mastery → it executes more reliably). Picking a track commits
// the session and rolls the week forward. Full-page overlay.

import type { Unit, VisibleAttributes } from '../game/types.ts';
import type { Strategy } from '../game/strategies.ts';
import { aggregateVisible } from '../game/attributes.ts';
import { shortLabels } from '../game/names.ts';
import { TRAINING_TRACKS, freshnessLabel, masteryLabel, type TrainingTrack, type FocusFreshness } from '../game/training.ts';

// Each track feeds one visible aggregate — used to show the squad's current level.
const AGG_KEY: Record<TrainingTrack, keyof VisibleAttributes> = {
  aim: 'mechanics', tactics: 'gameSense', team: 'leadership', setpieces: 'discipline',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function showTrainingDay(
  week: number,
  roster: readonly Unit[],
  freshness: FocusFreshness,
  plays: readonly Strategy[],
  playMastery: Record<string, number>,
  onChoose: (track: TrainingTrack, focusId: string | null, drilledPlayId: string | null) => void,
  onBack?: () => void,
): void {
  document.getElementById('training-day')?.remove();
  const host = document.createElement('div');
  host.id = 'training-day';
  document.body.appendChild(host);

  const labels = shortLabels(roster);
  let focusId: string | null = null;     // null = whole squad
  let step: 'main' | 'drill' = 'main';   // 'drill' = Set-Pieces play picker

  const teamAvg = (key: keyof VisibleAttributes): number =>
    roster.length ? Math.round(roster.reduce((s, u) => s + aggregateVisible(u.attributes)[key], 0) / roster.length) : 0;

  const commit = (track: TrainingTrack, drilledPlayId: string | null): void => { host.remove(); onChoose(track, focusId, drilledPlayId); };

  const renderMain = (): void => {
    const focusChips = [`<button class="td-focus ${focusId === null ? 'sel' : ''}" data-focus="" type="button">Whole squad</button>`]
      .concat(roster.map((u) => `<button class="td-focus ${focusId === u.id ? 'sel' : ''}" data-focus="${u.id}" type="button">
        <span class="td-focus-badge">${labels[u.id] ?? '?'}</span>${esc(u.name)}<small>${freshnessLabel(freshness, u.id)}</small></button>`)).join('');

    host.innerHTML = `
      <div class="td-card">
        <div class="td-header">
          <div class="td-kicker">Week ${week} · Training day</div>
          <h1>Drill the squad</h1>
          <p class="td-sub">Pick one focus for the week. The whole squad sharpens in that area — you can only work on so much at once.</p>
        </div>
        <div class="td-focusrow">
          <div class="td-focus-label">Focus one player <small>(optional — doubles their gain, halves the rest's; the same player tires if you keep at it)</small></div>
          <div class="td-focuses">${focusChips}</div>
        </div>
        <div class="td-tracks">
          ${TRAINING_TRACKS.map((t) => `
            <button class="td-track" data-track="${t.id}" type="button">
              <div class="td-track-head"><span class="td-track-name">${t.name}</span><span class="td-track-agg">${t.aggregate} <b>${teamAvg(AGG_KEY[t.id])}</b></span></div>
              <div class="td-track-blurb">${t.blurb}${t.id === 'setpieces' && plays.length ? ' <em>— and drill one play to master it.</em>' : ''}</div>
            </button>`).join('')}
        </div>
        <p class="td-note">Improvisation isn't drilled here — your squad earns it in matches, under real pressure.</p>
        <div class="td-actions">${onBack ? '<button class="btn-back" data-back type="button">&larr; Back</button>' : ''}</div>
      </div>`;

    host.querySelectorAll<HTMLButtonElement>('[data-focus]').forEach((b) => b.addEventListener('click', () => { focusId = b.getAttribute('data-focus') || null; renderMain(); }));
    host.querySelectorAll<HTMLButtonElement>('[data-track]').forEach((b) => b.addEventListener('click', () => {
      const track = b.getAttribute('data-track') as TrainingTrack;
      // Set-Pieces with saved plays → choose which to drill; otherwise commit now.
      if (track === 'setpieces' && plays.length) { step = 'drill'; render(); } else commit(track, null);
    }));
    host.querySelector<HTMLButtonElement>('[data-back]')?.addEventListener('click', () => { host.remove(); onBack?.(); });
  };

  const renderDrill = (): void => {
    const rows = plays.map((p) => {
      const m = playMastery[p.id] ?? 0;
      return `<button class="td-play" data-drill="${esc(p.id)}" type="button">
        <span class="td-play-name">${esc(p.name)} <small>${p.side === 'defender' ? 'def' : 'atk'}</small></span>
        <span class="td-play-mastery">${masteryLabel(m)}</span></button>`;
    }).join('');
    host.innerHTML = `
      <div class="td-card">
        <div class="td-header">
          <div class="td-kicker">Week ${week} · Set-Pieces</div>
          <h1>Drill a play</h1>
          <p class="td-sub">The squad still gains Discipline. Pick a saved play to rehearse — repeating it across weeks makes it run truer under fire (it can't quite match a veteran squad's all-round reliability).</p>
        </div>
        <div class="td-plays">${rows}</div>
        <div class="td-actions">
          <button class="btn-back" data-drillback type="button">&larr; Back</button>
          <button class="btn-back" data-drillnone type="button">Just drill Discipline</button>
        </div>
      </div>`;
    host.querySelectorAll<HTMLButtonElement>('[data-drill]').forEach((b) => b.addEventListener('click', () => commit('setpieces', b.getAttribute('data-drill'))));
    host.querySelector<HTMLButtonElement>('[data-drillnone]')?.addEventListener('click', () => commit('setpieces', null));
    host.querySelector<HTMLButtonElement>('[data-drillback]')?.addEventListener('click', () => { step = 'main'; render(); });
  };

  const render = (): void => { if (step === 'drill') renderDrill(); else renderMain(); };
  render();
}
