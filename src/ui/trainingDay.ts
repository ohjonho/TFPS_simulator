// Training day — the first beat of each week (Part 6 meta-loop). Pick one focus
// for the squad; the whole team improves in that area's sub-attributes. Optionally
// focus ONE player first (doubles their gain, halves the rest's) — with recovering
// diminishing returns, so spamming one player is strictly worse over time. Picking
// a track commits the session and rolls the week forward. Full-page overlay.

import type { Unit, VisibleAttributes } from '../game/types.ts';
import { aggregateVisible } from '../game/attributes.ts';
import { shortLabels } from '../game/names.ts';
import { TRAINING_TRACKS, freshnessLabel, type TrainingTrack, type FocusFreshness } from '../game/training.ts';

// Each track feeds one visible aggregate — used to show the squad's current level.
const AGG_KEY: Record<TrainingTrack, keyof VisibleAttributes> = {
  aim: 'mechanics', tactics: 'gameSense', team: 'leadership', setpieces: 'discipline',
};

export function showTrainingDay(
  week: number,
  roster: readonly Unit[],
  freshness: FocusFreshness,
  onChoose: (track: TrainingTrack, focusId: string | null) => void,
  onBack?: () => void,
): void {
  document.getElementById('training-day')?.remove();
  const host = document.createElement('div');
  host.id = 'training-day';
  document.body.appendChild(host);

  const labels = shortLabels(roster);
  let focusId: string | null = null; // null = whole squad

  const teamAvg = (key: keyof VisibleAttributes): number =>
    roster.length ? Math.round(roster.reduce((s, u) => s + aggregateVisible(u.attributes)[key], 0) / roster.length) : 0;

  const render = (): void => {
    const focusChips = [`<button class="td-focus ${focusId === null ? 'sel' : ''}" data-focus="" type="button">Whole squad</button>`]
      .concat(roster.map((u) => {
        const fresh = freshnessLabel(freshness, u.id);
        return `<button class="td-focus ${focusId === u.id ? 'sel' : ''}" data-focus="${u.id}" type="button">
          <span class="td-focus-badge">${labels[u.id] ?? '?'}</span>${u.name}<small>${fresh}</small></button>`;
      })).join('');

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
              <div class="td-track-blurb">${t.blurb}</div>
            </button>`).join('')}
        </div>
        <p class="td-note">Improvisation isn't drilled here — your squad earns it in matches, under real pressure.</p>
        <div class="td-actions">${onBack ? '<button class="btn-back" data-back type="button">&larr; Back</button>' : ''}</div>
      </div>`;

    host.querySelectorAll<HTMLButtonElement>('[data-focus]').forEach((b) => b.addEventListener('click', () => {
      focusId = b.getAttribute('data-focus') || null;
      render();
    }));
    host.querySelectorAll<HTMLButtonElement>('[data-track]').forEach((b) => b.addEventListener('click', () => {
      host.remove();
      onChoose(b.getAttribute('data-track') as TrainingTrack, focusId);
    }));
    host.querySelector<HTMLButtonElement>('[data-back]')?.addEventListener('click', () => { host.remove(); onBack?.(); });
  };

  render();
}
