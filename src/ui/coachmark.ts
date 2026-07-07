// Light one-shot tutorial tooltips for the campaign's first match. Each tip
// shows once per browser (localStorage), as a small dismissible bubble pinned
// above the bottom bar. Deliberately low-touch — the heavy teaching lives in the
// in-game guidebook (helpModal). Pure DOM; no game state.

import { tutorialsOn } from './tutorialPrefs.ts';

const SEEN_PREFIX = 'tfps:coach:';
const HOST_ID = 'coachmark-host';
let activeKey: string | null = null;

function seen(key: string): boolean {
  try { return localStorage.getItem(SEEN_PREFIX + key) === '1'; } catch { return false; }
}
function markSeen(key: string): void {
  try { localStorage.setItem(SEEN_PREFIX + key, '1'); } catch { /* ignore quota */ }
}

// Show a coachmark once. No-op if this key was already dismissed, or if it's the
// one already on screen (so repeated re-renders don't re-create the bubble).
export function showCoachmark(key: string, html: string): void {
  if (!tutorialsOn() || seen(key)) return;
  if (activeKey === key && document.getElementById(HOST_ID)) return;
  dismiss();
  activeKey = key;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.className = 'coachmark';
  host.innerHTML = `
    <div class="coachmark-tip">Tip</div>
    <div class="coachmark-body">${html}</div>
    <button class="coachmark-dismiss" type="button">Got it</button>`;
  document.body.appendChild(host);
  host.querySelector<HTMLButtonElement>('.coachmark-dismiss')
    ?.addEventListener('click', () => { markSeen(key); dismiss(); });
}

function dismiss(): void {
  document.getElementById(HOST_ID)?.remove();
  activeKey = null;
}

// Clear any visible coachmark without marking it seen (e.g. on leaving a match).
export function clearCoachmarks(): void { dismiss(); }
