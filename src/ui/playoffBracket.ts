// Playoff bracket (v1 economy R2d) — a full-page overlay showing the top-4
// single-elim tree (two semifinals → final), with results filled in as they
// resolve, your team highlighted. Shown at each stage transition and embedded in
// the season-end modal. Pure read of season.playoffs + standings names.

import type { SeasonState } from '../game/season.ts';
import { teamNameForIndex } from '../game/standings.ts';
import { LEAGUE } from '../game/config.ts';

const P = LEAGUE.playerTeamIndex;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function teamRow(season: SeasonState, ti: number | null, winnerTi: number | null, seed?: number): string {
  if (ti === null || ti === undefined) return '<div class="br-team tbd">TBD</div>';
  const you = ti === P;
  const won = winnerTi === ti;
  const lost = winnerTi !== null && winnerTi !== ti;
  const cls = ['br-team', you ? 'you' : '', won ? 'won' : '', lost ? 'lost' : ''].filter(Boolean).join(' ');
  const seedTag = seed ? `<span class="br-seed">${seed}</span>` : '';
  return `<div class="${cls}">${seedTag}<span class="br-name">${esc(teamNameForIndex(season, ti))}</span>${you ? '<span class="br-tag">you</span>' : ''}${won ? '<span class="br-win">✓</span>' : ''}</div>`;
}

function matchupHtml(season: SeasonState, label: string, a: number | null, b: number | null, winner: number | null, seedA?: number, seedB?: number): string {
  return `<div class="br-match"><div class="br-label">${label}</div>${teamRow(season, a, winner, seedA)}${teamRow(season, b, winner, seedB)}</div>`;
}

export function bracketHtml(season: SeasonState): string {
  const po = season.playoffs;
  if (!po) return '';
  const [s1, s2, s3, s4] = po.seeds;
  return `<div class="bracket">
      <div class="br-col">
        ${matchupHtml(season, 'Semifinal', s1, s4, po.semiA, 1, 4)}
        ${matchupHtml(season, 'Semifinal', s2, s3, po.semiB, 2, 3)}
      </div>
      <div class="br-col br-final">
        ${matchupHtml(season, 'Final', po.semiA, po.semiB, po.champion)}
      </div>
    </div>`;
}

export type BracketOpts = { kicker?: string; title?: string; sub?: string; cta?: string };

export function showBracket(season: SeasonState, onContinue: () => void, opts?: BracketOpts): void {
  document.getElementById('playoff-bracket')?.remove();
  const host = document.createElement('div');
  host.id = 'playoff-bracket';
  host.className = 'dashboard'; // reuse the full-page overlay layout
  document.body.appendChild(host);

  host.innerHTML = `
    <div class="dash-card">
      <div class="dash-header">
        <div class="dash-kicker">${opts?.kicker ?? 'Playoffs'}</div>
        <h1>${opts?.title ?? 'The bracket'}</h1>
        <p class="dash-sub">${opts?.sub ?? 'Top four, single elimination. Win two and the title is yours — reach the final and the shop is saved.'}</p>
      </div>
      ${bracketHtml(season)}
      <div class="dash-actions">
        <button class="btn-primary" data-go type="button">${opts?.cta ?? 'Continue →'}</button>
      </div>
    </div>`;

  host.querySelector<HTMLButtonElement>('[data-go]')?.addEventListener('click', () => {
    host.remove();
    onContinue();
  });
}
