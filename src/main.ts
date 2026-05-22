// Entry point. Wires game state, render, hover/drawing handlers, the waypoint
// modal, top bar, and the playback loop into a single mutable container.

import './style.css';
import type { GameState, Path, PlaybackSpeed, Team, Unit } from './game/types.ts';
import { buildInitialState } from './game/state.ts';
import { clearPath, removeWaypoint, setWaypoint } from './game/path.ts';
import { PlaybackLoop } from './game/loop.ts';
import { DEBUG_KEY } from './game/config.ts';
import { setupCanvas } from './render/canvas.ts';
import { render } from './render/renderer.ts';
import type { DebugOverlay, RenderHover } from './render/renderer.ts';
import { buildShell } from './ui/layout.ts';
import { renderSidePanel } from './ui/sidePanel.ts';
import { renderBottomControls } from './ui/bottomControls.ts';
import { renderTopBar } from './ui/topBar.ts';
import { attachHover } from './ui/hover.ts';
import { attachDrawing } from './ui/drawing.ts';
import { closeWaypointModal, openWaypointModal } from './ui/waypointModal.ts';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app root missing in index.html');

const shell = buildShell(root);
let state: GameState = buildInitialState();

// Snapshot the spawn state so Replay (and Back to Planning) can restore it.
const initialUnitsById: Record<string, Unit> = {};
for (const u of state.units) initialUnitsById[u.id] = u;

const handle = setupCanvas(shell.canvasArea);
const hover: RenderHover = { unitId: null };
const debug: DebugOverlay = { on: false };

// --- Render pipeline --------------------------------------------------------

function rerenderCanvas() {
  render(handle.ctx, state, hover, debug, handle.cssWidth, handle.cssHeight);
}

function rerenderChrome() {
  const hovered = hover.unitId
    ? state.units.find((u) => u.id === hover.unitId) ?? null
    : null;
  renderSidePanel(shell.sidePanel, state, hovered, {
    onClearPath: (unitId) => {
      const u = state.units.find((x) => x.id === unitId);
      if (!u) return;
      setState({
        ...state,
        paths: { ...state.paths, [unitId]: clearPath(u.pos) },
      });
    },
  });
  renderBottomControls(shell.bottomBar, state, {
    onPlayToggle: () => {
      if (state.playback.playing) loop.pause();
      else loop.start();
    },
    onSpeedChange: (speed: PlaybackSpeed) => loop.setSpeed(speed),
    onReplay: () => {
      loop.reset(initialUnitsById);
      loop.start();
    },
  });
  renderTopBar(shell.topBar, state, {
    onBeginRound: () => {
      setState({ ...state, phase: 'resolution', tick: 0 });
      loop.start();
    },
    onResetToPlanning: () => {
      loop.pause();
      loop.reset(initialUnitsById);
      setState({ ...state, phase: 'planning' });
    },
    onSetPlayerTeam: (team: Team) => {
      setState({ ...state, playerTeam: team });
    },
  });
}

function rerenderAll() {
  rerenderCanvas();
  rerenderChrome();
}

function setState(next: GameState) {
  state = next;
  rerenderAll();
}

// --- Loop -------------------------------------------------------------------

const loop = new PlaybackLoop({
  getState: () => state,
  setState: (next) => {
    state = next;
  },
  onTick: () => rerenderAll(),
});

// --- Mouse interactions -----------------------------------------------------

attachHover(handle.canvas, () => state.units, (unitId) => {
  hover.unitId = unitId;
  rerenderAll();
});

attachDrawing(handle.canvas, {
  getState: () => state,
  setPath: (unitId, path: Path) => {
    setState({ ...state, paths: { ...state.paths, [unitId]: path } });
  },
  openWaypointModal: (unitId, hexIndex, screenXY) => {
    const path = state.paths[unitId];
    if (!path) return;
    const existing = path.waypoints[hexIndex] ?? null;
    openWaypointModal(document.body, screenXY, existing, {
      onSave: (wp) => {
        setState({
          ...state,
          paths: { ...state.paths, [unitId]: setWaypoint(path, hexIndex, wp) },
        });
      },
      onRemove: () => {
        setState({
          ...state,
          paths: { ...state.paths, [unitId]: removeWaypoint(path, hexIndex) },
        });
      },
      onCancel: () => {
        // No-op.
      },
    });
  },
});

// Close the modal when the user switches phases. Also: 'V' toggles the
// debug vision overlay (cones + visible hexes + tracking lines for all units).
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') closeWaypointModal(document.body);
  if (ev.key.toLowerCase() === DEBUG_KEY) {
    // Skip when the user is typing into the waypoint modal.
    const target = ev.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      return;
    }
    debug.on = !debug.on;
    rerenderAll();
  }
});

rerenderAll();
