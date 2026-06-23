// Training day — the first beat of each week (Part 6 meta-loop). Pick one focus
// for the squad; the whole team improves in that area's sub-attributes. Picking a
// track commits it and rolls the week forward. Each track shows the squad's
// current aggregate so the manager can target a weakness. (Focus-one-player and
// Set-Pieces mastery layer on in later increments.) Full-page overlay, pure DOM.

import type { Unit, VisibleAttributes } from '../game/types.ts';
import { aggregateVisible } from '../game/attributes.ts';
import { TRAINING_TRACKS, type TrainingTrack } from '../game/training.ts';

// Each track feeds one visible aggregate — used to show the squad's current level.
const AGG_KEY: Record<TrainingTrack, keyof VisibleAttributes> = {
  aim: 'mechanics', tactics: 'gameSense', team: 'leadership', setpieces: 'discipline',
};

export function showTrainingDay(
  week: number,
  roster: readonly Unit[],
  onChoose: (track: TrainingTrack) => void,
  onBack?: () => void,
): void {
  document.getElementById('training-day')?.remove();
  const host = document.createElement('div');
  host.id = 'training-day';

  const teamAvg = (key: keyof VisibleAttributes): number =>
    roster.length ? Math.round(roster.reduce((s, u) => s + aggregateVisible(u.attributes)[key], 0) / roster.length) : 0;

  host.innerHTML = `
    <div class="td-card">
      <div class="td-header">
        <div class="td-kicker">Week ${week} · Training day</div>
        <h1>Drill the squad</h1>
        <p class="td-sub">Pick one focus for the week. The whole squad sharpens in that area — you can only work on so much at once.</p>
      </div>
      <div class="td-tracks">
        ${TRAINING_TRACKS.map((t) => `
          <button class="td-track" data-track="${t.id}" type="button">
            <div class="td-track-head"><span class="td-track-name">${t.name}</span><span class="td-track-agg">${t.aggregate} <b>${teamAvg(AGG_KEY[t.id])}</b></span></div>
            <div class="td-track-blurb">${t.blurb}</div>
          </button>`).join('')}
      </div>
      <p class="td-note">Improvisation isn't drilled here — your squad earns it in matches, under real pressure.</p>
      <div class="td-actions">${onBack ? '<button class="btn-back" data-back type="button">&larr; Back</button>' : ''}</div>
    </div>`;
  document.body.appendChild(host);

  host.querySelectorAll<HTMLButtonElement>('[data-track]').forEach((b) => b.addEventListener('click', () => {
    host.remove();
    onChoose(b.getAttribute('data-track') as TrainingTrack);
  }));
  host.querySelector<HTMLButtonElement>('[data-back]')?.addEventListener('click', () => { host.remove(); onBack?.(); });
}
