// Pass A5 — per-round stats table for the round-end modal body. Pure HTML
// string; mounted by main.ts via showModal(body: HTML).

import type { GameState, Team, Unit } from '../game/types.ts';
import type { RoundStats } from '../game/stats.ts';
import { computeRoundStats } from '../game/stats.ts';

function teamLabel(team: Team): string {
  return team === 'defenders' ? 'D' : 'A';
}

function kastBadges(s: RoundStats): string {
  // K A S T flags shown as toggle pills.
  const flag = (label: string, on: boolean) =>
    `<span class="kast ${on ? 'on' : 'off'}">${label}</span>`;
  return flag('K', s.k) + flag('A', s.a) + flag('S', s.s) + flag('T', s.t);
}

function teamSection(
  state: GameState,
  team: Team,
  stats: Record<string, RoundStats>,
): string {
  const units = state.units.filter((u) => u.team === team);
  const rows = units.map((u: Unit) => {
    const s = stats[u.id] ?? {
      kills: 0, deaths: 0, assists: 0, damage: 0, headshotKills: 0, acs: 0,
      k: false, a: false, s: false, t: false,
    };
    const dead = u.state === 'dead' ? ' <span class="dead-tag">DEAD</span>' : '';
    return `
      <tr>
        <td class="re-id"><strong>${u.id}</strong>${dead}</td>
        <td>${u.weapon}</td>
        <td class="num">${s.kills}</td>
        <td class="num">${s.deaths}</td>
        <td class="num">${s.assists}</td>
        <td class="num">${s.damage}</td>
        <td class="num">${s.acs}</td>
        <td class="kast-cell">${kastBadges(s)}</td>
      </tr>
    `;
  }).join('');
  return `
    <div class="re-team">
      <h4>${teamLabel(team)} — ${state.teamSide[team] === 'defender' ? 'DEF' : 'ATK'}</h4>
      <table class="re-table">
        <thead>
          <tr>
            <th class="re-id">Unit</th><th>Wpn</th>
            <th class="num">K</th><th class="num">D</th><th class="num">A</th>
            <th class="num">DMG</th><th class="num">ACS</th>
            <th>KAST</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// Render the round-end stats body for the given completed round. Reads
// state.events filtered to roundIndex.
export function renderRoundEndStats(state: GameState, roundIndex: number): string {
  const stats = computeRoundStats(state.events, roundIndex, state.units);
  const winner = state.roundResult?.winner ?? null;
  const winnerLine = winner === 'draw'
    ? 'Round ended in a draw.'
    : winner === state.playerTeam
      ? `You win round ${roundIndex}.`
      : winner
        ? `Opponent wins round ${roundIndex}.`
        : `Round ${roundIndex} ended.`;
  const scoreLine = `Score: ${state.scores[state.playerTeam]} – ${state.scores[state.playerTeam === 'defenders' ? 'attackers' : 'defenders']}`;
  return `
    <div class="round-end">
      <div class="re-summary">${winnerLine} <span class="re-score">${scoreLine}</span></div>
      ${teamSection(state, 'defenders', stats)}
      ${teamSection(state, 'attackers', stats)}
    </div>
  `;
}
