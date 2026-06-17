// Campaign intro — the LAN-shop story shown when a season begins, before the
// draft. Two short beats (the setup, then the pitch), then hands off to
// `onContinue` (main.ts builds the player-only season draft). Light + skippable;
// pure DOM via the shared modal. Tone: earnest, a little self-aware about its
// own esports framing. The owner, "Sam", is deliberately unnamed by gender.

import { showModal } from './modal.ts';

export function showSeasonIntro(onContinue: () => void): void {
  page1(onContinue);
}

function page1(onContinue: () => void): void {
  const body = `
    <div class="season-intro">
      <p>Pixel Pursuit has been your second home since you were a kid — the last
        LAN café in town, sticky keyboards and questionable energy drinks and all.
        You work the counter part-time, mostly for the excuse to be here.</p>
      <p>But the lease is up, the numbers don't add up, and <strong>Sam</strong> —
        the owner, your friend — has started quietly talking about closing for good.</p>
      <p>Then you spot the flyer taped by the door: the regional FPS circuit. A real
        season. A prize pool that would cover the lease twice over.</p>
    </div>`;
  showModal('The last save', body, [
    { label: 'Skip intro', onClick: onContinue },
    { label: 'Continue', primary: true, onClick: () => page2(onContinue) },
  ]);
}

function page2(onContinue: () => void): void {
  const body = `
    <div class="season-intro">
      <p>You've never held a mouse in a ranked match in your life. But you've watched
        every VOD, you can recite three metas back, and — let's be honest — you read
        a scrim better than half the pros streaming it.</p>
      <p>So you make the pitch to Sam: <em>let me manage a team.</em> Five players,
        one season, one shot to keep the lights on.</p>
      <p>Sam laughs. Then signs the entry form.</p>
      <p class="season-intro-cta">Time to draft your roster.</p>
    </div>`;
  showModal('The pitch', body, [
    { label: 'Draft your team', primary: true, onClick: onContinue },
  ]);
}
