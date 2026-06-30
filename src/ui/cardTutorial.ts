// Pre-draft tutorial — "how to read a player card" + one enlarged example card,
// shown after the pre-draft team beat and before the draft screen. Reuses the
// draft legend + the pool-card renderer so it matches the real draft exactly.

import { generatePool } from '../game/draft.ts';
import { createRng } from '../game/rng.ts';
import { draftCardLegendHtml } from './draftHelpModal.ts';
import { poolCardHtml } from './draftPanel.ts';

export function showCardTutorial(onDone: () => void, onBack?: () => void): void {
  document.getElementById('card-tutorial')?.remove();
  const host = document.createElement('div');
  host.id = 'card-tutorial';
  host.className = 'dashboard'; // reuse the full-page overlay layout
  document.body.appendChild(host);

  // A representative example card (fixed seed → stable, illustrative only).
  const example = generatePool(createRng(0xC0FFEE), 1)[0];

  host.innerHTML = `
    <div class="dash-card">
      <div class="dash-header">
        <div class="dash-kicker">Tryouts · scouting the talent</div>
        <h1>How to read a player card</h1>
        <p class="dash-sub">In a moment you'll pick five from the tryout pool. Every card tells you how that player fights — here's what to look for.</p>
      </div>
      <div class="ct-legend">${draftCardLegendHtml()}</div>
      <h2 class="dash-section">Example</h2>
      <div class="ct-example">${poolCardHtml(example, null, 'defenders', true)}</div>
      <div class="dash-actions">
        ${onBack ? '<button class="btn-back" data-back type="button">&larr; Back</button>' : ''}
        <button class="btn-primary" data-go type="button">Draft your team &rarr;</button>
      </div>
    </div>`;

  host.querySelector<HTMLButtonElement>('[data-go]')?.addEventListener('click', () => { host.remove(); onDone(); });
  host.querySelector<HTMLButtonElement>('[data-back]')?.addEventListener('click', () => { host.remove(); onBack?.(); });
}
