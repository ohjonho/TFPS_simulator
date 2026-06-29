// Training day — the first beat of each week (Part 6 meta-loop). One FREE session:
// pick a track (the whole squad sharpens in that area), optionally focus ONE player
// (doubles their gain, halves the rest's, with recovering diminishing returns).
// Set-Pieces additionally lets you drill a saved play (raising its mastery).
//
// R3 — plus an "extra drilling" shop paid in League Points: buy additional
// whole-squad sessions, where the Nth of the SAME track this week costs more
// (so spreading across tracks is cheaper than stacking one — a real allocation
// call). Full-page overlay.

import type { Unit, VisibleAttributes } from '../game/types.ts';
import type { Strategy } from '../game/strategies.ts';
import { aggregateVisible } from '../game/attributes.ts';
import { shortLabels } from '../game/names.ts';
import { TRAINING_TRACKS, freshnessLabel, masteryLabel, extraSessionCost, extrasCost, type TrainingTrack, type FocusFreshness } from '../game/training.ts';
import { moraleOf, moraleLabel, type MoraleMap } from '../game/morale.ts';
import { attachUnitStatsPopover } from './unitStatsPopover.ts';

// Each track feeds one visible aggregate — used to show the squad's current level.
const AGG_KEY: Record<TrainingTrack, keyof VisibleAttributes> = {
  aim: 'mechanics', tactics: 'gameSense', team: 'leadership', setpieces: 'discipline',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export type TrainingChoice = {
  track: TrainingTrack;
  focusId: string | null;
  drilledPlayId: string | null;
  extras: Record<TrainingTrack, number>;
  lpSpent: number;
};

export function showTrainingDay(
  week: number,
  roster: readonly Unit[],
  freshness: FocusFreshness,
  morale: MoraleMap,
  plays: readonly Strategy[],
  playMastery: Record<string, number>,
  leaguePoints: number,
  onChoose: (choice: TrainingChoice) => void,
  onBack?: () => void,
  special = false, // the week-5 bye-week "Special Training" bootcamp (no match this week)
): void {
  document.getElementById('training-day')?.remove();
  const host = document.createElement('div');
  host.id = 'training-day';
  document.body.appendChild(host);

  const labels = shortLabels(roster);
  let focusId: string | null = null;          // null = whole squad
  let selectedTrack: TrainingTrack | null = null;
  let step: 'main' | 'drill' = 'main';        // 'drill' = Set-Pieces play picker
  const extras: Record<TrainingTrack, number> = { aim: 0, tactics: 0, team: 0, setpieces: 0 };

  const teamAvg = (key: keyof VisibleAttributes): number =>
    roster.length ? Math.round(roster.reduce((s, u) => s + aggregateVisible(u.attributes)[key], 0) / roster.length) : 0;

  const commit = (track: TrainingTrack, drilledPlayId: string | null): void => {
    host.remove();
    onChoose({ track, focusId, drilledPlayId, extras: { ...extras }, lpSpent: extrasCost(extras) });
  };

  const renderMain = (): void => {
    const focusChips = [`<button class="td-focus ${focusId === null ? 'sel' : ''}" data-focus="" type="button">Whole squad</button>`]
      .concat(roster.map((u) => `<button class="td-focus ${focusId === u.id ? 'sel' : ''}" data-focus="${u.id}" type="button">
        <span class="td-focus-badge">${labels[u.id] ?? '?'}</span>${esc(u.name)}<small>${freshnessLabel(freshness, u.id)} · ${moraleLabel(moraleOf(morale, u.id))}</small></button>`)).join('');

    const spent = extrasCost(extras);
    const remaining = leaguePoints - spent;
    const extraRows = TRAINING_TRACKS.map((t) => {
      const n = extras[t.id];
      const next = extraSessionCost(n);
      const canAdd = next <= remaining;
      return `<div class="td-extra-row">
        <span class="te-name">${t.name}</span>
        <span class="te-count">${n > 0 ? `×${n}` : ''}</span>
        <button class="te-btn" data-ex-minus="${t.id}" type="button"${n === 0 ? ' disabled' : ''}>−</button>
        <button class="te-btn te-add" data-ex-plus="${t.id}" type="button"${canAdd ? '' : ' disabled'}>+ ${next} LP</button>
      </div>`;
    }).join('');
    const extrasFoot = leaguePoints <= 0
      ? '<div class="td-extras-foot dim">Win matches to earn League Points to spend here.</div>'
      : `<div class="td-extras-foot">Spending <b>${spent}</b> LP${spent > 0 ? ` · <b>${remaining}</b> left` : ` · <b>${leaguePoints}</b> available`}</div>`;

    const confirmLabel = selectedTrack === 'setpieces' && plays.length ? 'Choose play to drill &rarr;' : 'Confirm training';
    const confirmDisabled = selectedTrack === null ? ' disabled' : '';

    host.innerHTML = `
      <div class="td-card">
        <div class="td-header">
          <div class="td-kicker">Week ${week} · ${special ? 'Bye week — Special Training' : 'Training day'}</div>
          <h1>${special ? 'Make the bye count' : 'Drill the squad'}</h1>
          <p class="td-sub">${special ? 'No match this week — a full bye to sharpen up. Pick your focus; you can stack extra League-Point sessions below to really push.' : 'Pick one free focus for the week. The whole squad sharpens in that area — and you can spend League Points on extra drilling below.'}</p>
        </div>
        <div class="td-focusrow">
          <div class="td-focus-label">Focus one player <small>(optional — doubles their gain, halves the rest's; the same player tires if you keep at it)</small></div>
          <div class="td-focuses">${focusChips}</div>
        </div>
        <div class="td-tracks">
          ${TRAINING_TRACKS.map((t) => `
            <button class="td-track${selectedTrack === t.id ? ' sel' : ''}" data-track="${t.id}" type="button">
              <div class="td-track-head"><span class="td-track-name">${t.name}</span><span class="td-track-agg">${t.aggregate} <b>${teamAvg(AGG_KEY[t.id])}</b></span></div>
              <div class="td-track-blurb">${t.blurb}${t.id === 'setpieces' && plays.length ? ' <em>— and drill one play to master it.</em>' : ''}</div>
            </button>`).join('')}
        </div>
        <div class="td-extras">
          <div class="td-extras-head">Extra drilling <small>— spend League Points; stacking one track costs more each time</small></div>
          <div class="td-extras-rows">${extraRows}</div>
          ${extrasFoot}
        </div>
        <p class="td-note">Improvisation isn't drilled here — your squad earns it in matches, under real pressure.</p>
        <div class="td-actions">
          ${onBack ? '<button class="btn-back" data-back type="button">&larr; Back</button>' : ''}
          <button class="btn-primary" data-confirm type="button"${confirmDisabled}>${confirmLabel}</button>
        </div>
      </div>`;

    host.querySelectorAll<HTMLButtonElement>('[data-focus]').forEach((b) => {
      b.addEventListener('click', () => { focusId = b.getAttribute('data-focus') || null; renderMain(); });
      const id = b.getAttribute('data-focus');
      const u = id ? roster.find((r) => r.id === id) : null;
      if (u) attachUnitStatsPopover(b, u);
    });
    host.querySelectorAll<HTMLButtonElement>('[data-track]').forEach((b) => b.addEventListener('click', () => {
      selectedTrack = b.getAttribute('data-track') as TrainingTrack;
      renderMain();
    }));
    host.querySelectorAll<HTMLButtonElement>('[data-ex-plus]').forEach((b) => b.addEventListener('click', () => {
      const id = b.getAttribute('data-ex-plus') as TrainingTrack;
      if (extraSessionCost(extras[id]) <= leaguePoints - extrasCost(extras)) { extras[id]++; renderMain(); }
    }));
    host.querySelectorAll<HTMLButtonElement>('[data-ex-minus]').forEach((b) => b.addEventListener('click', () => {
      const id = b.getAttribute('data-ex-minus') as TrainingTrack;
      if (extras[id] > 0) { extras[id]--; renderMain(); }
    }));
    host.querySelector<HTMLButtonElement>('[data-confirm]')?.addEventListener('click', () => {
      if (!selectedTrack) return;
      const track = selectedTrack;
      if (track === 'setpieces' && plays.length) { step = 'drill'; render(); } else commit(track, null);
    });
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
