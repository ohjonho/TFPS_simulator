// Builds the app shell: canvas area on the left, side panel on the right,
// placeholder bottom-bar spanning both. Returns the host elements so other
// modules can mount into them.

export type Shell = {
  canvasArea: HTMLElement;
  sidePanel: HTMLElement;
  bottomBar: HTMLElement;
};

export function buildShell(root: HTMLElement): Shell {
  root.innerHTML = '';

  const canvasArea = document.createElement('div');
  canvasArea.id = 'canvas-area';

  const sidePanel = document.createElement('aside');
  sidePanel.id = 'side-panel';

  const bottomBar = document.createElement('footer');
  bottomBar.id = 'bottom-bar';

  root.appendChild(canvasArea);
  root.appendChild(sidePanel);
  root.appendChild(bottomBar);

  return { canvasArea, sidePanel, bottomBar };
}
