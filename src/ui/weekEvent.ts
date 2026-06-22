// Week event — the pre-match and post-match story/locker-room beats (Part 6
// meta-loop). Placeholder for now: it surfaces the week's pacing roll (Structured
// vs Random — see buildWeekEventModes) and whether it's the pre- or post-match
// slot, but carries no stat effect yet, so matches stay byte-identical. The
// 8-template event grammar + the result-reactive post-match family land in a
// later phase.

import { showModal } from './modal.ts';

export function showWeekEvent(week: number, kind: 'pre' | 'post', mode: 'S' | 'R', onContinue: () => void): void {
  const when = kind === 'pre' ? 'Before the match' : 'After the match';
  const flavor = mode === 'S'
    ? (kind === 'pre'
        ? 'A scripted build-up beat will set the stakes for this week.'
        : 'A result-reactive aftermath beat will respond to how the match went.')
    : 'A randomized locker-room event will roll here.';
  const body = `
    <div class="season-intro">
      <p><strong>Week ${week} · ${when}.</strong></p>
      <p style="color:#8a92a3;">Event placeholder — ${flavor} Full event content (and the choices that come with it) arrives in a future update.</p>
    </div>`;
  showModal(`Week ${week} — Event`, body, [
    { label: 'Continue', primary: true, onClick: onContinue },
  ]);
}
