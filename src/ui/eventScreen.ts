// Phase 4 — the generic event screen. Renders ANY SeasonEvent (kicker / headline /
// body, with {player} filled, plus optional choice buttons) as a full-page overlay,
// so new events are pure data. After a choice (or Continue on a no-choice event)
// it shows a small "what changed" effect summary, then calls back with the chosen
// choice index (or null).

import type { SeasonEvent } from '../game/events/types.ts';
import { effectChipsHtml } from './effectChips.ts';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function fill(text: string, subjectName: string | null): string {
  return text.replace(/\{player\}/g, subjectName ? `<strong>${esc(subjectName)}</strong>` : 'a player');
}

export function showEventScreen(event: SeasonEvent, subjectName: string | null, extra: readonly string[], onChoose: (choiceIdx: number | null) => void): void {
  document.getElementById('event-screen')?.remove();
  const host = document.createElement('div');
  host.id = 'event-screen';
  host.className = 'dashboard'; // reuse the full-page overlay layout
  document.body.appendChild(host);

  const asides = extra.map((t) => `<p class="dash-sub ev-aside">${fill(t, subjectName)}</p>`).join('');
  const header = `
    <div class="dash-header">
      <div class="dash-kicker">${esc(event.kicker)}</div>
      <h1>${fill(event.headline, subjectName)}</h1>
      <p class="dash-sub">${fill(event.body, subjectName)}</p>
      ${asides}
    </div>`;

  const finish = (idx: number | null): void => { host.remove(); onChoose(idx); };

  // The "what changed" resolution screen — body + the effect chips + Continue.
  const showResolution = (idx: number | null): void => {
    const effects = idx != null && event.choices ? event.choices[idx].effects : (event.effects ?? []);
    if (effects.length === 0) { finish(idx); return; }
    host.innerHTML = `<div class="dash-card">${header}${effectChipsHtml(effects, subjectName)}
      <div class="dash-actions"><button class="btn-primary" data-continue type="button">Continue &rarr;</button></div></div>`;
    host.querySelector<HTMLButtonElement>('[data-continue]')?.addEventListener('click', () => finish(idx));
  };

  const hasChoices = !!event.choices && event.choices.length > 0;
  if (hasChoices) {
    host.innerHTML = `<div class="dash-card">${header}
      <div class="ev-choices">${event.choices!.map((c, i) =>
        `<button class="ev-choice" data-choice="${i}" type="button"><b>${esc(c.label)}</b>${c.note ? `<span>${esc(c.note)}</span>` : ''}</button>`).join('')}</div></div>`;
    host.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((b) =>
      b.addEventListener('click', () => showResolution(parseInt(b.getAttribute('data-choice') ?? '0', 10))));
  } else {
    host.innerHTML = `<div class="dash-card">${header}
      <div class="dash-actions"><button class="btn-primary" data-continue type="button">Continue &rarr;</button></div></div>`;
    host.querySelector<HTMLButtonElement>('[data-continue]')?.addEventListener('click', () => showResolution(null));
  }
}
