// Phase 4b — the mid-season departure + redraft screen. A leaving player says
// goodbye, then you sign a replacement from the reserve (the Origin characters you
// passed on at the draft). Two full-page steps; calls back with the picked id.

import type { CharacterDef } from '../game/story/characters.ts';
import type { Unit } from '../game/types.ts';

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

export function showRedraft(
  departing: Unit | null,
  reserve: readonly CharacterDef[],
  reason: string | undefined,
  onPick: (characterId: string) => void,
): void {
  document.getElementById('redraft-screen')?.remove();
  const host = document.createElement('div');
  host.id = 'redraft-screen';
  host.className = 'dashboard';
  document.body.appendChild(host);

  const name = departing?.name ?? 'A player';
  const goodbye = `
    <div class="dash-card">
      <div class="dash-header">
        <div class="dash-kicker">Roster move</div>
        <h1>${esc(name)} is moving on</h1>
        <p class="dash-sub">${reason ? esc(reason) : `${esc(name)} is leaving the squad. A seat's just opened up — and it won't fill itself.`}</p>
      </div>
      <div class="dash-actions"><button class="btn-primary" data-next type="button">Find a replacement &rarr;</button></div>
    </div>`;

  const card = (c: CharacterDef): string => `
    <button class="ev-choice redraft-card" data-pick="${esc(c.id)}" type="button">
      <b>${esc(c.username)}</b>
      <span>${esc(c.role)} · ${esc(c.hero)} · ${esc(c.weapon)}</span>
      <span>${esc(c.bio)}</span>
    </button>`;
  const board = `
    <div class="dash-card">
      <div class="dash-header">
        <div class="dash-kicker">Sign a replacement</div>
        <h1>Who fills the seat?</h1>
        <p class="dash-sub">A few regulars who didn't make your first cut are still around. Bring one in — they join fresh, quirks and all.</p>
      </div>
      <div class="ev-choices">${reserve.map(card).join('')}</div>
    </div>`;

  const showBoard = (): void => {
    host.innerHTML = board;
    host.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) =>
      b.addEventListener('click', () => { const id = b.getAttribute('data-pick') ?? ''; host.remove(); onPick(id); }));
  };

  host.innerHTML = goodbye;
  host.querySelector<HTMLButtonElement>('[data-next]')?.addEventListener('click', showBoard);
}
