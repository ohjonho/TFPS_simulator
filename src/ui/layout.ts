// Builds the app shell: top bar, canvas area, side panel, bottom bar.
// Returns each slot so the rest of the app can mount into it.

export type Shell = {
  topBar: HTMLElement;
  canvasArea: HTMLElement;
  sidePanel: HTMLElement;
  bottomBar: HTMLElement;
};

export function buildShell(root: HTMLElement): Shell {
  root.innerHTML = '';

  const topBar = document.createElement('header');
  topBar.id = 'top-bar';

  const canvasArea = document.createElement('div');
  canvasArea.id = 'canvas-area';

  const sidePanel = document.createElement('aside');
  sidePanel.id = 'side-panel';

  const bottomBar = document.createElement('footer');
  bottomBar.id = 'bottom-bar';

  root.appendChild(topBar);
  root.appendChild(canvasArea);
  root.appendChild(sidePanel);
  root.appendChild(bottomBar);

  return { topBar, canvasArea, sidePanel, bottomBar };
}
