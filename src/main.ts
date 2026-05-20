// Entry point. Builds game state, mounts the UI shell + canvas, wires hover.
// Pass 1 is render-only; no game tick loop yet.

import './style.css';
import { buildInitialState } from './game/state.ts';
import { setupCanvas } from './render/canvas.ts';
import { render } from './render/renderer.ts';
import type { RenderHover } from './render/renderer.ts';
import { buildShell } from './ui/layout.ts';
import { renderSidePanel } from './ui/sidePanel.ts';
import { renderBottomControls } from './ui/bottomControls.ts';
import { attachHover } from './ui/hover.ts';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app root missing in index.html');

const shell = buildShell(root);
renderSidePanel(shell.sidePanel, null);
renderBottomControls(shell.bottomBar);

const state = buildInitialState();
const handle = setupCanvas(shell.canvasArea);
const hover: RenderHover = { unitId: null };

const draw = () => render(handle.ctx, state, hover, handle.cssWidth, handle.cssHeight);

draw();

attachHover(handle.canvas, state.units, (unitId) => {
  hover.unitId = unitId;
  const unit = unitId ? state.units.find((u) => u.id === unitId) ?? null : null;
  renderSidePanel(shell.sidePanel, unit);
  draw();
});
