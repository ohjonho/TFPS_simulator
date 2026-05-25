// Builds the app shell: top bar, canvas area, side panel, bottom bar.
// Returns each slot so the rest of the app can mount into it.

export type Shell = {
  topBar: HTMLElement;
  canvasArea: HTMLElement;
  sidePanel: HTMLElement;
  bottomBar: HTMLElement;
  // Pass A1 — floating attributes overlay, positioned absolutely inside the
  // canvas area (top-right). Hover-driven; visible in both phases.
  attributesPanel: HTMLElement;
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

  // Floating overlay: positioned absolutely top-right within canvas-area
  // (which is set to position:relative in CSS so this anchors correctly).
  const attributesPanel = document.createElement('div');
  attributesPanel.id = 'attributes-panel';
  attributesPanel.classList.add('empty');
  canvasArea.appendChild(attributesPanel);

  root.appendChild(topBar);
  root.appendChild(canvasArea);
  root.appendChild(sidePanel);
  root.appendChild(bottomBar);

  return { topBar, canvasArea, sidePanel, bottomBar, attributesPanel };
}
