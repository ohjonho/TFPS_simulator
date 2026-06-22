// Playbook — the visual "adapt & author" editor (Stage 2). The peripheral shell
// (Side · Start From · Name · Save · Saved plays + coach) wraps a MAP CANVAS where
// the manager places their 5 units on exact hexes. 2a = placement (drag → pinHex);
// watch arrows (2b) + routes (2c) layer on. Replaces the old abstract slot-grid.
// Saved plays use the Stage-1 spatial fields, so the sim + B0 fingerprint + coach
// consume them unchanged. Pure DOM.

import type { HexCoord, MapDefinition, Side, Unit, Weapon } from '../game/types.ts';
import {
  strategiesFor, regionCentroid, assignSlots,
  type Strategy, type StrategySlot, type StrategyVariant,
} from '../game/strategies.ts';
import { coachRead } from '../game/playbookCoach.ts';
import { routeMaxWaypoints, routeAllowsWaitWatch, routeAllowanceLabel, teamAvgTenacity } from '../game/playbookGating.ts';
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
  roster: readonly Unit[],
  cb: PlaybookCallbacks,
  opts: { authoringUnlocked?: boolean; capacity?: number } = {},
): { refresh: () => void } {
  document.getElementById('playbook')?.remove();
  const host = document.createElement('div');
  host.id = 'playbook';
  document.body.appendChild(host);

  // Part 6 gating. Defaults (unlocked + unlimited) keep non-season callers
  // unchanged; the season passes the real flag + roster-derived capacity.
  const authoringUnlocked = opts.authoringUnlocked ?? true;
  const capacity = opts.capacity ?? Infinity;
  const teamAvg = teamAvgTenacity(roster);
  let note: string | null = null; // transient gating message (cap hit / route limit)

  const plays: Strategy[] = existing.map((s) => s); // live copy for the saved list
  // A token's Tenacity = its roster unit's (falls back to the team average when a
  // token isn't paired to a unit). Drives the per-unit route-complexity gate.
  const tenacityOf = (t: EditorToken): number => roster.find((u) => u.id === t.unitId)?.attributes.tenacity ?? teamAvg;

  // --- editor state ---
  let side: Side = 'defender';
  let baseId: string | null = null; // a builtin id, BLANK, or null (nothing picked)
  let name = '';
  let tokens: EditorToken[] = [];   // the 5 placed units (visual working model)
  let selectedId: string | null = null;
  let mode: EditorMode = 'move';
  let editingId: string | null = null; // when set, Save updates this play in place
  let showVision = false;
  let selectedWaypoint: number | null = null; // route step being edited (selected unit)
  let armWatch = false;                        // next route click sets that step's watch
  let canvasHandle: PlaybookCanvasHandle | null = null;

  const bases = (): Strategy[] => strategiesFor(side, map).filter((s) => !s.authored);
  const base = (): Strategy | null => bases().find((s) => s.id === baseId) ?? null;

  // Where to drop the 5 tokens when a starting point is chosen.
  const spawnCells = (): HexCoord[] => map.spawns[side === 'defender' ? 'defenders' : 'attackers'];
  const enemyApproach = (): HexCoord | null => {
    const cells = map.spawns[side === 'defender' ? 'attackers' : 'defenders'];
    return cells.length ? cells[Math.floor(cells.length / 2)] : null;
  };
  const fallbackHex = (): HexCoord => regionCentroid(map, 'mid') ?? { col: Math.floor(map.width / 2), row: Math.floor(map.height / 2) };

  const seedTokens = (): void => {
    selectedId = null;
    // Tokens carry the player's ACTUAL roster weapons (incl. shotgun), so a saved
    // play prefers the units it was built for. Blank → place at spawn; adapt →
    // pair the roster onto the base's slot positions (assignSlots = weapon-aware).
    const rosterWeapons: Weapon[] = roster.length
      ? roster.map((u) => u.weapon)
      : ['rifle', 'rifle', 'rifle', 'rifle', 'sniper'];
    if (baseId === BLANK) {
      const spawns = spawnCells();
      tokens = rosterWeapons.map((weapon, i) => ({ id: `pos${i + 1}`, weapon, pinHex: spawns[i] ?? fallbackHex(), unitId: roster[i]?.id }));
      return;
    }
    const b = base();
    if (!b) { tokens = []; return; }
    const slots = b.variants[0];
    const pairing = roster.length ? assignSlots(slots, roster) : {};
    tokens = slots.map((slot) => {
      const unitId = pairing[slot.id];
      const unit = roster.find((u) => u.id === unitId);
      return {
        id: slot.id,
        weapon: unit?.weapon ?? slot.pick.preferWeapon ?? 'rifle',
        pinHex: regionCentroid(map, slot.region) ?? fallbackHex(),
        unitId,
      };
    });
  };

  const selectBase = (id: string): void => {
    if (id === BLANK && !authoringUnlocked) return; // gated until the week-2 tutorial
    note = null;
    baseId = id;
    editingId = null;
    name = id === BLANK ? 'New play' : `${base()?.name ?? ''} (custom)`;
    seedTokens();
    render();
  };

  // Load a saved play back onto the canvas for editing (reverse the emit). Save
  // then updates it in place (same id) rather than creating a duplicate.
  const editPlay = (id: string): void => {
    const p = plays.find((s) => s.id === id);
    if (!p) return;
    note = null;
    side = p.side;
    name = p.name;
    baseId = null;
    editingId = id;
    selectedId = null;
    mode = 'move';
    // Recover each slot's roster unit (weapon-aware pairing) so route gating reads
    // the right unit's Tenacity when editing a saved play.
    const pairing = roster.length ? assignSlots(p.variants[0] ?? [], roster) : {};
    tokens = (p.variants[0] ?? []).map((slot) => ({
      id: slot.id,
      weapon: slot.pick.preferWeapon ?? 'rifle',
      pinHex: slot.pinHex ?? regionCentroid(map, slot.region) ?? fallbackHex(),
      watchHex: slot.watchHex,
      route: slot.route && slot.route.length ? slot.route.map((st) => ({ ...st })) : undefined,
      unitId: pairing[slot.id],
    }));
    render();
  };

  const save = (): void => {
    if (tokens.length === 0) return;
    // Capacity gate (Part 6) — a new play can't push the library past what the
    // squad's discipline can field. Editing in place is always allowed.
    if (!editingId && plays.length >= capacity) {
      note = `Your squad can keep ${capacity} set play${capacity === 1 ? '' : 's'} right now — delete one (or train Discipline) to author another.`;
      render();
      return;
    }
    note = null;
    const variant: StrategyVariant = tokens.map((t): StrategySlot => ({
      id: t.id,
      pick: { preferWeapon: t.weapon },
      region: regionContaining(map, t.pinHex),
      directives: [],
      pinHex: t.pinHex,
      watchHex: t.watchHex,
      route: t.route && t.route.length ? t.route : undefined,
    }));
    let play: Strategy;
    if (editingId) {
      // Edit in place: keep the original's id + mods, swap in the new layout + name,
      // and clear measured so the coach re-reviews.
      const orig = plays.find((s) => s.id === editingId)!;
      play = { ...orig, name: name.trim() || orig.name, variants: [variant], measured: undefined };
    } else {
      const taken = new Set<string>([...plays.map((s) => s.id), ...strategiesFor(side, map).map((s) => s.id)]);
      const b = base();
      play = baseId === BLANK || !b
        ? {
            id: uniqueAuthoredId('custom', taken), name: name.trim() || 'New play', side,
            description: 'Custom · authored on the map', variants: [variant],
            fallbackRegion: 'mid', aggressionMod: 0, retreatThresholdMod: 0, authored: true,
          }
        : {
            ...b, id: uniqueAuthoredId(b.id, taken), name: name.trim() || `${b.name} (custom)`,
            description: `Custom · adapted from ${b.name}`, authored: true, variants: [variant],
          };
    }
    const i = plays.findIndex((s) => s.id === play.id);
    if (i >= 0) plays[i] = play; else plays.push(play);
    cb.onSave(play);
    baseId = null; tokens = []; name = ''; selectedId = null; editingId = null;
    render();
  };

  const removePlay = (id: string): void => {
    const i = plays.findIndex((s) => s.id === id);
    if (i >= 0) plays.splice(i, 1);
    cb.onDelete(id);
    render();
  };

  const closeEditor = (): void => { canvasHandle?.destroy(); canvasHandle = null; host.remove(); cb.onClose(); };

  // The per-waypoint editor (Route mode): the selected unit's waypoints with a
  // wait timer + a "watch" arm per step. Repopulated in place (no shell rebuild,
  // so the canvas stays mounted). Empty when not routing / no waypoints.
  // Live note line (cap hit / route limit). Updated in place so it doesn't
  // remount the canvas.
  const renderNote = (): void => {
    const el = host.querySelector('#pb-note');
    if (el) el.textContent = note ?? '';
  };

  // Keep the Route tool's enabled state in sync with the selected unit's route
  // allowance — selection updates the panel/canvas in place (not a full render),
  // so the toolbar button is refreshed here too rather than going stale.
  const refreshRouteTool = (): void => {
    const sel = tokens.find((x) => x.id === selectedId) ?? null;
    const holdsOnly = sel != null && routeMaxWaypoints(tenacityOf(sel)) === 0;
    const btn = host.querySelector<HTMLButtonElement>('[data-mode="route"]');
    if (btn) { btn.disabled = holdsOnly; btn.title = holdsOnly ? 'This unit holds only — not disciplined enough to run a route' : ''; }
  };

  const renderWaypointPanel = (): void => {
    const el = host.querySelector('#pb-wp-panel');
    if (!el) return;
    const t = tokens.find((x) => x.id === selectedId);
    if (mode !== 'route' || !t) { el.innerHTML = ''; return; }
    // Per-unit route gate (Part 6): the allowance label is always shown while
    // routing a unit; wait/watch controls appear only at the top discipline tier.
    const ten = tenacityOf(t);
    const allowWaitWatch = routeAllowsWaitWatch(ten);
    const rows = (t.route ?? []).map((st, i) => `
      <div class="pb-wp-row ${i === selectedWaypoint ? 'sel' : ''}" data-wp="${i}">
        <span class="pb-wp-n">${i + 1}</span>
        ${allowWaitWatch
          ? `<label class="pb-wp-wait">wait <input type="number" min="0" max="9" value="${st.waitTicks ?? 0}" data-wpwait="${i}"/></label>
             <button class="pb-wp-watch ${armWatch && selectedWaypoint === i ? 'sel' : ''}" data-wpwatch="${i}" type="button">${st.watchHex ? 'watch ✓' : 'watch'}</button>`
          : '<span class="pb-wp-locked">move only</span>'}
      </div>`).join('');
    el.innerHTML = `<div class="mp-group-label" style="margin-top:14px">Waypoints — ${esc(t.id)}</div>`
      + `<div class="pb-wp-allow">${esc(routeAllowanceLabel(ten))}</div>${rows}`
      + (allowWaitWatch && armWatch ? '<div class="pb-wp-hint">Now click a hex to aim this waypoint.</div>' : '');
    el.querySelectorAll<HTMLElement>('[data-wp]').forEach((r) => r.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('input,button')) return;
      selectedWaypoint = parseInt(r.getAttribute('data-wp')!, 10); armWatch = false; renderWaypointPanel(); canvasHandle?.redraw();
    }));
    el.querySelectorAll<HTMLInputElement>('[data-wpwait]').forEach((inp) => inp.addEventListener('input', () => {
      const i = parseInt(inp.getAttribute('data-wpwait')!, 10);
      const v = Math.max(0, Math.min(9, Math.floor(Number(inp.value) || 0)));
      if (t.route && t.route[i]) { t.route[i] = { ...t.route[i], waitTicks: v }; canvasHandle?.redraw(); }
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-wpwatch]').forEach((b) => b.addEventListener('click', () => {
      selectedWaypoint = parseInt(b.getAttribute('data-wpwatch')!, 10); armWatch = true; renderWaypointPanel();
    }));
  };

  const render = (): void => {
    canvasHandle?.destroy();
    canvasHandle = null;

    // Selected unit's route allowance — disables the Route tool for a holds-only unit.
    const selTok = tokens.find((x) => x.id === selectedId) ?? null;
    const routeHoldsOnly = selTok != null && routeMaxWaypoints(tenacityOf(selTok)) === 0;

    const sideBtns = (['defender', 'attacker'] as Side[]).map((sd) =>
      `<button class="mp-opt ${sd === side ? 'sel' : ''}" data-side="${sd}"><b>${sd === 'defender' ? 'Defense' : 'Attack'}</b></button>`).join('');
    // Blank (author from scratch) is gated until the week-2 tutorial; adapting a
    // basic is always available.
    const blankChip = authoringUnlocked
      ? `<button class="pb-chip ${baseId === BLANK ? 'sel' : ''}" data-base="${BLANK}">＋ Blank</button>`
      : '<button class="pb-chip pb-chip-locked" type="button" disabled title="Authoring from scratch unlocks in week 2">🔒 Blank</button>';
    const startBtns = blankChip +
      bases().map((s) => `<button class="pb-chip ${s.id === baseId ? 'sel' : ''}" data-base="${s.id}">${esc(s.name)}</button>`).join('');

    const savedList = plays.length
      ? plays.map((s) => {
          const read = s.measured ? coachRead(s, s.measured.matchups) : null;
          const coach = read
            ? `<div class="pb-coach v-${read.verdict}"><span class="pb-coach-tag">🧑‍🏫 Coach</span> <b>${esc(read.headline)}</b><div class="pb-coach-detail">${esc(read.character)} ${esc(read.advice)}</div></div>`
            : `<div class="pb-coach pending"><span class="pb-coach-tag">🧑‍🏫 Coach</span> reviewing this play…</div>`;
          return `<div class="pb-saved"><div class="pb-saved-head"><span>${esc(s.name)} <small>(${s.side === 'defender' ? 'def' : 'atk'})</small>${editingId === s.id ? ' <em class="pb-editing">editing…</em>' : ''}</span><span class="pb-saved-actions"><button class="pb-edit" data-edit="${s.id}">Edit</button><button class="pb-del" data-del="${s.id}">Delete</button></span></div>${coach}</div>`;
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
            <div class="pb-canvas-hint"><b>Move:</b> drag a unit to set its hold. <b>Watch:</b> select a unit, click a hex to aim its cone. <b>Route:</b> select a unit, click hexes to drop sequential waypoints (set each one's wait + watch below) — discipline decides how faithfully it's run. Paths from spawn are shown; <b>👁 Vision</b> shades what your setup sees (gaps = blind spots); a red ring = an unreachable hold.</div>
            <div id="pb-wp-panel"></div>` : ''}
          </div>
          <div class="pb-col pb-canvas-col">
            ${tokens.length ? `<div class="pb-tools">
              <button class="pb-tool ${mode === 'move' ? 'sel' : ''}" data-mode="move" type="button">↔ Move</button>
              <button class="pb-tool ${mode === 'watch' ? 'sel' : ''}" data-mode="watch" type="button">⌖ Watch</button>
              <button class="pb-tool ${mode === 'route' ? 'sel' : ''}" data-mode="route" type="button" ${routeHoldsOnly ? 'disabled title="This unit holds only — not disciplined enough to run a route"' : ''}>↳ Route</button>
              <button class="pb-tool ${showVision ? 'sel' : ''}" data-vision type="button">👁 Vision</button>
              <button class="pb-tool pb-tool-clear" data-clearroute type="button">Clear route</button>
            </div>
            <div id="pb-canvas-host"></div>` : `<div class="pb-hint">Pick a side, then a starting point (Blank or a basic) to author on the map.</div>`}
          </div>
        </div>
        <div class="mp-group-label" style="margin-top:18px">Saved plays <small class="pb-cap">${plays.length}/${capacity === Infinity ? '∞' : capacity}</small></div>
        <div class="pb-savedlist">${savedList}</div>
        <div id="pb-note" class="pb-note-msg">${note ? esc(note) : ''}</div>
        <div class="mp-actions pb-actions">
          <button class="btn-back" data-close type="button">&larr; Done</button>
          <button class="btn-primary" data-save type="button" ${tokens.length ? '' : 'disabled'}>${editingId ? 'Update play' : 'Save play'}</button>
        </div>
      </div>`;

    host.querySelectorAll<HTMLButtonElement>('[data-side]').forEach((el) => el.addEventListener('click', () => {
      side = el.getAttribute('data-side') as Side; baseId = null; tokens = []; selectedId = null; editingId = null; render();
    }));
    host.querySelectorAll<HTMLButtonElement>('[data-base]').forEach((el) => el.addEventListener('click', () => selectBase(el.getAttribute('data-base')!)));
    host.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((el) => el.addEventListener('click', () => editPlay(el.getAttribute('data-edit')!)));
    host.querySelector<HTMLInputElement>('.pb-name')?.addEventListener('input', (e) => { name = (e.target as HTMLInputElement).value; });
    host.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((el) => el.addEventListener('click', () => removePlay(el.getAttribute('data-del')!)));
    host.querySelector<HTMLButtonElement>('[data-save]')?.addEventListener('click', save);
    host.querySelector<HTMLButtonElement>('[data-close]')?.addEventListener('click', closeEditor);
    // Mode toggle — update the toolbar + canvas in place (no shell rebuild, so the
    // canvas isn't remounted mid-edit).
    host.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((el) => el.addEventListener('click', () => {
      mode = el.getAttribute('data-mode') as EditorMode;
      host.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('sel', b.getAttribute('data-mode') === mode));
      renderWaypointPanel();
      canvasHandle?.redraw();
    }));
    host.querySelector<HTMLButtonElement>('[data-clearroute]')?.addEventListener('click', () => {
      const t = tokens.find((x) => x.id === selectedId);
      if (t) { t.route = []; canvasHandle?.redraw(); }
    });
    host.querySelector<HTMLButtonElement>('[data-vision]')?.addEventListener('click', () => {
      showVision = !showVision;
      host.querySelector<HTMLButtonElement>('[data-vision]')?.classList.toggle('sel', showVision);
      canvasHandle?.redraw();
    });

    // Mount the map canvas (persists across canvas interactions — onMove/onSelect
    // mutate token state + redraw without rebuilding the shell).
    const canvasHost = host.querySelector<HTMLElement>('#pb-canvas-host');
    if (canvasHost && tokens.length) {
      canvasHandle = createPlaybookCanvas(canvasHost, map, {
        tokens: () => tokens,
        selectedId: () => selectedId,
        mode: () => mode,
        showVision: () => showVision,
        spawnCells: () => spawnCells(),
        approachHex: () => enemyApproach(),
        selectedWaypoint: () => selectedWaypoint,
        armWatch: () => armWatch,
        onSelect: (id) => { selectedId = id; selectedWaypoint = null; armWatch = false; renderWaypointPanel(); refreshRouteTool(); canvasHandle?.redraw(); },
        onMove: (id, hex) => { const t = tokens.find((x) => x.id === id); if (t) t.pinHex = hex; canvasHandle?.redraw(); },
        onSetWatch: (id, hex) => { const t = tokens.find((x) => x.id === id); if (t) t.watchHex = hex; canvasHandle?.redraw(); },
        onAddWaypoint: (id, hex) => {
          const t = tokens.find((x) => x.id === id);
          if (!t) return;
          // Per-unit route-complexity gate (Part 6): cap the number of stops by Tenacity.
          const max = routeMaxWaypoints(tenacityOf(t));
          if ((t.route?.length ?? 0) >= max) {
            note = max === 0
              ? `${t.id} holds only — not disciplined enough to run a route.`
              : `${t.id} can run at most ${max} stop${max === 1 ? '' : 's'} — train Discipline to go further.`;
            renderNote();
            return;
          }
          note = null; renderNote();
          t.route = [...(t.route ?? []), { hex }]; selectedWaypoint = t.route.length - 1; armWatch = false;
          renderWaypointPanel(); canvasHandle?.redraw();
        },
        onSetWaypointWatch: (id, idx, hex) => {
          const t = tokens.find((x) => x.id === id);
          if (t?.route?.[idx]) t.route[idx] = { ...t.route[idx], watchHex: hex };
          armWatch = false; renderWaypointPanel(); canvasHandle?.redraw();
        },
      });
      renderWaypointPanel();
    }
  };

  render();
  return { refresh: render };
}
