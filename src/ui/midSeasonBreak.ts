// Mid-season break — fires once, after the fourth week, between the two halves
// of the season (Part 6 meta-loop). Placeholder for now: a breather and a nod
// that the league is starting to take notice. A larger story beat (and a visible
// step up in opponent sharpness) will live here in a future phase.

import { showModal } from './modal.ts';

export function showMidSeasonBreak(week: number, onContinue: () => void): void {
  const body = `
    <div class="season-intro">
      <p><strong>Mid-season break.</strong> Four weeks down, four to go. The circuit pauses to catch its breath — and the other managers have started swapping notes about your run.</p>
      <p style="color:#8a92a3;">A bigger story beat — and a step up in how sharply your rivals play the back half — will land here in a future update.</p>
    </div>`;
  showModal('Mid-season break', body, [
    { label: `On to week ${week} →`, primary: true, onClick: onContinue },
  ]);
}
