// Campaign welcome — a brief orientation between the team meeting and the first
// week: a hero line and the shape of a week, then into the season. The heavy
// teaching now lives in the guided tours (the draft board + the first match) and the
// guidebook, so this stays short. Replays each campaign; skipped when tutorials off.

import { tutorialsOn } from './tutorialPrefs.ts';

const HOST_ID = 'welcome-screen';

export function showWelcome(onContinue: () => void, onBack?: () => void): void {
  if (!tutorialsOn()) { onContinue(); return; } // tutorials off → straight to the week
  document.getElementById(HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.innerHTML = `
    <div class="welcome-card">
      <div class="welcome-header">
        <div class="welcome-kicker">Welcome, Coach</div>
        <h1>Your squad is set</h1>
        <p class="welcome-sub">Five players, one season, one shot to win the circuit and save Pixel Perfect. Here's the shape of a week.</p>
      </div>
      <div class="welcome-firststeps">
        <div class="wt-title">Your week, every week</div>
        <ol>
          <li><strong>Training day</strong> — drill the squad, spend League Points to sharpen them.</li>
          <li><strong>Match day</strong> — read the opponent's tape, pick your counters round by round.</li>
          <li><strong>Climb the table</strong> — finish top four to reach the playoffs, then win it all.</li>
        </ol>
      </div>
      <div class="welcome-actions">
        ${onBack ? '<button class="btn-back" data-back type="button">&larr; Back</button>' : ''}
        <button class="btn-primary" data-continue type="button">Start the season &rarr;</button>
      </div>
    </div>`;
  document.body.appendChild(host);
  host.querySelector<HTMLButtonElement>('[data-continue]')?.addEventListener('click', () => { host.remove(); onContinue(); });
  host.querySelector<HTMLButtonElement>('[data-back]')?.addEventListener('click', () => { host.remove(); onBack?.(); });
}
