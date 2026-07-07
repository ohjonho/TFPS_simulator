// Post-match review — a broadcast-style two-beat wrap on a finished match, replacing
// the old match-end modal:
//   1. PLAYER OF THE GAME — the match's top performer (either team; often the
//      opponent's on a loss), with their headline stats.
//   2. MATCH ANALYSIS — the result, a round-by-round strip, a short qualitative read
//      from your analyst (Remi once he's aboard, else Sam), the full scoreboard, and
//      the management follow-up (LP / morale / standing).
// Pure DOM over the finished GameState + pre-formatted season lines from the caller.

import type { GameState, Team } from '../game/types.ts';
import { computeMatchStats, matchMvpUnit, type MatchStats } from '../game/stats.ts';
import { renderMatchEndScoreboard, STAT_TIPS } from './matchEndScoreboard.ts';
import { castVisual, silhouetteSvg } from './characterVisual.ts';

const HOST_ID = 'post-match-review';

export type PostMatchOpts = {
  playerWon: boolean;
  seasonLines: readonly string[]; // pre-built LP / morale / standing lines (empty for exhibition)
  analyst: 'remi' | 'sam';        // who gives the read (Remi once he's aboard)
  playoffLabel?: string;          // "Semifinal" / "Final" — a playoff match instead of a league one
};

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function oppOf(state: GameState): Team { return state.playerTeam === 'defenders' ? 'attackers' : 'defenders'; }

// --- Screen 1: Player of the Game ------------------------------------------
function mvpScreen(state: GameState, stats: Record<string, MatchStats>): string {
  const mvp = matchMvpUnit(state);
  if (!mvp) return `<div class="pmr-mvp"><div class="pmr-title">Player of the Game</div><p class="pmr-sub">No standout this time.</p><button class="btn-primary" data-next type="button">Continue &rarr;</button></div>`;
  const s = stats[mvp.id];
  const { tint } = castVisual(mvp.characterId ?? mvp.id);
  const mine = mvp.team === state.playerTeam;
  const stat = (label: string, val: string, tip: string): string => `<div class="pmr-stat" title="${tip}"><div class="pmr-stat-v">${val}</div><div class="pmr-stat-l">${label}</div></div>`;
  return `
    <div class="pmr-mvp">
      <div class="pmr-title">Player of the Game</div>
      <div class="pmr-mvp-card" style="--tint:${tint}">
        <div class="pmr-mvp-portrait">${silhouetteSvg(tint)}</div>
        <div class="pmr-mvp-info">
          <div class="pmr-mvp-name">${esc(mvp.name)}</div>
          <div class="pmr-mvp-team">${mine ? 'Your squad' : 'Opponent'} · ${esc(mvp.role)} · ${esc(mvp.weapon)}</div>
          <div class="pmr-mvp-stats">
            ${stat('K / D / A', `${s.kills} / ${s.deaths} / ${s.assists}`, STAT_TIPS.kda)}
            ${stat('ACS', String(s.acs), STAT_TIPS.acs)}
            ${stat('ADR', String(s.adr), STAT_TIPS.adr)}
            ${stat('aKAST', s.akast.toFixed(2), STAT_TIPS.akast)}
            ${stat('HS%', `${s.hsPct}%`, STAT_TIPS.hs)}
          </div>
        </div>
      </div>
      <button class="btn-primary" data-next type="button">Match analysis &rarr;</button>
    </div>`;
}

const prettyStrat = (s: string | null): string => (s ? s.replace(/_/g, ' ') : '—');

// --- Round-by-round strip (player perspective, running score). Numbered 1..N by
// position; hover shows the strategies picked that round + the running score. ------
function roundStrip(state: GameState): string {
  // Per-round strategy picks (from the strategyPick markers) for the hover tooltip.
  const picks = new Map<number, { player: string | null; ai: string | null }>();
  for (const e of state.events) {
    if (e.type === 'strategyPick') picks.set(e.roundIndex, { player: e.playerStrategy, ai: e.aiStrategy });
  }
  const results = state.events
    .filter((e) => e.type === 'roundResult' && typeof e.roundIndex === 'number')
    .sort((a, b) => (a.roundIndex ?? 0) - (b.roundIndex ?? 0));
  let df = 0; let at = 0;
  const cells = results.map((r, i) => {
    const ri = r.roundIndex ?? 0;
    const winner = (r as { winner?: Team | 'draw' }).winner;
    if (winner === 'defenders') df++; else if (winner === 'attackers') at++;
    const won = winner === state.playerTeam;
    const ps = state.playerTeam === 'defenders' ? df : at;
    const os = state.playerTeam === 'defenders' ? at : df;
    const p = picks.get(ri);
    const strat = p ? ` — You: ${prettyStrat(p.player)}  vs  Them: ${prettyStrat(p.ai)}` : '';
    return `<div class="pmr-round ${won ? 'won' : 'lost'}" title="Round ${i + 1}${strat}   (${ps}–${os})">${i + 1}</div>`;
  }).join('');
  return `<div class="pmr-rounds">${cells}</div>`;
}

// --- The analyst's qualitative read -----------------------------------------
function analystRead(state: GameState, opts: PostMatchOpts): string[] {
  const mvp = matchMvpUnit(state);
  const ps = state.scores[state.playerTeam];
  const os = state.scores[oppOf(state)];
  const mvpName = mvp?.name ?? 'nobody in particular';
  const mvpMine = !!mvp && mvp.team === state.playerTeam;
  const out: string[] = [];
  if (opts.playerWon) {
    if (os <= 1) out.push(`Dominant, wire to wire. That was a statement — they never got a foothold.`);
    else if (os === 2) out.push(`Job done. A couple of loose rounds to tidy up, but you were the better side.`);
    else out.push(`A proper nail-biter — you edged it ${ps}–${os}. Held your nerve when it mattered.`);
    out.push(mvpMine ? `${mvpName} led the way — that's a carry performance.` : `Credit ${mvpName} on their side, but the win's ours.`);
  } else {
    if (ps <= 1) out.push(`Rough one. They had our number today — we barely got going.`);
    else if (ps === 2) out.push(`Competitive, but they were sharper in the key rounds. Close, not close enough.`);
    else out.push(`Agonizing — ${os}–${ps} the wrong way. A round here or there and that's ours.`);
    out.push(mvpMine ? `${mvpName} did everything they could — not enough help around them.` : `${mvpName} was the difference for them. We'll have answers next time.`);
  }
  return out;
}

function analysisScreen(state: GameState, opts: PostMatchOpts): string {
  const ps = state.scores[state.playerTeam];
  const os = state.scores[oppOf(state)];
  const resultWord = opts.playerWon ? 'VICTORY' : 'DEFEAT';
  const analystName = opts.analyst === 'remi' ? 'Remi' : 'Sam';
  const read = analystRead(state, opts).map((l) => `<p>${esc(l)}</p>`).join('');
  const seasonLines = opts.seasonLines.length
    ? `<div class="pmr-season">${opts.seasonLines.map((l) => `<div>${l}</div>`).join('')}</div>` : '';
  return `
    <div class="pmr-analysis">
      <div class="pmr-result ${opts.playerWon ? 'win' : 'loss'}">
        ${opts.playoffLabel ? `<div class="pmr-result-stage">${esc(opts.playoffLabel)}</div>` : ''}
        <div class="pmr-result-word">${resultWord}</div>
        <div class="pmr-score">${ps} <span>–</span> ${os}</div>
      </div>
      ${roundStrip(state)}
      <div class="pmr-analyst">
        <div class="pmr-analyst-head">📊 ${analystName}'s read</div>
        <div class="pmr-analyst-body">${read}</div>
      </div>
      ${seasonLines}
      <div class="pmr-scoreboard">${renderMatchEndScoreboard(state)}</div>
      <div class="pmr-actions">
        <button class="btn-back" data-back type="button">&larr; Player of the Game</button>
        <button class="btn-primary" data-done type="button">Continue &rarr;</button>
      </div>
    </div>`;
}

export function showPostMatchReview(state: GameState, opts: PostMatchOpts, onDone: () => void): void {
  document.getElementById(HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = HOST_ID;
  document.body.appendChild(host);
  const stats = computeMatchStats(state.events, state.units);

  const renderMvp = (): void => {
    host.innerHTML = `<div class="pmr-stage pmr-stage-mvp">${mvpScreen(state, stats)}</div>`;
    host.querySelector<HTMLButtonElement>('[data-next]')?.addEventListener('click', renderAnalysis);
  };
  const renderAnalysis = (): void => {
    host.innerHTML = `<div class="pmr-stage pmr-stage-analysis">${analysisScreen(state, opts)}</div>`;
    host.querySelector<HTMLButtonElement>('[data-back]')?.addEventListener('click', renderMvp);
    host.querySelector<HTMLButtonElement>('[data-done]')?.addEventListener('click', () => { host.remove(); onDone(); });
  };
  renderMvp();
}
