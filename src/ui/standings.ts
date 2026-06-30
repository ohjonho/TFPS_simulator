// League standings screen (v1 economy R2) — a full-page overlay (reuses the
// .dashboard layout) showing the 9-team table: rank · team · W–L. Your row is
// highlighted, the top-`playoffTeams` are flagged as the playoff zone (with a cut
// line), and your next opponent is marked. Shown from Match Prep, on your bye
// week, and at season end. Pure read of computeStandings — no state changes.

import type { SeasonState } from '../game/season.ts';
import { computeStandings, nextOpponentTeamIndex } from '../game/standings.ts';
import { LEAGUE } from '../game/config.ts';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

// Just the table markup — reused by the full screen and the season-end modal.
export function standingsTableHtml(season: SeasonState): string {
  const rows = computeStandings(season);
  const cut = LEAGUE.playoffTeams;
  const nextTi = nextOpponentTeamIndex(season);
  const body = rows.map((r) => {
    const next = r.teamIndex === nextTi;
    const cls = [r.isPlayer ? 'you' : '', r.rank <= cut ? 'playoff' : '', next ? 'next' : ''].filter(Boolean).join(' ');
    const tags = `${r.isPlayer ? ' <span class="st-tag you">you</span>' : ''}${next ? ' <span class="st-tag next">next up</span>' : ''}`;
    const divider = r.rank === cut
      ? `<tr class="st-divider"><td colspan="5">— top ${cut} make the playoffs —</td></tr>`
      : '';
    const rd = `${r.rd > 0 ? '+' : r.rd < 0 ? '−' : '±'}${Math.abs(r.rd)}`;
    const rdCls = r.rd > 0 ? 'pos' : r.rd < 0 ? 'neg' : '';
    return `<tr class="${cls}">
        <td class="st-rank">${r.rank}</td>
        <td class="st-team">${esc(r.name)}${tags}</td>
        <td class="st-w">${r.wins}</td>
        <td class="st-l">${r.losses}</td>
        <td class="st-rd ${rdCls}">${rd}</td>
      </tr>${divider}`;
  }).join('');
  return `<table class="standings-table">
      <thead><tr><th class="st-rank">#</th><th class="st-team">Team</th><th class="st-w">W</th><th class="st-l">L</th><th class="st-rd" title="Round differential — rounds won minus rounds lost">RD</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

export type StandingsOpts = { kicker?: string; title?: string; sub?: string; cta?: string };

export function showStandings(season: SeasonState, onClose: () => void, opts?: StandingsOpts): void {
  document.getElementById('standings')?.remove();
  const host = document.createElement('div');
  host.id = 'standings';
  host.className = 'dashboard'; // reuse the full-page overlay layout
  document.body.appendChild(host);

  const cut = LEAGUE.playoffTeams;
  host.innerHTML = `
    <div class="dash-card">
      <div class="dash-header">
        <div class="dash-kicker">${opts?.kicker ?? 'League'}</div>
        <h1>${opts?.title ?? 'Standings'}</h1>
        <p class="dash-sub">${opts?.sub ?? `Everyone plays everyone once. The top ${cut} make the playoffs — reach the final to save the shop.`}</p>
      </div>
      ${standingsTableHtml(season)}
      <div class="dash-actions">
        <button class="btn-primary" data-close type="button">${opts?.cta ?? 'Continue →'}</button>
      </div>
    </div>`;

  host.querySelector<HTMLButtonElement>('[data-close]')?.addEventListener('click', () => {
    host.remove();
    onClose();
  });
}
