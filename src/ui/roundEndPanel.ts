// Pass A5 — per-round stats table for the round-end modal body. Pure HTML
// string; mounted by main.ts via showModal(body: HTML).
// H3.4 — cards-played section removed (card system deleted).

import type { GameState, Team, Unit } from '../game/types.ts';
import type { RoundStats } from '../game/stats.ts';
import { computeRoundStats } from '../game/stats.ts';
import { strategyById } from '../game/strategies.ts';
import { HALFTIME_AFTER_ROUND } from '../game/config.ts';

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

// Coarse death-zones, checked in order (site before its approach lane). Parent
// regions fold in their children, so 'a_site' covers anchor/off/entry/plant etc.
const COARSE_ZONES: { region: string; label: string }[] = [
  { region: 'a_site', label: 'A site' },
  { region: 'b_site', label: 'B site' },
  { region: 'mid', label: 'Mid' },
  { region: 'a_main', label: 'A approach' },
  { region: 'b_main', label: 'B approach' },
];

function zoneOf(state: GameState, pos: { col: number; row: number }): string {
  for (const z of COARSE_ZONES) {
    const cells = state.map.regions[z.region];
    if (cells && cells.some((h) => h.col === pos.col && h.row === pos.row)) return z.label;
  }
  return 'the flanks';
}

// "Why you won/lost" — the matchup (ties back to the Scout's pre-round read), the
// mechanism that decided it, and where the fighting happened. Turns a result into
// a lesson: "my Stack held their Rush at A". Pure read of the completed round.
function whyBlock(state: GameState, roundIndex: number): string {
  const pTeam = state.playerTeam;
  const eTeam: Team = pTeam === 'defenders' ? 'attackers' : 'defenders';
  const pSide = state.teamSide[pTeam];
  const eSide = state.teamSide[eTeam];

  // Matchup from the round's strategyPick event (robust to post-round resets).
  const pickEv = state.events.find((e) => e.roundIndex === roundIndex && e.type === 'strategyPick');
  let pId: string | null = state.playerStrategy;
  let eId: string | null = state.aiStrategy;
  if (pickEv && pickEv.type === 'strategyPick') {
    if (pickEv.playerTeam === pTeam) { pId = pickEv.playerStrategy; eId = pickEv.aiStrategy; }
    else { pId = pickEv.aiStrategy; eId = pickEv.playerStrategy; }
  }
  const pName = (pId && strategyById(pId, pSide, state.map)?.name) || pId || '—';
  const eName = (eId && strategyById(eId, eSide, state.map)?.name) || eId || '—';
  const matchup = `You played <strong>${pName}</strong> <span class="re-side">(${pSide})</span> vs their <strong>${eName}</strong> <span class="re-side">(${eSide})</span>.`;

  // Mechanism that decided the round.
  const roundEvents = state.events.filter((e) => e.roundIndex === roundIndex);
  const detonate = roundEvents.find((e) => e.type === 'detonate');
  const hasDefuse = roundEvents.some((e) => e.type === 'defuse');
  const atkAlive = state.units.filter((u) => u.team === 'attackers' && u.state === 'alive').length;
  const defAlive = state.units.filter((u) => u.team === 'defenders' && u.state === 'alive').length;
  let outcome: string;
  if (detonate && detonate.type === 'detonate') outcome = `Spike detonated at ${detonate.site} — attackers took the site.`;
  else if (hasDefuse) outcome = 'Spike defused — defenders saved the round.';
  else if (atkAlive === 0) outcome = 'Attackers eliminated.';
  else if (defAlive === 0) outcome = 'Defenders eliminated.';
  else outcome = 'Time expired — defenders held.';

  // Where the fighting was decided (dead units fell where they died).
  const dead = state.units.filter((u) => u.state === 'dead');
  const counts: Record<string, number> = {};
  for (const u of dead) { const z = zoneOf(state, u.pos); counts[z] = (counts[z] ?? 0) + 1; }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  let zoneLine = '';
  if (top && dead.length >= 3) {
    zoneLine = top[1] / dead.length >= 0.45
      ? `<div class="re-zones">Fighting centered on <strong>${top[0]}</strong> — ${top[1]} of ${dead.length} falls there.</div>`
      : `<div class="re-zones">Fighting spread across the map (${dead.length} falls).</div>`;
  }

  // Read loop: did the enemy follow the tendency the Scout flagged pre-round, or
  // mix it up? Reconstruct this half's prior enemy picks (the same data the Scout
  // read — it resets at halftime) and compare their modal to what they actually ran.
  let readLine = '';
  const halfStart = roundIndex <= HALFTIME_AFTER_ROUND ? 1 : HALFTIME_AFTER_ROUND + 1;
  const priorEnemyPicks: string[] = [];
  for (const e of state.events) {
    if (e.type !== 'strategyPick' || e.roundIndex < halfStart || e.roundIndex >= roundIndex) continue;
    const ep = e.playerTeam === pTeam ? e.aiStrategy : e.playerStrategy;
    if (ep) priorEnemyPicks.push(ep);
  }
  if (priorEnemyPicks.length > 0 && eId) {
    const tallies: Record<string, number> = {};
    for (const p of priorEnemyPicks) tallies[p] = (tallies[p] ?? 0) + 1;
    const leanId = Object.entries(tallies).sort((a, b) => b[1] - a[1])[0][0];
    const leanName = strategyById(leanId, eSide, state.map)?.name ?? leanId;
    readLine = eId === leanId
      ? `<div class="re-read">The Scout called it — they stuck with <strong>${leanName}</strong>.</div>`
      : `<div class="re-read">They mixed it up — the Scout's lean was <strong>${leanName}</strong>, but they ran ${eName} this round.</div>`;
  }

  return `<div class="re-why">
      <div class="re-matchup">${matchup}</div>
      ${readLine}
      <div class="re-outcome">${outcome}</div>
      ${zoneLine}
    </div>`;
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
      ${whyBlock(state, roundIndex)}
      ${teamSection(state, 'defenders', stats)}
      ${teamSection(state, 'attackers', stats)}
    </div>
  `;
}

// H3.4 — cardsPlayedSection / cardRow / outcomeBlurb / shooterIsTeammate
// deleted along with the card system. Strategy picks for the round still
// land in the kill-feed strategyPick line at the top of the round.
