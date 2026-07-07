// A guided spotlight tour: dims the screen, highlights one UI element per step,
// and shows a captioned tooltip with Next / Skip. Used for the first match's
// onboarding. Runs once per browser (localStorage). Modal while open (clicks are
// blocked except the tooltip) so the player can't act mid-tour. Pure DOM.

import { tutorialsOn } from './tutorialPrefs.ts';

const SEEN = 'tfps:walk:';
const seen = (k: string): boolean => { try { return localStorage.getItem(SEEN + k) === '1'; } catch { return false; } };
const mark = (k: string): void => { try { localStorage.setItem(SEEN + k, '1'); } catch { /* ignore */ } };

// A step targets an element (resolved lazily, since the DOM changes between
// steps); omit `target` for a centered, spotlight-free step.
export type WalkStep = { target?: () => HTMLElement | null; title: string; body: string };

export function runWalkthrough(key: string, steps: readonly WalkStep[], onDone?: () => void): void {
  if (!tutorialsOn() || seen(key) || !steps.length) { onDone?.(); return; }
  if (document.getElementById('walkthrough')) return; // already running

  const overlay = document.createElement('div');
  overlay.id = 'walkthrough';
  const spot = document.createElement('div'); spot.className = 'wt-spot';
  const tip = document.createElement('div'); tip.className = 'wt-tip';
  overlay.append(spot, tip);
  document.body.appendChild(overlay);

  let i = 0;
  const finish = (): void => { mark(key); window.removeEventListener('resize', place); overlay.remove(); onDone?.(); };

  function place(): void {
    const step = steps[i];
    const el = step.target?.() ?? null;
    const r = el ? el.getBoundingClientRect() : null;
    const hasSpot = !!r && r.width > 4 && r.height > 4;
    if (hasSpot && r) {
      spot.style.display = 'block';
      spot.style.left = `${r.left - 6}px`; spot.style.top = `${r.top - 6}px`;
      spot.style.width = `${r.width + 12}px`; spot.style.height = `${r.height + 12}px`;
    } else {
      spot.style.display = 'none';
    }
    tip.innerHTML = `
      <div class="wt-step">${i + 1} / ${steps.length}</div>
      <div class="wt-title">${step.title}</div>
      <div class="wt-body">${step.body}</div>
      <div class="wt-actions">
        <button class="wt-skip" type="button">Skip tour</button>
        <button class="wt-next" type="button">${i >= steps.length - 1 ? 'Got it' : 'Next →'}</button>
      </div>`;
    // Position the tooltip near the spot (below, else above), else center it.
    const tr = tip.getBoundingClientRect();
    if (hasSpot && r) {
      let top = r.bottom + 12;
      if (top + tr.height > window.innerHeight - 8) top = Math.max(8, r.top - tr.height - 12);
      const left = Math.min(Math.max(8, r.left), window.innerWidth - tr.width - 8);
      tip.style.left = `${left}px`; tip.style.top = `${top}px`;
    } else {
      tip.style.left = `${window.innerWidth / 2 - tr.width / 2}px`;
      tip.style.top = `${window.innerHeight / 2 - tr.height / 2}px`;
    }
    tip.querySelector<HTMLButtonElement>('.wt-next')?.addEventListener('click', () => { i++; if (i >= steps.length) finish(); else place(); });
    tip.querySelector<HTMLButtonElement>('.wt-skip')?.addEventListener('click', finish);
  }

  window.addEventListener('resize', place);
  place();
}
