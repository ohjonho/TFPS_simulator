// Match Prep — the pre-match screen (after "Start the Season" / "Next match",
// before the rounds). Full scouting head-to-head + three match-level calls
// (play style, in-game leader, pre-match team talk) and a Win Outlook % that
// recalculates as you toggle them. On confirm it hands a MatchPrep to main.ts,
// which bakes it into the player roster for this match. Pure DOM.

import type { SeasonState, MatchPrep, PlayStyle, TeamTalk } from '../game/season.ts';
import { seasonRatings } from '../game/season.ts';
import type { MapDefinition } from '../game/types.ts';
import { buildSignaturePlays } from '../game/signaturePlays.ts';
import { strategyById } from '../game/strategies.ts';
import { scoutReadForCustom } from '../game/playbookCoach.ts';
import { attachUnitStatsPopover, hideUnitStatsPopover } from './unitStatsPopover.ts';

// The prep calls are TRADE-OFFS, not power-ups — each helps one way and costs
// another, so there's no single best pick. Notes describe the texture; the actual
// mechanical effect is applied in season.applyMatchPrep. (No win% deltas — the
// outlook is a coarse strength read, deliberately not moved by these choices.)
const STYLES: { id: PlayStyle; name: string; note: string }[] = [
  { id: 'cautious', name: 'Cautious', note: 'Protect the round — trade space for safety. Steadier as the underdog; cedes tempo to a passive defense.' },
  { id: 'standard', name: 'Standard', note: 'Balanced — no bias. Read the match and adapt round to round.' },
  { id: 'aggressive', name: 'Aggressive', note: 'Press the tempo — higher ceiling. Punishes passive holds, but a disciplined defense can trade you down.' },
];
const TALKS: { id: TeamTalk; name: string; note: string }[] = [
  { id: 'fire', name: 'Fire Up', note: 'More duels and first contact — and more exposure.' },
  { id: 'calm', name: 'Calm & Steady', note: 'Nerve for tight, last-alive rounds — at the cost of urgency.' },
  { id: 'focus', name: 'Focus Up', note: 'Your set plays run truer — less off-plan improvisation.' },
];

function prettyLean(strategy: string, site: 'A' | 'B' | null): string {
  return `${strategy.replace(/_/g, ' ')}${site ? ` ${site}` : ''}`;
}

export function showMatchPrep(season: SeasonState, map: MapDefinition, onPlay: (prep: MatchPrep) => void, onBack?: () => void, onPlaybook?: () => void): void {
  document.getElementById('match-prep')?.remove();
  const host = document.createElement('div');
  host.id = 'match-prep';
  document.body.appendChild(host);

  // B2.4 — resolve the opponent's leans against the measured matrix. A signature
  // (custom) lean shows its real name + the counter from its measured matchup
  // (one source of truth with the in-match Scout), instead of a raw id. Builtin
  // leans keep the simple prettyLean label. Keeps the read qualitative — the Win
  // Outlook % stays a team-strength estimate, decided round by round.
  const sigs = buildSignaturePlays(map);
  const leanText = (lean: { strategy: string; site: 'A' | 'B' | null }): string => {
    const sig = sigs.find((s) => s.id === lean.strategy);
    const siteTxt = lean.site ? ` ${lean.site}` : '';
    if (!sig) return `<strong>${prettyLean(lean.strategy, lean.site)}</strong>`;
    const read = scoutReadForCustom(sig);
    const counterSide = sig.side === 'attacker' ? 'defender' : 'attacker';
    const cName = read ? (strategyById(read.counterId, counterSide, map)?.name ?? read.counterId) : null;
    return `<strong>${sig.name}${siteTxt}</strong> — their signature${cName ? `; counter with <strong>${cName}</strong>` : ''}`;
  };

  let playStyle: PlayStyle = 'standard';
  let teamTalk: TeamTalk = 'calm';
  let leaderId: string = season.playerRoster[0]?.id ?? '';

  const render = (): void => {
    const { player, opp } = seasonRatings(season);
    const info = season.opponents[season.idx];
    const gap = player - opp;
    // Coarse outlook from team STRENGTH only — deliberately not moved by the prep
    // calls below, so there's no number to min-max. It's a read, not a forecast.
    const band = gap >= 2.5 ? 'good' : gap <= -2.5 ? 'tough' : 'even';
    const outlookWord = band === 'good' ? 'Favored' : band === 'tough' ? 'Tough' : 'Even';
    const outlookSub = band === 'good' ? 'Stronger on paper — but nothing’s decided yet.'
      : band === 'tough' ? 'Underdogs on paper — out-read them round by round.'
      : 'Evenly matched — the calls and the reads will decide it.';

    const styleBtns = STYLES.map((s) =>
      `<button class="mp-opt ${s.id === playStyle ? 'sel' : ''}" data-style="${s.id}"><b>${s.name}</b><span>${s.note}</span></button>`).join('');
    const talkBtns = TALKS.map((t) =>
      `<button class="mp-opt ${t.id === teamTalk ? 'sel' : ''}" data-talk="${t.id}"><b>${t.name}</b><span>${t.note}</span></button>`).join('');
    const leaderBtns = season.playerRoster.map((u) =>
      `<button class="mp-leader ${u.id === leaderId ? 'sel' : ''}" data-leader="${u.id}">${u.name}<small>${u.role}</small></button>`).join('');
    // Playbook is locked for the very first match (onboarding) — adapt/author opens in week 2.
    const playbookBtn = !onPlaybook ? ''
      : season.idx === 0
        ? '<button class="btn-back" type="button" disabled title="Custom plays unlock after your first match">📋 Playbook</button>'
        : '<button class="btn-back" data-playbook type="button">📋 Playbook</button>';

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
              ${info ? `<div class="mp-lean">On attack they lean ${leanText(info.atk)}.</div>
              <div class="mp-lean">On defense they lean ${leanText(info.def)}.</div>
              <div class="mp-scout-note">You'll pick the counter round by round once the match starts.</div>` : ''}
            </div>
          </div>
          <div class="net-effect ${band} mp-outlook">
            <div class="ne-head">Outlook</div>
            <div class="ne-band">${outlookWord}</div>
            <div class="ne-note">${outlookSub}</div>
          </div>
        </div>
        <div class="mp-decisions">
          <div class="mp-group"><div class="mp-group-label">How to play</div><div class="mp-opts">${styleBtns}</div></div>
          <div class="mp-group"><div class="mp-group-label">In-game leader <small>(your shotcaller — their Leadership lifts the whole squad)</small></div><div class="mp-leaders">${leaderBtns}</div></div>
          <div class="mp-group"><div class="mp-group-label">Pre-match team talk</div><div class="mp-opts">${talkBtns}</div></div>
        </div>
        <div class="mp-actions">${onBack ? '<button class="btn-back" data-back type="button">&larr; Back</button>' : ''}${playbookBtn}<button class="btn-primary" data-play type="button">Play match &rarr;</button></div>
      </div>`;

    host.querySelectorAll<HTMLButtonElement>('[data-style]').forEach((b) => b.addEventListener('click', () => { playStyle = b.getAttribute('data-style') as PlayStyle; render(); }));
    host.querySelectorAll<HTMLButtonElement>('[data-talk]').forEach((b) => b.addEventListener('click', () => { teamTalk = b.getAttribute('data-talk') as TeamTalk; render(); }));
    host.querySelectorAll<HTMLButtonElement>('[data-leader]').forEach((b) => {
      b.addEventListener('click', () => { leaderId = b.getAttribute('data-leader') ?? leaderId; render(); });
      const u = season.playerRoster.find((x) => x.id === b.getAttribute('data-leader'));
      if (u) attachUnitStatsPopover(b, u); // hover → that player's stats
    });
    const leave = (fn?: () => void) => { hideUnitStatsPopover(); host.remove(); fn?.(); };
    host.querySelector<HTMLButtonElement>('[data-play]')?.addEventListener('click', () => leave(() => onPlay({ playStyle, leaderId, teamTalk })));
    host.querySelector<HTMLButtonElement>('[data-back]')?.addEventListener('click', () => leave(onBack));
    host.querySelector<HTMLButtonElement>('[data-playbook]')?.addEventListener('click', () => leave(onPlaybook));
  };
  render();
}
