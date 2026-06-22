// Week-2 authoring tutorial (Part 6) — the one-time guided beat that unlocks
// authoring a play from scratch. Fires in the week-2 pre-match slot, framed
// around the scouted upcoming opponent so the player's first authored play has a
// concrete target. Flipping SeasonState.authoringUnlocked is the caller's job;
// this just teaches + routes to the editor (or skips). Uses the shared modal.

import { showModal } from './modal.ts';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// `leanLine` is pre-formatted HTML (the scouted leans, with <strong> emphasis);
// `opponentName` is escaped here.
export function showAuthoringTutorial(opponentName: string, leanLine: string, onOpen: () => void, onLater: () => void): void {
  const body = `
    <div class="season-intro">
      <p><strong>Your squad's ready for its own playbook.</strong> Until now you could only tweak the basics — from this week you can <em>author a play from scratch</em> on the map: place each unit on a hex, set its watch angle, and draw routes for flanks and lurks.</p>
      <p>First test: <strong>${esc(opponentName)}</strong>. ${leanLine} Draw something that punishes that read, and your disciplined units will run it.</p>
      <p style="color:#8a92a3;">How faithfully a play is executed comes down to each unit's Discipline — rookies manage one simple set play, veterans run several with elaborate routes. Train Discipline to unlock more.</p>
    </div>`;
  showModal('Draw up a play', body, [
    { label: 'Maybe later', onClick: onLater },
    { label: 'Open the Playbook', primary: true, onClick: onOpen },
  ]);
}
