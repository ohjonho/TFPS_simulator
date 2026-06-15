// Pre-round Scout — surfaces the ENEMY team's strategy tendencies from the
// cross-round pick history (state.strategyLean) so the player's pre-round pick is
// a READ, not a gamble. Qualitative leans only (a poker range, never odds), and
// the read can't lie: it reflects the same picks the enemy actually made this
// match. Round 1 (no history) → an onboarding line. Feeds off the always-on
// strategyLean store recorded in match.applyStrategies.

import type { GameState, Team } from '../game/types.ts';
import { strategiesFor, strategyById } from '../game/strategies.ts';

// One-line "tell" + a read-based (not odds-based) counter hint per strategy.
const TELLS: Record<string, { tell: string; counter: string }> = {
  // Attacker archetypes
  Rush:                 { tell: 'fast, all-in floods onto one site', counter: 'a set, stacked hold trades the flood down' },
  Control:              { tell: 'slow — takes space, then commits the lighter site', counter: 'commit a site early, before they read it' },
  Execute:              { tell: 'controlled breach through one entry', counter: 'stack the entry and hold the crossfire' },
  Mind_Games:           { tell: 'fakes and misdirects — baits a commit', counter: "stay flexible; don't over-rotate to the first show" },
  // Defender archetypes
  Hold:                 { tell: 'balanced split across both sites', counter: 'overwhelm one site or take map control' },
  Stack:                { tell: 'stacks one site heavy', counter: 'hit the other site (or fake the stack)' },
  Pressure:             { tell: 'pushes mid off spawn — expect early contact', counter: 'hold mid angles, then fall to site' },
  Coordinated_Lockdown: { tell: 'locks all five on one site', counter: 'take the open site' },
  Rotate_Stack:         { tell: 'rotates between sites on contact', counter: 'fast, direct hits beat the rotation' },
  Mid_Control:          { tell: 'central garrison, collapses onto contact', counter: 'split the collapse or take space' },
};

// First-encounter onboarding: the first time the player meets the Scout with no
// read yet, explain the counter-web (strategy is a read, not a coin flip). Marked
// "seen" once they've watched a real read appear, so it shows for the whole first
// encounter, then reverts to the brief line. localStorage = UI-only, no game state.
const ONBOARDING_KEY = 'tfps.scoutOnboardingSeen';
function onboardingSeen(): boolean {
  try { return localStorage.getItem(ONBOARDING_KEY) === '1'; } catch { return false; }
}
function markOnboardingSeen(): void {
  try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch { /* storage unavailable — fine */ }
}

export function scoutReportHtml(state: GameState): string {
  if (state.phase !== 'planning') return '';
  const enemy: Team = state.playerTeam === 'defenders' ? 'attackers' : 'defenders';
  const enemySide = state.teamSide[enemy];
  const sideLabel = enemySide === 'attacker' ? 'attacking' : 'defending';

  // Pick history for the enemy, restricted to strategies they can run on their
  // CURRENT side (so a pre-halftime, other-side history doesn't leak in).
  const lean = state.strategyLean[enemy] ?? {};
  const poolIds = new Set(strategiesFor(enemySide, state.map).map((s) => s.id));
  const entries = Object.entries(lean)
    .filter(([id]) => poolIds.has(id))
    .map(([id, w]) => ({ id, w }))
    .sort((a, b) => b.w - a.w);
  const total = entries.reduce((a, e) => a + e.w, 0);

  if (total === 0 || entries.length === 0) {
    if (!onboardingSeen()) {
      return `<div class="scout">
      <div class="scout-head">Scout — reading the opponent</div>
      <div class="scout-body">
        <div class="scout-onboard">This isn't a coin flip: <strong>every strategy beats some and loses to others</strong>, so the best pick depends on what your opponent favors.</div>
        <div class="scout-onboard">I track what the enemy keeps choosing and show their lean here — read it, then pick the counter. No read yet; make your call and I'll start building one.</div>
      </div>
    </div>`;
    }
    return `<div class="scout">
      <div class="scout-head">Scout — enemy ${sideLabel}</div>
      <div class="scout-body"><div class="scout-empty">First encounter — no tendencies yet. The Scout builds a read as the match unfolds.</div></div>
    </div>`;
  }

  const top = entries[0];
  const share = Math.round((top.w / total) * 100);
  const name = strategyById(top.id, enemySide, state.map)?.name ?? top.id;
  const conf = share >= 60 ? 'strongly favors' : share >= 40 ? 'tends toward' : 'leans (mixed looks) to';
  const t = TELLS[top.id];

  const rows: string[] = [
    `<div class="scout-lean">${name} <span class="scout-share">— ${conf}, ${share}% of recent picks</span></div>`,
  ];
  if (t) {
    rows.push(`<div class="scout-tell"><span class="scout-tag">tell</span> ${t.tell}</div>`);
    rows.push(`<div class="scout-counter"><span class="scout-tag">counter</span> ${t.counter}</div>`);
  }
  if (entries.length > 1 && entries[1].w / total >= 0.2) {
    const n2 = strategyById(entries[1].id, enemySide, state.map)?.name ?? entries[1].id;
    rows.push(`<div class="scout-alt">also shown: ${n2}</div>`);
  }

  markOnboardingSeen(); // a real read has appeared — the counter-web explainer is consumed
  return `<div class="scout">
    <div class="scout-head">Scout — enemy ${sideLabel}</div>
    <div class="scout-body">${rows.join('')}</div>
  </div>`;
}
