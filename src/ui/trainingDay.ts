// Training day — the first beat of each week (Part 6 meta-loop). Placeholder for
// now: the week structure is in place, but the four training tracks (Aim ·
// Strategy & Tactics · Team-Building · Set-Pieces), the focus-one-player call,
// and the breakpoint unlocks land in a later phase. Until then it just rolls the
// week forward — no roster change, so matches stay byte-identical.

import { showModal } from './modal.ts';

export function showTrainingDay(week: number, onContinue: () => void, onBack?: () => void): void {
  const body = `
    <div class="season-intro">
      <p><strong>Week ${week} · Training day.</strong> The squad files into the practice server, headsets on.</p>
      <p style="color:#8a92a3;">Training options — <em>Aim</em>, <em>Strategy &amp; Tactics</em>, <em>Team-Building</em>, and <em>Set-Pieces</em> — plus the choice to focus one player, are coming in a future update. For now the week simply rolls forward.</p>
    </div>`;
  showModal(`Week ${week} — Training`, body, [
    ...(onBack ? [{ label: 'Back', onClick: onBack }] : []),
    { label: 'To the match week →', primary: true, onClick: onContinue },
  ]);
}
