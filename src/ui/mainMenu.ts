// Main menu — the app's front door. The player picks a mode (Season / Draft /
// Standard) or opens Settings / Patch notes. Mounted by main.ts as a full-screen
// overlay (#main-menu), shown when screen === 'menu'; the match chrome renders
// behind it. Pure render + click wiring; no game state here.

export type MainMenuCallbacks = {
  onPlay: (mode: 'standard' | 'draft' | 'season') => void;
  onSettings: () => void;
  onPatchNotes: () => void;
  onGuidebook: () => void;
  // Part 6 — resume the autosaved season. Provided only when a save exists; the
  // Continue button is omitted otherwise.
  onContinue?: () => void;
};

export function renderMainMenu(host: HTMLElement, version: string, cb: MainMenuCallbacks): void {
  const continueBtn = cb.onContinue
    ? `<button class="menu-mode featured" data-action="continue">
          <span class="mm-text">
            <span class="mm-name">Continue <span class="mm-badge">Season</span></span>
            <span class="mm-desc">Resume your saved campaign where you left off.</span>
          </span>
          <span class="mm-arrow" aria-hidden="true">&rsaquo;</span>
        </button>`
    : '';
  host.innerHTML = `
    <div class="menu-card">
      <div class="menu-header">
        <h1>Tactical FPS</h1>
        <p class="menu-sub">Match simulator — manage the team, read the opponent, win the round.</p>
      </div>
      <div class="menu-modes">
        ${continueBtn}
        <button class="menu-mode${cb.onContinue ? '' : ' featured'}" data-play="season">
          <span class="mm-text">
            <span class="mm-name">New Season <span class="mm-badge">Campaign</span></span>
            <span class="mm-desc">Start the story: build a team, win the circuit, save the shop.</span>
          </span>
          <span class="mm-arrow" aria-hidden="true">&rsaquo;</span>
        </button>
        <button class="menu-mode" data-play="draft">
          <span class="mm-text">
            <span class="mm-name">Draft</span>
            <span class="mm-desc">Draft a squad for a single match.</span>
          </span>
          <span class="mm-arrow" aria-hidden="true">&rsaquo;</span>
        </button>
        <button class="menu-mode" data-play="standard">
          <span class="mm-text">
            <span class="mm-name">Standard</span>
            <span class="mm-desc">Quick match, fixed roster — for testing.</span>
          </span>
          <span class="mm-arrow" aria-hidden="true">&rsaquo;</span>
        </button>
      </div>
      <div class="menu-secondary">
        <button data-action="guide">Guidebook</button>
        <button data-action="settings">Settings</button>
        <button data-action="patch">Patch notes</button>
      </div>
      <div class="menu-version">${version}</div>
    </div>`;

  host.querySelectorAll<HTMLButtonElement>('[data-play]').forEach((b) => {
    const mode = b.getAttribute('data-play') as 'standard' | 'draft' | 'season';
    b.addEventListener('click', () => cb.onPlay(mode));
  });
  if (cb.onContinue) {
    host.querySelector<HTMLButtonElement>('[data-action="continue"]')?.addEventListener('click', cb.onContinue);
  }
  host.querySelector<HTMLButtonElement>('[data-action="guide"]')?.addEventListener('click', cb.onGuidebook);
  host.querySelector<HTMLButtonElement>('[data-action="settings"]')?.addEventListener('click', cb.onSettings);
  host.querySelector<HTMLButtonElement>('[data-action="patch"]')?.addEventListener('click', cb.onPatchNotes);
}
