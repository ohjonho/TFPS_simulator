// Playbook — the visual "adapt & author" editor (Stage 2). The peripheral shell
// (Side · Start From · Name · Save · Saved plays + coach) wraps a MAP CANVAS where
// the manager places their 5 units on exact hexes. 2a = placement (drag → pinHex);
// watch arrows (2b) + routes (2c) layer on. Replaces the old abstract slot-grid.
// Saved plays use the Stage-1 spatial fields, so the sim + B0 fingerprint + coach
// consume them unchanged. Pure DOM.

import type { HexCoord, MapDefinition, Side } from '../game/types.ts';
import {
  strategiesFor, regionCentroid,
  type Strategy, type StrategySlot, type StrategyVariant,
} from '../game/strategies.ts';
import { coachRead } from '../game/playbookCoach.ts';
import { createPlaybookCanvas, type EditorToken, type EditorMode, type PlaybookCanvasHandle } from './playbookCanvas.ts';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// The region a hex falls in (for zone classification + the directive fallback);
// the exact pin is what the sim actually targets. First containing region wins;
// 'mid' if none.
function regionContaining(map: MapDefinition, hex: HexCoord): string {
  for (const [name, cells] of Object.entries(map.regions)) {
    if (cells.some((h) => h.col === hex.col && h.row === hex.row)) return name;
  }
  return 'mid';
}

// Next free authored id of the form `<prefix>_c<N>` (never collides with a builtin).
function uniqueAuthoredId(prefix: string, taken: ReadonlySet<string>): string {
  let n = 1;
  while (taken.has(`${prefix}_c${n}`)) n++;
  return `${prefix}_c${n}`;
}

const BLANK = '__blank__';

export type PlaybookCallbacks = {
  onSave: (play: Strategy) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

export function showPlaybook(
  map: MapDefinition,
  existing: readonly Strategy[],
  cb: PlaybookCallbacks,
): { refresh: () => void } {
  document.getElementById('playbook')?.remove();
  const host = document.createElement('div');
  host.id = 'playbook';
  document.body.appendChild(host);

  const plays: Strategy[] = existing.map((s) => s); // live copy for the saved list

  // --- editor state ---
  let side: Side = 'defender';
  let baseId: string | null = null; // a builtin id, BLANK, or null (nothing picked)
  let name = '';
  let tokens: EditorToken[] = [];   // the 5 placed units (visual working model)
  let selectedId: string | null = null;
  let mode: EditorMode = 'move';
  let canvasHandle: PlaybookCanvasHandle | null = null;

  const bases = (): Strategy[] => strategiesFor(side, map).filter((s) => !s.authored);
  const base = (): Strategy | null => bases().find((s) => s.id === baseId) ?? null;

  // Where to drop the 5 tokens when a starting point is chosen.
  const spawnCells = (): HexCoord[] => map.spawns[side === 'defender' ? 'defenders' : 'attackers'];
  const fallbackHex = (): HexCoord => regionCentroid(map, 'mid') ?? { col: Math.floor(map.width / 2), row: Math.floor(map.height / 2) };

  const seedTokens = (): void => {
    selectedId = null;
    if (baseId === BLANK) {
      const spawns = spawnCells();
      const weapons: EditorToken['weapon'][] = ['rifle', 'rifle', 'rifle', 'rifle', 'sniper'];
      tokens = weapons.map((weapon, i) => ({ id: `pos${i + 1}`, weapon, pinHex: spawns[i] ?? fallbackHex() }));
      return;
    }
    const b = base();
    if (!b) { tokens = []; return; }
    tokens = b.variants[0].map((slot) => ({
      id: slot.id,
      weapon: slot.pick.preferWeapon === 'sniper' ? 'sniper' : 'rifle',
      pinHex: regionCentroid(map, slot.region) ?? fallbackHex(),
    }));
  };

  const selectBase = (id: string): void => {
    baseId = id;
    name = id === BLANK ? 'New play' : `${base()?.name ?? ''} (custom)`;
    seedTokens();
    render();
  };

  const save = (): void => {
    if (tokens.length === 0) return;
    const taken = new Set<string>([...plays.map((s) => s.id), ...strategiesFor(side, map).map((s) => s.id)]);
    const variant: StrategyVariant = tokens.map((t): StrategySlot => ({
      id: t.id,
      pick: { preferWeapon: t.weapon },
      region: regionContaining(map, t.pinHex),
      directives: [],
      pinHex: t.pinHex,
      watchHex: t.watchHex,
      route: t.route && t.route.length ? [...t.route, t.pinHex] : undefined,
    }));
    const b = base();
    const play: Strategy = baseId === BLANK || !b
      ? {
          id: uniqueAuthoredId('custom', taken), name: name.trim() || 'New play', side,
          description: 'Custom · authored on the map', variants: [variant],
          fallbackRegion: 'mid', aggressionMod: 0, retreatThresholdMod: 0, authored: true,
        }
      : {
          ...b, id: uniqueAuthoredId(b.id, taken), name: name.trim() || `${b.name} (custom)`,
          description: `Custom · adapted from ${b.name}`, authored: true, variants: [variant],
        };
    plays.push(play);
    cb.onSave(play);
    baseId = null; tokens = []; name = ''; selectedId = null;
    render();
  };

  const removePlay = (id: string): void => {
    const i = plays.findIndex((s) => s.id === id);
    if (i >= 0) plays.splice(i, 1);
    cb.onDelete(id);
    render();
  };

  const closeEditor = (): void => { canvasHandle?.destroy(); canvasHandle = null; host.remove(); cb.onClose(); };

  const render = (): void => {
    canvasHandle?.destroy();
    canvasHandle = null;

    const sideBtns = (['defender', 'attacker'] as Side[]).map((sd) =>
      `<button class="mp-opt ${sd === side ? 'sel' : ''}" data-side="${sd}"><b>${sd === 'defender' ? 'Defense' : 'Attack'}</b></button>`).join('');
    const startBtns = `<button class="pb-chip ${baseId === BLANK ? 'sel' : ''}" data-base="${BLANK}">＋ Blank</button>` +
      bases().map((s) => `<button class="pb-chip ${s.id === baseId ? 'sel' : ''}" data-base="${s.id}">${esc(s.name)}</button>`).join('');

    const savedList = plays.length
      ? plays.map((s) => {
          const read = s.measured ? coachRead(s, s.measured.matchups) : null;
          const coach = read
            ? `<div class="pb-coach v-${read.verdict}"><span class="pb-coach-tag">🧑‍🏫 Coach</span> <b>${esc(read.headline)}</b><div class="pb-coach-detail">${esc(read.character)} ${esc(read.advice)}</div></div>`
            : `<div class="pb-coach pending"><span class="pb-coach-tag">🧑‍🏫 Coach</span> reviewing this play…</div>`;
          return `<div class="pb-saved"><div class="pb-saved-head"><span>${esc(s.name)} <small>(${s.side === 'defender' ? 'def' : 'atk'})</small></span><button class="pb-del" data-del="${s.id}">Delete</button></div>${coach}</div>`;
        }).join('')
      : `<div class="pb-none">No saved plays yet.</div>`;

    host.innerHTML = `
      <div class="mp-card pb-card">
        <div class="mp-header">
          <div class="mp-kicker">Playbook · author on the map</div>
          <h1>Author a play</h1>
        </div>
        <div class="pb-grid">
          <div class="pb-col">
            <div class="mp-group-label">Side</div>
            <div class="pb-opts2">${sideBtns}</div>
            <div class="mp-group-label" style="margin-top:14px">Start from</div>
            <div class="pb-starts">${startBtns}</div>
            ${tokens.length ? `<div class="pb-row" style="margin-top:14px"><span class="pb-label">Name</span><input class="pb-name" type="text" value="${name.replace(/"/g, '&quot;')}" placeholder="My play"/></div>
            <div class="pb-canvas-hint"><b>Move:</b> drag a unit to set its hold. <b>Watch:</b> select a unit, click a hex to aim its cone. <b>Route:</b> select a unit, click hexes to draw its flank — discipline decides how faithfully it's run.</div>` : ''}
          </div>
          <div class="pb-col pb-canvas-col">
            ${tokens.length ? `<div class="pb-tools">
              <button class="pb-tool ${mode === 'move' ? 'sel' : ''}" data-mode="move" type="button">↔ Move</button>
              <button class="pb-tool ${mode === 'watch' ? 'sel' : ''}" data-mode="watch" type="button">⌖ Watch</button>
              <button class="pb-tool ${mode === 'route' ? 'sel' : ''}" data-mode="route" type="button">↳ Route</button>
              <button class="pb-tool pb-tool-clear" data-clearroute type="button">Clear route</button>
            </div>
            <div id="pb-canvas-host"></div>` : `<div class="pb-hint">Pick a side, then a starting point (Blank or a basic) to author on the map.</div>`}
          </div>
        </div>
        <div class="mp-group-label" style="margin-top:18px">Saved plays</div>
        <div class="pb-savedlist">${savedList}</div>
        <div class="mp-actions pb-actions">
          <button class="btn-back" data-close type="button">&larr; Done</button>
          <button class="btn-primary" data-save type="button" ${tokens.length ? '' : 'disabled'}>Save play</button>
        </div>
      </div>`;

    host.querySelectorAll<HTMLButtonElement>('[data-side]').forEach((el) => el.addEventListener('click', () => {
      side = el.getAttribute('data-side') as Side; baseId = null; tokens = []; selectedId = null; render();
    }));
    host.querySelectorAll<HTMLButtonElement>('[data-base]').forEach((el) => el.addEventListener('click', () => selectBase(el.getAttribute('data-base')!)));
    host.querySelector<HTMLInputElement>('.pb-name')?.addEventListener('input', (e) => { name = (e.target as HTMLInputElement).value; });
    host.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((el) => el.addEventListener('click', () => removePlay(el.getAttribute('data-del')!)));
    host.querySelector<HTMLButtonElement>('[data-save]')?.addEventListener('click', save);
    host.querySelector<HTMLButtonElement>('[data-close]')?.addEventListener('click', closeEditor);
    // Mode toggle — update the toolbar + canvas in place (no shell rebuild, so the
    // canvas isn't remounted mid-edit).
    host.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((el) => el.addEventListener('click', () => {
      mode = el.getAttribute('data-mode') as EditorMode;
      host.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('sel', b.getAttribute('data-mode') === mode));
      canvasHandle?.redraw();
    }));
    host.querySelector<HTMLButtonElement>('[data-clearroute]')?.addEventListener('click', () => {
      const t = tokens.find((x) => x.id === selectedId);
      if (t) { t.route = []; canvasHandle?.redraw(); }
    });

    // Mount the map canvas (persists across canvas interactions — onMove/onSelect
    // mutate token state + redraw without rebuilding the shell).
    const canvasHost = host.querySelector<HTMLElement>('#pb-canvas-host');
    if (canvasHost && tokens.length) {
      canvasHandle = createPlaybookCanvas(canvasHost, map, {
        tokens: () => tokens,
        selectedId: () => selectedId,
        mode: () => mode,
        onSelect: (id) => { selectedId = id; canvasHandle?.redraw(); },
        onMove: (id, hex) => { const t = tokens.find((x) => x.id === id); if (t) t.pinHex = hex; canvasHandle?.redraw(); },
        onSetWatch: (id, hex) => { const t = tokens.find((x) => x.id === id); if (t) t.watchHex = hex; canvasHandle?.redraw(); },
        onAddWaypoint: (id, hex) => { const t = tokens.find((x) => x.id === id); if (t) t.route = [...(t.route ?? []), hex]; canvasHandle?.redraw(); },
      });
    }
  };

  render();
  return { refresh: render };
}
