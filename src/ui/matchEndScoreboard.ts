// Pass A5 — match-end scoreboard. Pure HTML string; mounted by main.ts via
// showModal(body: HTML). Full per-unit stats sorted by ACS desc, with an MVP
// marker and a per-round ACS sparkline per player.

import type { GameState, Team, Unit } from '../game/types.ts';
import type { MatchStats } from '../game/stats.ts';
import { computeMatchStats, mvpUnit, sortByAcs } from '../game/stats.ts';

// Shared stat tooltips — reused by the post-match review's MVP card so a header and
// its card counterpart always explain the stat the same way.
export const STAT_TIPS: Record<string, string> = {
  acs: 'Average Combat Score — overall per-round impact from kills, assists and damage. Higher is better.',
  kda: 'Kills / Deaths / Assists over the match.',
  kills: 'Kills — enemies eliminated.',
  deaths: 'Deaths — times you were eliminated.',
  assists: 'Assists — you damaged an enemy a teammate finished off.',
  adr: 'Average Damage per Round.',
  akast: 'aKAST (advanced KAST) — KAST (how OFTEN you contribute: a kill, assist, survival or trade) times KAST2 (how MUCH you contribute per round). Scale 0–3; higher means more consistent, higher-impact rounds.',
  hs: 'Headshot % — the share of your kills that were headshots.',
  wpn: 'Weapon.',
  role: 'Role — how they play every round.',
};

function sparkline(acsByRound: readonly number[], width = 80, height = 18): string {
  if (acsByRound.length === 0) {
    return `<svg class="spark" width="${width}" height="${height}"></svg>`;
  }
  const max = Math.max(...acsByRound, 1);
  const step = acsByRound.length === 1 ? 0 : width / (acsByRound.length - 1);
  const pts = acsByRound.map((v, i) => {
    const x = Math.round(step * i);
    const y = Math.round(height - (v / max) * (height - 2) - 1);
    return `${x},${y}`;
  }).join(' ');
  return `
    <svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" />
    </svg>
  `;
}

function teamSection(
  state: GameState,
  team: Team,
  stats: Record<string, MatchStats>,
  mvpId: string | null,
): string {
  const teamUnits = state.units.filter((u) => u.team === team);
  const sorted = sortByAcs(teamUnits, stats);
  const rows = sorted.map((u: Unit) => {
    const s = stats[u.id];
    if (!s) return '';
    const mvp = u.id === mvpId ? ' <span class="mvp-tag">MVP</span>' : '';
    return `
      <tr>
        <td class="me-id"><strong>${u.name}</strong>${mvp}</td>
        <td>${u.weapon}</td>
        <td>${u.role}</td>
        <td class="num">${s.acs}</td>
        <td class="num">${s.kills}</td>
        <td class="num">${s.deaths}</td>
        <td class="num">${s.assists}</td>
        <td class="num">${s.akast.toFixed(2)}</td>
        <td class="num">${s.adr}</td>
        <td class="num">${s.hsPct}%</td>
        <td class="spark-cell">${sparkline(s.acsByRound)}</td>
      </tr>
    `;
  }).join('');
  return `
    <div class="me-team">
      <h4>${team === 'defenders' ? 'D' : 'A'} — ${state.teamSide[team] === 'defender' ? 'DEF' : 'ATK'} this half</h4>
      <table class="me-table">
        <thead>
          <tr>
            <th class="me-id">Unit</th><th title="${STAT_TIPS.wpn}">Wpn</th><th title="${STAT_TIPS.role}">Role</th>
            <th class="num" title="${STAT_TIPS.acs}">ACS</th><th class="num" title="${STAT_TIPS.kills}">K</th><th class="num" title="${STAT_TIPS.deaths}">D</th><th class="num" title="${STAT_TIPS.assists}">A</th>
            <th class="num" title="${STAT_TIPS.akast}">aKAST</th><th class="num" title="${STAT_TIPS.adr}">ADR</th><th class="num" title="${STAT_TIPS.hs}">HS%</th>
            <th>ACS / round</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

export function renderMatchEndScoreboard(state: GameState): string {
  const stats = computeMatchStats(state.events, state.units);
  const mvp = mvpUnit(state);
  const winner = state.matchWinner;
  const winnerLine =
    winner === state.playerTeam ? `You win the match (${state.scores[state.playerTeam]} – ${state.scores[state.playerTeam === 'defenders' ? 'attackers' : 'defenders']}).` :
    winner ? `Opponent wins the match (${state.scores[winner === 'defenders' ? 'defenders' : 'attackers']} – ${state.scores[winner === 'defenders' ? 'attackers' : 'defenders']}).` :
    'Match ended.';
  return `
    <div class="match-end">
      <div class="me-summary">${winnerLine}</div>
      ${teamSection(state, 'defenders', stats, mvp?.id ?? null)}
      ${teamSection(state, 'attackers', stats, mvp?.id ?? null)}
    </div>
  `;
}
