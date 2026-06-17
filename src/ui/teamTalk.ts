// Post-draft team talk — the player's first words to the squad. One prompt, three
// choices, each setting the club's early identity (a small season-long lean). Full
// -page overlay (like the welcome screen); removed on choice. Pure DOM.

import type { ClubLean } from '../game/season.ts';

type Choice = { lean: ClubLean; title: string; quote: string; effect: string };

const CHOICES: Choice[] = [
  {
    lean: 'aggressive',
    title: 'We hunt',
    quote: '"We don\'t wait to get punched. We take the duel, we take the space, we make them react to us."',
    effect: 'Players push harder and take more fights — all season.',
  },
  {
    lean: 'disciplined',
    title: 'Trust the plan',
    quote: '"Everyone has a job. You hold your angle, you run the call, and we win as a unit — no heroes."',
    effect: 'Players stick to the called strategy more reliably under fire.',
  },
  {
    lean: 'composed',
    title: 'Stay cool',
    quote: '"Tight rounds are won by the calmest team on the server. Breathe. We\'ve done the work."',
    effect: 'Players hold their nerve in clutch, last-alive moments.',
  },
];

export function showTeamTalk(onChoose: (lean: ClubLean) => void): void {
  document.getElementById('team-talk')?.remove();
  const host = document.createElement('div');
  host.id = 'team-talk';
  host.innerHTML = `
    <div class="tt-card">
      <div class="tt-header">
        <div class="tt-kicker">First team meeting</div>
        <h1>Set the tone</h1>
        <p class="tt-sub">Your squad is drafted and the room goes quiet. Five players, one season, the shop on the line. What's the message?</p>
      </div>
      <div class="tt-choices">
        ${CHOICES.map((c, i) => `
          <button class="tt-choice" data-lean="${i}" type="button">
            <div class="tt-title">${c.title}</div>
            <div class="tt-quote">${c.quote}</div>
            <div class="tt-effect">${c.effect}</div>
          </button>`).join('')}
      </div>
      <p class="tt-note">This sets your club's early identity. You can lean into it (or against it) as the season unfolds.</p>
    </div>`;
  document.body.appendChild(host);
  host.querySelectorAll<HTMLButtonElement>('.tt-choice').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-lean') ?? '0', 10);
      host.remove();
      onChoose(CHOICES[idx]?.lean ?? 'disciplined');
    });
  });
}
