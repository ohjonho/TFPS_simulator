// Builds the app shell: top bar, left card panel, canvas area, side panel,
// bottom bar. Pass E m4 splits the original right sidebar — cards move to a
// dedicated left sidebar, the right sidebar keeps unit info / strategy menu,
// and the kill feed becomes an absolute overlay anchored inside the canvas
// area (bottom-left).

export type Shell = {
  topBar: HTMLElement;
  canvasArea: HTMLElement;
  sidePanel: HTMLElement;
  bottomBar: HTMLElement;
  // Pass A1 — floating attributes overlay, positioned absolutely inside the
  // canvas area (top-right). Hover-driven; visible in both phases.
  attributesPanel: HTMLElement;
  // Pass E m4 — new dedicated left sidebar for card hand + cards-this-round.
  cardPanel: HTMLElement;
  // Pass E m4 — semi-transparent kill-feed overlay anchored bottom-left
  // inside canvas-area. Always rendered; pointer-events: none.
  killFeedOverlay: HTMLElement;
};

export function buildShell(root: HTMLElement): Shell {
  root.innerHTML = '';

  const topBar = document.createElement('header');
  topBar.id = 'top-bar';

  const cardPanel = document.createElement('aside');
  cardPanel.id = 'card-panel';

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

  // Pass E m4 — kill-feed overlay (bottom-left inside canvas-area).
  const killFeedOverlay = document.createElement('div');
  killFeedOverlay.id = 'kill-feed-overlay';
  killFeedOverlay.classList.add('kill-feed-overlay');
  canvasArea.appendChild(killFeedOverlay);

  root.appendChild(topBar);
  root.appendChild(cardPanel);
  root.appendChild(canvasArea);
  root.appendChild(sidePanel);
  root.appendChild(bottomBar);

  return { topBar, canvasArea, sidePanel, bottomBar, attributesPanel, cardPanel, killFeedOverlay };
}
