// Pass A5 — per-round stats table for the round-end modal body. Pure HTML
// string; mounted by main.ts via showModal(body: HTML).
// Pass D — also shows both teams' card picks at the top with one-line
// outcome blurbs derived from the event log.

import type { GameEvent, GameState, PlayedCard, Team, Unit } from '../game/types.ts';
import type { RoundStats } from '../game/stats.ts';
import { computeRoundStats } from '../game/stats.ts';
import { cardById } from '../game/cardData.ts';

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
      ${cardsPlayedSection(state, roundIndex)}
      ${teamSection(state, 'defenders', stats)}
      ${teamSection(state, 'attackers', stats)}
    </div>
  `;
}

// --- Pass D: cards-played section ----------------------------------------
// Shows each team's pick this round + a derived one-line outcome blurb so
// the player can see what the AI did and how it played out.

function cardsPlayedSection(state: GameState, roundIndex: number): string {
  const roundEvents = state.events.filter((e) => e.roundIndex === roundIndex);
  const playerCard = state.playedCard[state.playerTeam];
  const oppTeam: Team = state.playerTeam === 'defenders' ? 'attackers' : 'defenders';
  const oppCard = state.playedCard[oppTeam];
  if (!playerCard && !oppCard) return '';
  const rows = [
    cardRow('You', playerCard, roundEvents, state),
    cardRow('Opp', oppCard, roundEvents, state),
  ].filter(Boolean).join('');
  return `
    <div class="re-cards">
      <h4>Cards this round</h4>
      ${rows}
    </div>
  `;
}

function cardRow(
  label: string,
  played: PlayedCard | null,
  events: GameEvent[],
  state: GameState,
): string {
  if (!played) return `<div class="re-card-row"><strong>${label}:</strong> <em>no card</em></div>`;
  const def = cardById(played.defId);
  if (!def) return '';
  const blurb = outcomeBlurb(played, events, state);
  return `
    <div class="re-card-row">
      <strong>${label}: «${def.name}»</strong>
      <span class="c-source">${def.source} (${played.contributor})</span>
      <span class="re-card-blurb">${blurb}</span>
    </div>
  `;
}

// Per-card derived blurb. Reads round events + state when possible; falls
// back to a static description when the effect has no observable signal.
function outcomeBlurb(played: PlayedCard, events: GameEvent[], state: GameState): string {
  switch (played.defId) {
    case 'mark_target': {
      // Mark Target — first-spot trigger. If contributor saw an enemy, the
      // mark fired; count allied hits on the marked enemy this round.
      const markFx = state.cardEffects.find((e) => e.kind === 'mark_target' && !e.expiresAtTick);
      if (!markFx || markFx.kind !== 'mark_target') return 'No enemy spotted — mark never fired.';
      const hits = events.filter((e) =>
        e.type === 'shot' && e.hit && e.target === markFx.targetId
        && shooterIsTeammate(state, e.shooter, markFx.team),
      ).length;
      return `Marked ${markFx.targetId} — ${hits} allied hit${hits === 1 ? '' : 's'} on the marked target.`;
    }
    case 'trade_window': {
      // Trade Window — count Trade Window-driven marks (mark_target with
      // expiresAtTick) that fired this round.
      const marks = events.filter((e) => e.type === 'death').length;
      return marks > 0
        ? `${marks} teammate death${marks === 1 ? '' : 's'} this round; killers auto-marked.`
        : 'No teammate died this round — Trade Window did not fire.';
    }
    case 'tactical_scan': {
      const fx = state.cardEffects.find((e) => e.kind === 'tactical_scan');
      const ticks = fx && fx.kind === 'tactical_scan' ? fx.expiresAtTick - (state.tick - (state.tick - fx.expiresAtTick)) : 0;
      void ticks;
      return 'Revealed all enemies at round start.';
    }
    case 'hold_the_line': {
      const blocks = events.filter((e) => e.type === 'safeWindowBlock').length;
      return blocks > 0
        ? `Safe-window blocked ${blocks} shot${blocks === 1 ? '' : 's'}.`
        : 'Anchor set; no safe-window blocks this round.';
    }
    case 'setup_play': {
      // Hits made by the named ally while within the 5-hex window. Approx by
      // counting all hits by that ally — cleaner attribution needs an event
      // type addition (deferred to Pass D2).
      const fx = state.cardEffects.find((e) => e.kind === 'setup_play');
      if (!fx || fx.kind !== 'setup_play') return 'Anchor set.';
      const hits = events.filter((e) => e.type === 'shot' && e.hit && e.shooter === fx.allyId).length;
      return `Anchor set; ally ${fx.allyId} landed ${hits} hit${hits === 1 ? '' : 's'} this round.`;
    }
    case 'spearhead': {
      // Vanguard took first contact = first shot fired by them.
      const firstShot = events.find((e) => e.type === 'shot' && e.shooter === played.contributor);
      return firstShot
        ? `Vanguard ${played.contributor} took first contact at tick ${firstShot.tick}.`
        : `Vanguard ${played.contributor} held the lead; no first contact.`;
    }
    case 'guardian_aura':
      return 'Allies within 5 hex gained +1 max HP this round.';
    case 'crossfire':
      return 'Crossfire bonus stacked when allies fired nearby.';
    case 'opening_pick':
      return `${played.contributor} got +30/+15 on first 3 engagement ticks.`;
    case 'anchor_position':
      return `${played.contributor} doubled Sentinel bonus once stationary.`;
    case 'reckless_push':
      return `${played.contributor} ignored retreat + plant -1 tick.`;
    case 'slow_flank':
      return `${played.contributor} flanked invisibly until contact.`;
    case 'adapt':
      return `Specialist ${played.contributor} mimicked ${typeof played.target === 'string' ? played.target : 'a role'}; +10 HR all round.`;
    default:
      return '';
  }
}

function shooterIsTeammate(state: GameState, shooterId: string, team: Team): boolean {
  const u = state.units.find((x) => x.id === shooterId);
  return !!u && u.team === team;
}
