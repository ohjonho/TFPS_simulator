// Pre-season dashboard — shown once after the team talk, before match 1. A light
// management beat: spend a tiny budget on a club upgrade or two, then scroll a
// summary of the squad you drafted, and start the season. Full-page overlay;
// removed on continue. No economy yet — upgrades are small season-long bumps.

import type { SeasonState } from '../game/season.ts';
import type { Unit } from '../game/types.ts';
import { UPGRADES, UPGRADE_BUDGET } from '../game/season.ts';
import { teamRating, unitOverall } from '../game/ratings.ts';
import { aggregateVisible } from '../game/attributes.ts';

const WEAPON_NAME: Record<string, string> = { shotgun: 'Shotgun', rifle: 'Rifle', sniper: 'Sniper' };

export function showDashboard(season: SeasonState, onContinue: (upgrades: string[]) => void, onBack?: () => void): void {
  document.getElementById('dashboard')?.remove();
  const roster = season.playerRoster;
  const host = document.createElement('div');
  host.id = 'dashboard';
  const selected = new Set<string>();

  host.innerHTML = `
    <div class="dash-card">
      <div class="dash-header">
        <div class="dash-kicker">Pre-season</div>
        <h1>Your squad is set</h1>
        <p class="dash-sub">Spend the pre-season budget on the club, then start the season. (You can win without spending — it all helps a little.)</p>
      </div>

      <h2 class="dash-section">Club budget <span class="dash-budget" data-budget>0 / ${UPGRADE_BUDGET} chosen</span></h2>
      <div class="dash-upgrades">
        ${UPGRADES.map((u) => `
          <button class="dash-upg" data-upg="${u.id}" type="button">
            <div class="du-name">${u.name}</div>
            <div class="du-desc">${u.desc}</div>
          </button>`).join('')}
      </div>

      <h2 class="dash-section">Squad summary <span class="dash-rating">Team rating ${teamRating(roster)}</span></h2>
      ${teamAreasHtml(roster)}
      <div class="dash-roster">
        ${roster.map(rosterRow).join('')}
      </div>

      <div class="dash-actions">
        ${onBack ? '<button class="btn-back" data-back type="button">&larr; Back</button>' : ''}
        <button class="btn-primary" data-start type="button">Start the season &rarr;</button>
      </div>
    </div>`;
  document.body.appendChild(host);

  const budgetEl = host.querySelector<HTMLElement>('[data-budget]');
  const refresh = () => {
    if (budgetEl) budgetEl.textContent = `${selected.size} / ${UPGRADE_BUDGET} chosen`;
  };
  host.querySelectorAll<HTMLButtonElement>('[data-upg]').forEach((btn) => {
    const id = btn.getAttribute('data-upg')!;
    btn.addEventListener('click', () => {
      if (selected.has(id)) { selected.delete(id); btn.classList.remove('selected'); }
      else if (selected.size < UPGRADE_BUDGET) { selected.add(id); btn.classList.add('selected'); }
      refresh();
    });
  });
  host.querySelector<HTMLButtonElement>('[data-start]')?.addEventListener('click', () => {
    host.remove();
    onContinue([...selected]);
  });
  host.querySelector<HTMLButtonElement>('[data-back]')?.addEventListener('click', () => {
    host.remove();
    onBack?.();
  });
}

function teamAreasHtml(units: readonly Unit[]): string {
  const keys = ['mechanics', 'gameSense', 'discipline', 'improvisation', 'leadership'] as const;
  const labels: Record<string, string> = {
    mechanics: 'Mechanics', gameSense: 'Game Sense', discipline: 'Discipline',
    improvisation: 'Improvisation', leadership: 'Leadership',
  };
  const avg: Record<string, number> = {};
  for (const k of keys) avg[k] = 0;
  for (const u of units) {
    const v = aggregateVisible(u.attributes) as unknown as Record<string, number>;
    for (const k of keys) avg[k] += v[k];
  }
  const n = Math.max(1, units.length);
  return `<div class="dash-areas">${keys.map((k) => {
    const val = Math.round(avg[k] / n);
    return `<div class="da-row"><span class="da-label">${labels[k]}</span><span class="da-bar"><span class="da-fill" style="width:${val}%"></span></span><span class="da-val">${val}</span></div>`;
  }).join('')}</div>`;
}

function rosterRow(u: Unit): string {
  return `<div class="dash-runit">
    <span class="dr-name">${u.name}</span>
    <span class="dr-weapon">${WEAPON_NAME[u.weapon] ?? u.weapon}</span>
    <span class="dr-role">${u.role}</span>
    <span class="dr-ovr">${Math.round(unitOverall(u))} OVR</span>
  </div>`;
}
