// Phase 3e — the generic ARC BEAT screen. Renders any ArcBeat (kicker / headline /
// body with {player} filled, + persona/record asides, + choice buttons or a
// Continue) as a full-page overlay, mirroring the ambient event screen. After a
// choice it shows a "what changed" resolution (the effect chips), then calls back.
// `onResolve(idx)` applies the beat (the caller advances the arc) and returns the
// effects to display; `onDone(idx)` continues the week loop.

import type { ArcBeat } from '../game/story/arcTypes.ts';
import type { Effect, PersonalityId } from '../game/events/types.ts';
import type { Unit } from '../game/types.ts';
import { recordForm } from '../game/events/runtime.ts';
import { effectChipsHtml } from './effectChips.ts';

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function fill(text: string, subjectName: string | null): string {
  return text.replace(/\{player\}/g, subjectName ? `<strong>${esc(subjectName)}</strong>` : 'a player');
}

// Persona aside (by the subject's personality) then a form aside — same shape as
// the ambient events' eventFlavor. Each may still contain {player}.
export function arcFlavor(beat: ArcBeat, subject: Unit | null, results: readonly ('W' | 'L')[]): string[] {
  const out: string[] = [];
  const p = subject?.personality as PersonalityId | null | undefined;
  if (beat.persona && p && beat.persona[p]) out.push(beat.persona[p]!);
  if (beat.record) { const line = beat.record[recordForm(results)]; if (line) out.push(line); }
  return out;
}

export function showArcBeat(
  beat: ArcBeat,
  subjectName: string | null,
  extra: readonly string[],
  flags: Record<string, string>,
  onResolve: (choiceIdx: number | null) => readonly Effect[],
  onDone: (choiceIdx: number | null) => void,
): void {
  document.getElementById('arc-beat-screen')?.remove();
  const host = document.createElement('div');
  host.id = 'arc-beat-screen';
  host.className = 'dashboard'; // reuse the full-page overlay layout
  document.body.appendChild(host);

  const asides = extra.map((t) => `<p class="dash-sub ev-aside">${fill(t, subjectName)}</p>`).join('');
  const header = `
    <div class="dash-header">
      <div class="dash-kicker">${esc(beat.kicker)}</div>
      <h1>${fill(beat.headline, subjectName)}</h1>
      <p class="dash-sub">${fill(beat.body, subjectName)}</p>
      ${asides}
    </div>`;

  const finish = (idx: number | null): void => { host.remove(); onDone(idx); };

  const showResolution = (idx: number | null): void => {
    const effects = onResolve(idx); // caller applies the beat + returns what changed
    if (!effects || effects.length === 0) { finish(idx); return; }
    host.innerHTML = `<div class="dash-card">${header}${effectChipsHtml(effects, subjectName)}
      <div class="dash-actions"><button class="btn-primary" data-continue type="button">Continue &rarr;</button></div></div>`;
    host.querySelector<HTMLButtonElement>('[data-continue]')?.addEventListener('click', () => finish(idx));
  };

  // Only choices whose requiresFlag (if any) is set are offered; original indices kept.
  const shown = (beat.choices ?? []).map((c, i) => ({ c, i })).filter(({ c }) => !c.requiresFlag || !!flags[c.requiresFlag]);
  if (shown.length > 0) {
    host.innerHTML = `<div class="dash-card">${header}
      <div class="ev-choices">${shown.map(({ c, i }) =>
        `<button class="ev-choice" data-choice="${i}" type="button"><b>${esc(c.label)}</b>${c.note ? `<span>${esc(c.note)}</span>` : ''}</button>`).join('')}</div></div>`;
    host.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((b) =>
      b.addEventListener('click', () => showResolution(parseInt(b.getAttribute('data-choice') ?? '0', 10))));
  } else {
    host.innerHTML = `<div class="dash-card">${header}
      <div class="dash-actions"><button class="btn-primary" data-continue type="button">Continue &rarr;</button></div></div>`;
    host.querySelector<HTMLButtonElement>('[data-continue]')?.addEventListener('click', () => showResolution(null));
  }
}
