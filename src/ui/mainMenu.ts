// Main menu — the app's front door. The player picks a mode (Season / Draft /
// Standard) or opens Settings / Patch notes. Mounted by main.ts as a full-screen
// overlay (#main-menu), shown when screen === 'menu'; the match chrome renders
// behind it. Pure render + click wiring; no game state here.

export type MainMenuCallbacks = {
  onPlay: (mode: 'standard' | 'draft' | 'season') => void;
  onSettings: () => void;
  onPatchNotes: () => void;
  onGuidebook: () => void;
};

export function renderMainMenu(host: HTMLElement, version: string, cb: MainMenuCallbacks): void {
  host.innerHTML = `
    <div class="menu-card">
      <div class="menu-header">
        <h1>Tactical FPS</h1>
        <p class="menu-sub">Match simulator — manage the team, read the opponent, win the round.</p>
      </div>
      <div class="menu-modes">
        <button class="menu-mode featured" data-play="season">
          <span class="mm-text">
            <span class="mm-name">Season <span class="mm-badge">Campaign</span></span>
            <span class="mm-desc">Draft a roster, then run a gauntlet of matches toward a goal.</span>
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
  host.querySelector<HTMLButtonElement>('[data-action="guide"]')?.addEventListener('click', cb.onGuidebook);
  host.querySelector<HTMLButtonElement>('[data-action="settings"]')?.addEventListener('click', cb.onSettings);
  host.querySelector<HTMLButtonElement>('[data-action="patch"]')?.addEventListener('click', cb.onPatchNotes);
}
