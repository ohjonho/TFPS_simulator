// Entry point for the dev-only hex map editor (served at /map-editor.html).
// Lives outside src/game + src/maps (which stay pure logic); this tool may use
// the DOM/canvas and imports the game's hex geometry + the maps parser so the
// grid it paints is exactly what mapFromCharGrid consumes. Not part of the game
// bundle — it's a separate Vite entry.

import './editor.css';
import { EditorModel } from './model.ts';
import { EditorView } from './view.ts';
import { EditorControls } from './controls.ts';

const host = document.getElementById('editor');
if (!host) throw new Error('map-editor: #editor host element not found');

const model = new EditorModel();

const sidebar = document.createElement('aside');
sidebar.className = 'ed-sidebar';
const canvasArea = document.createElement('div');
canvasArea.className = 'ed-canvas';
host.append(sidebar, canvasArea);

// Hoisted so it can reference the consts below; only invoked after both exist.
function refresh(): void {
  view.requestRender();
  controls.update();
}

const view = new EditorView(canvasArea, model, {
  afterEdit: refresh,
  onHover: (hex) => controls.setHover(hex),
});

const controls = new EditorControls(sidebar, { model, view, onChange: refresh });

// Ctrl/⌘+Z undo, Ctrl/⌘+Y or Ctrl/⌘+Shift+Z redo.
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) {
    e.preventDefault();
    model.undo();
    refresh();
  } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
    e.preventDefault();
    model.redo();
    refresh();
  }
});
