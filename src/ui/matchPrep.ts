// Match Prep — the pre-match screen (after "Start the Season" / "Next match",
// before the rounds). Full scouting head-to-head + three match-level calls
// (play style, in-game leader, pre-match team talk) and a Win Outlook % that
// recalculates as you toggle them. On confirm it hands a MatchPrep to main.ts,
// which bakes it into the player roster for this match. Pure DOM.

import type { SeasonState, MatchPrep, PlayStyle, TeamTalk } from '../game/season.ts';
import { seasonRatings } from '../game/season.ts';

const STYLES: { id: PlayStyle; name: string; note: string; delta: number }[] = [
  { id: 'cautious', name: 'Cautious', note: 'Protect the round — safer, lower ceiling.', delta: -2 },
  { id: 'standard', name: 'Standard', note: 'Balanced. No tactical bias.', delta: 0 },
  { id: 'aggressive', name: 'Aggressive', note: 'Press the tempo — higher ceiling, more risk.', delta: 3 },
];
const TALKS: { id: TeamTalk; name: string; note: string; delta: number }[] = [
  { id: 'fire', name: 'Fire Up', note: 'Light a fire — the team pushes harder.', delta: 2 },
  { id: 'calm', name: 'Calm & Steady', note: 'Steady hands for tight rounds (+composure).', delta: 1 },
  { id: 'focus', name: 'Focus Up', note: 'Lock onto the plan (+discipline).', delta: 2 },
];
const LEADER_DELTA = 2;

function prettyLean(strategy: string, site: 'A' | 'B' | null): string {
  return `${strategy.replace(/_/g, ' ')}${site ? ` ${site}` : ''}`;
}

export function showMatchPrep(season: SeasonState, onPlay: (prep: MatchPrep) => void, onBack?: () => void, onPlaybook?: () => void): void {
  document.getElementById('match-prep')?.remove();
  const host = document.createElement('div');
  host.id = 'match-prep';
  document.body.appendChild(host);

  let playStyle: PlayStyle = 'standard';
  let teamTalk: TeamTalk = 'calm';
  let leaderId: string = season.playerRoster[0]?.id ?? '';

  const render = (): void => {
    const { player, opp } = seasonRatings(season);
    const info = season.opponents[season.idx];
    const ratingPct = Math.round((player - opp) * 2);
    const styleDelta = STYLES.find((s) => s.id === playStyle)!.delta;
    const talkDelta = TALKS.find((t) => t.id === teamTalk)!.delta;
    const leaderDelta = leaderId ? LEADER_DELTA : 0;
    const pct = Math.max(10, Math.min(90, 50 + ratingPct + styleDelta + talkDelta + leaderDelta));
    const band = pct >= 60 ? 'good' : pct >= 45 ? 'even' : 'tough';
    const leaderName = season.playerRoster.find((u) => u.id === leaderId)?.name ?? '—';

    const factor = (label: string, d: number) =>
      d === 0 ? '' : `<div class="ne-factor"><span>${label}</span><span class="${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '+' : ''}${d}%</span></div>`;

    const styleBtns = STYLES.map((s) =>
      `<button class="mp-opt ${s.id === playStyle ? 'sel' : ''}" data-style="${s.id}"><b>${s.name}</b><span>${s.note}</span></button>`).join('');
    const talkBtns = TALKS.map((t) =>
      `<button class="mp-opt ${t.id === teamTalk ? 'sel' : ''}" data-talk="${t.id}"><b>${t.name}</b><span>${t.note}</span></button>`).join('');
    const leaderBtns = season.playerRoster.map((u) =>
      `<button class="mp-leader ${u.id === leaderId ? 'sel' : ''}" data-leader="${u.id}">${u.name}<small>${u.role}</small></button>`).join('');

    host.innerHTML = `
      <div class="mp-card">
        <div class="mp-header">
          <div class="mp-kicker">Match prep · match ${season.idx + 1} of ${season.K}</div>
          <h1>vs ${info?.name ?? 'the opponent'}</h1>
        </div>
        <div class="mp-body">
          <div class="mp-left">
            <div class="mp-h2h">
              <div class="mp-team"><div class="mp-team-label">Your squad</div><div class="mp-rating">${player.toFixed(1)}</div></div>
              <div class="mp-vs">vs<br><span class="mp-gap">${(player - opp >= 0 ? '+' : '') + (player - opp).toFixed(1)}</span></div>
              <div class="mp-team"><div class="mp-team-label">${info?.name ?? 'Opponent'}</div><div class="mp-rating">${opp.toFixed(1)}</div></div>
            </div>
            <div class="mp-scout">
              <div class="mp-scout-head">Scouting report</div>
              ${info ? `<div class="mp-lean">On attack they lean <strong>${prettyLean(info.atk.strategy, info.atk.site)}</strong>.</div>
              <div class="mp-lean">On defense they lean <strong>${prettyLean(info.def.strategy, info.def.site)}</strong>.</div>
              <div class="mp-scout-note">You'll pick the counter round by round once the match starts.</div>` : ''}
            </div>
          </div>
          <div class="net-effect ${band} mp-outlook">
            <div class="ne-head">Win outlook</div>
            <div class="ne-pct">${pct}<span class="ne-pctsign">%</span></div>
            <div class="ne-factors">
              ${factor(`Rating ${(player - opp >= 0 ? '+' : '') + (player - opp).toFixed(1)}`, ratingPct)}
              ${factor(`${STYLES.find((s) => s.id === playStyle)!.name} approach`, styleDelta)}
              ${factor(`Team talk: ${TALKS.find((t) => t.id === teamTalk)!.name}`, talkDelta)}
              ${factor(`${leaderName} leads`, leaderDelta)}
            </div>
            <div class="ne-note">Shifts with your calls below. The match is still decided round by round.</div>
          </div>
        </div>
        <div class="mp-decisions">
          <div class="mp-group"><div class="mp-group-label">How to play</div><div class="mp-opts">${styleBtns}</div></div>
          <div class="mp-group"><div class="mp-group-label">In-game leader</div><div class="mp-leaders">${leaderBtns}</div></div>
          <div class="mp-group"><div class="mp-group-label">Pre-match team talk</div><div class="mp-opts">${talkBtns}</div></div>
        </div>
        <div class="mp-actions">${onBack ? '<button class="btn-back" data-back type="button">&larr; Back</button>' : ''}${onPlaybook ? '<button class="btn-back" data-playbook type="button">📋 Playbook</button>' : ''}<button class="btn-primary" data-play type="button">Play match &rarr;</button></div>
      </div>`;

    host.querySelectorAll<HTMLButtonElement>('[data-style]').forEach((b) => b.addEventListener('click', () => { playStyle = b.getAttribute('data-style') as PlayStyle; render(); }));
    host.querySelectorAll<HTMLButtonElement>('[data-talk]').forEach((b) => b.addEventListener('click', () => { teamTalk = b.getAttribute('data-talk') as TeamTalk; render(); }));
    host.querySelectorAll<HTMLButtonElement>('[data-leader]').forEach((b) => b.addEventListener('click', () => { leaderId = b.getAttribute('data-leader') ?? leaderId; render(); }));
    host.querySelector<HTMLButtonElement>('[data-play]')?.addEventListener('click', () => {
      host.remove();
      onPlay({ playStyle, leaderId, teamTalk });
    });
    host.querySelector<HTMLButtonElement>('[data-back]')?.addEventListener('click', () => {
      host.remove();
      onBack?.();
    });
    host.querySelector<HTMLButtonElement>('[data-playbook]')?.addEventListener('click', () => {
      host.remove();
      onPlaybook?.();
    });
  };
  render();
}
