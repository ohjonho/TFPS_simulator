// Team stats — a quick modal of the player's squad, reachable any time from the
// management header. Replaces the old standalone pre-season dashboard: team rating,
// the five aggregate bars, morale, and a per-player roster line (OVR + morale).

import { showModal } from './modal.ts';
import type { SeasonState } from '../game/season.ts';
import type { Unit } from '../game/types.ts';
import { teamRating, unitOverall } from '../game/ratings.ts';
import { aggregateVisible } from '../game/attributes.ts';
import { teamMorale, moraleLabel, moraleOf } from '../game/morale.ts';

const WEAPON_NAME: Record<string, string> = { shotgun: 'Shotgun', rifle: 'Rifle', sniper: 'Sniper' };

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

function rosterRow(u: Unit, season: SeasonState): string {
  return `<div class="dash-runit">
    <span class="dr-name">${u.name}</span>
    <span class="dr-weapon">${WEAPON_NAME[u.weapon] ?? u.weapon}</span>
    <span class="dr-role">${u.role}</span>
    <span class="dr-mood">${moraleLabel(moraleOf(season.morale ?? {}, u.id))}</span>
    <span class="dr-ovr">${Math.round(unitOverall(u))} OVR</span>
  </div>`;
}

export function showTeamStats(season: SeasonState): void {
  const roster = season.playerRoster;
  const body = `
    <div class="ts-top">Team rating <strong>${teamRating(roster)}</strong> · Squad morale <strong>${moraleLabel(teamMorale(season.morale ?? {}, roster))}</strong></div>
    ${teamAreasHtml(roster)}
    <div class="dash-roster" style="margin-top:14px;">${roster.map((u) => rosterRow(u, season)).join('')}</div>`;
  showModal('Your squad — Pixel Perfect', body, [{ label: 'Close', primary: true, onClick: () => {} }]);
}
