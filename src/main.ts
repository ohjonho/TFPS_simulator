// Entry point. The only place the pure game/* logic meets the DOM.
//
// Wires:
//   - GameState (`buildInitialState` + setState reducer pattern).
//   - Render pipeline (`render` from render/renderer.ts).
//   - Playback loop (resolution-phase timer; calls `stepTick` → `onTick`).
//   - UI panels (topBar, sidePanel, cardPanel, draftPanel, bottomControls,
//     attributesPanel, killFeedOverlay, helpModal).
//   - Mouse + keyboard interactions (hover, click-to-select, drag-in-spawn,
//     V/R toggles).
//   - Match flow (planning → resolution → round-end modal → halftime swap →
//     next round → match-end modal → New Match).
//   - Draft flow (pool overlay → pick commits → finalizeDraft → planning).
//   - The `window.__sim` dev hook (DEV builds only) — see spec §14.2.

import './style.css';
import type { GameState, HexCoord, MatchMode, PlaybackSpeed, Team, Unit } from './game/types.ts';
import { previewPlayerPlan } from './game/planningPreview.ts';
// H3.4 — cardData / cardTargeting / commitCards / pickAiCard / processCardsAtRoundEnd
// all deleted (card system removed).
import { buildInitialState } from './game/state.ts';
import { aggregateVisible } from './game/attributes.ts';
import { computeTeamChemistry } from './game/chemistry.ts';
import { availableStrategies, unlockContributors } from './game/traits.ts';
import { compliancePct } from './game/directives.ts';
import { assignTarget } from './game/movement.ts';
import { stepTick } from './game/tick.ts';
import { computePerUnitDebug, computeVisibility } from './game/vision.ts';
import { resolveShot } from './game/combat.ts';
import type { ShotContextInput } from './game/combat.ts';
import { createRng } from './game/rng.ts';
import { determinismCheck, runBatch, runComplianceTest, runSkirmish, runStrategyMatrix, runStrategyRound } from './game/batch.ts';
import { runAiQuality, formatAiQuality } from './game/aiQuality.ts';
import { ROLE_AGGRESSION, RNG_SEED_DEFAULT } from './game/config.ts';
import { PlaybackLoop } from './game/loop.ts';
import { DEBUG_KEY, REGION_LABEL_KEY } from './game/config.ts';
import {
  advanceToNextRound,
  applyStrategies,
  halftimeSwap,
  isHalftime,
  recordStrategyWin,
  startRound,
} from './game/match.ts';
import { pickAiStrategy } from './game/aiOpponent.ts';
import { defenderTeam, eliminationWinner, endRound as endRoundFn } from './game/match.ts';
import { ROUND_TICK_LIMIT } from './game/config.ts';
import { strategiesFor, strategyById } from './game/strategies.ts';
import { setupCanvas } from './render/canvas.ts';
import { render } from './render/renderer.ts';
import type { DebugOverlay, RenderHover, Selection } from './render/renderer.ts';
import { buildShell } from './ui/layout.ts';
import { renderSidePanel } from './ui/sidePanel.ts';
import { renderAttributesPanel } from './ui/attributesPanel.ts';
import { renderBottomControls } from './ui/bottomControls.ts';
import { renderTopBar } from './ui/topBar.ts';
import { renderCardPanel } from './ui/cardPanel.ts';
import { renderDraftPanel } from './ui/draftPanel.ts';
import { autoDraft, commitDraftPick, finalizeDraft } from './game/draft.ts';
import { renderKillFeedOverlay } from './ui/killFeedOverlay.ts';
import { attachHover } from './ui/hover.ts';
import { attachClickToCommand } from './ui/clickToCommand.ts';
import { attachUnitDrag, isValidDropHex } from './ui/unitDrag.ts';
import { passableAt } from './game/pathfind.ts';
import { showModal } from './ui/modal.ts';
import { maybeShowFirstLoadHelp, showHelpModal } from './ui/helpModal.ts';
import { renderRoundEndStats } from './ui/roundEndPanel.ts';
import { renderMatchEndScoreboard } from './ui/matchEndScoreboard.ts';
import { computeMatchStats, computeRoundStats } from './game/stats.ts';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app root missing in index.html');

const shell = buildShell(root);
// Open on Foundry IV — the canonical live map (Foundry II / v1 retired from the picker).
let state: GameState = buildInitialState('Foundryv4');

// Snapshot taken at the start of each round's resolution; used by Replay and
// Back-to-Planning to restore the round's starting unit setup.
let initialUnitsById: Record<string, Unit> = snapshotUnits(state.units);

const handle = setupCanvas(shell.canvasArea);
const hover: RenderHover = { unitId: null };
const selection: Selection = { unitId: null };
const debug: DebugOverlay = { on: false };
// Dev toggle (Pass 7.5): show enemy units on the map during planning. Default
// `true` for build/debug; Pass 9 flips this to `false` as the production default.
let showEnemiesPlanning = true;

// `previewRoutes` is the cached preview from previewPlayerPlan; recomputed
// on every strategy selection change. Lives in UI state (not GameState) and
// resets to null on Begin Round / round end.
let previewRoutes: Record<string, HexCoord[]> | null = null;
// Pass D — region-name overlay toggle. UI state, not GameState. Mirrors the
// "Regions" topbar button + the R keybinding.
let showRegionLabels = false;
// Pass E m5 — Match-mode / seed UI state. matchMode is mirrored on
// GameState.matchMode after each buildInitialState; matchSeed is kept here so
// the seed input + Regenerate button can reproduce or step the seed.
// H3.fix2 — Draft is the default; Standard is the debug toggle.
// H3.4 — card-targeting state removed (card system deleted).
let matchMode: MatchMode = 'draft';
let matchSeed: number = RNG_SEED_DEFAULT;
// F1 — drag state: non-null while the player is dragging a unit during
// planning. Read by the renderer to draw a "ghost" unit at the cursor pixel.
let dragState: { unitId: string; pixel: { x: number; y: number } } | null = null;

function recomputePreview(): void {
  previewRoutes = previewPlayerPlan(state, {
    strategyId: state.playerStrategy,
  }).routes ?? null;
}

// --- Render pipeline -------------------------------------------------------

function rerenderCanvas() {
  render(
    handle.ctx, state, hover, selection, debug,
    handle.cssWidth, handle.cssHeight,
    showEnemiesPlanning, previewRoutes, showRegionLabels,
    dragState,
  );
  updateTargetingBanner();
  updateCanvasCursor();
}

// H3.4 — card targeting removed; banner/cursor helpers always cleared.
function updateTargetingBanner(): void {
  const existing = document.getElementById('targeting-banner');
  if (existing) existing.remove();
}

function updateCanvasCursor(): void {
  handle.canvas.classList.remove('targeting-hex');
}

function rerenderChrome() {
  const hovered = hover.unitId
    ? state.units.find((u) => u.id === hover.unitId) ?? null
    : null;
  // Pass A1 — floating attributes panel: visible in both phases, driven by
  // canvas hover OR planning-roster hover. Selection (click) pins it: a
  // selected unit stays in the panel even when the cursor moves away, until
  // the user clicks empty space or another unit.
  const selected = selection.unitId
    ? state.units.find((u) => u.id === selection.unitId) ?? null
    : null;
  const attrSubject = selected ?? hovered;
  renderAttributesPanel(shell.attributesPanel, attrSubject, selected !== null);
  renderSidePanel(shell.sidePanel, hovered, state, {
    // Pass A1 — roster-item hover drives the attributes panel during planning.
    // Updates the shared hover state then re-renders chrome only (no canvas
    // change). Canvas hover continues to work as before.
    onHoverUnit: (unitId: string | null) => {
      hover.unitId = unitId;
      rerenderChrome();
    },
    // Pass E m5 / Pass G — Regenerate (in Draft mode): rebuild the match on
    // the current map with the user-supplied seed (re-rolls the pool).
    onRegenerate: (seed: number) => {
      clearPlanningUiState();
      matchSeed = seed;
      state = buildInitialState(state.map.name, matchMode, matchSeed);
      initialUnitsById = snapshotUnits(state.units);
      rerenderAll();
    },
  });
  // H3.4 — card hand removed; the left panel now carries the strategy menu
  // only. cardPanel.ts handles the strategy / variant picks; card-related
  // callbacks are gone.
  renderCardPanel(shell.cardPanel, state, {
    onPickStrategy: (id: string) => {
      // Pass C — picking a new strategy clears any prior A/B variant choice
      // so the player has to make the site bet fresh.
      setState({ ...state, playerStrategy: id, playerVariantChoice: null });
      recomputePreview();
      rerenderCanvas();
    },
    onPickVariant: (idx: number) => {
      setState({ ...state, playerVariantChoice: idx });
      recomputePreview();
      rerenderCanvas();
    },
  });
  // Pass G — draft phase overlay. Shown only when phase === 'draft'; cleared
  // (panel element removed) once the player confirms and we transition to
  // planning. Lives inside canvasArea so it sits on top of the canvas itself.
  renderDraftPanel(shell.canvasArea, state, {
    onPick: (unitId: string) => {
      const next = commitDraftPick(state, unitId);
      setState(next);
    },
    onAutoToggle: () => {
      if (!state.draft) return;
      // Toggling on = run-to-end; toggling off = leave the rest manual.
      if (!state.draft.autoMode) {
        setState(autoDraft(state));
      } else {
        setState({ ...state, draft: { ...state.draft, autoMode: false } });
      }
    },
    onConfirm: () => {
      const finalized = finalizeDraft(state);
      if (finalized === state) return; // not ready (shouldn't happen — button gated)
      initialUnitsById = snapshotUnits(finalized.units);
      setState(finalized);
    },
  });
  // Pass E m4 — kill feed as a small overlay anchored bottom-left in canvas.
  renderKillFeedOverlay(shell.killFeedOverlay, state);
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
    onBeginRound: beginRound,
    onBackToPlanning: () => {
      loop.pause();
      setState(startRound(state));
    },
    onSetPlayerTeam: (team: Team) => setState({ ...state, playerTeam: team }),
    onTimeout: () =>
      setState({ ...state, timeoutUsed: { ...state.timeoutUsed, [state.playerTeam]: true } }),
    onToggleShowEnemies: () => { showEnemiesPlanning = !showEnemiesPlanning; rerenderAll(); },
    showEnemiesPlanning,
    onSetMap: (name) => {
      // Pass E m5 — preserve current mode + seed across map switches (user
      // choice: same units, different map).
      // Pass G — wipe planning UI state (selected card / targeting / preview)
      // so the rebuilt match starts clean even if the player had picks pending.
      clearPlanningUiState();
      state = buildInitialState(name, matchMode, matchSeed);
      initialUnitsById = snapshotUnits(state.units);
      rerenderAll();
    },
    onToggleRegionLabels: () => { showRegionLabels = !showRegionLabels; rerenderAll(); },
    showRegionLabels,
    onSetMode: (mode: MatchMode) => {
      // Pass G — switching modes rebuilds the match (Draft mode lands in
      // the pre-match draft phase; Standard lands directly in planning).
      clearPlanningUiState();
      matchMode = mode;
      state = buildInitialState(state.map.name, matchMode, matchSeed);
      initialUnitsById = snapshotUnits(state.units);
      rerenderAll();
    },
    onOpenHelp: showHelpModal,
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

function snapshotUnits(units: readonly Unit[]): Record<string, Unit> {
  const out: Record<string, Unit> = {};
  for (const u of units) out[u.id] = { ...u, pos: { ...u.pos }, modifiers: { ...u.modifiers } };
  return out;
}

// Pass G — clear the planning-only UI state. Called whenever we rebuild the
// match (mode/map/seed change, New Match, Draft toggle). Without this, a
// half-committed card or strategy choice would leak across rebuilds.
function clearPlanningUiState(): void {
  // H3.4 — card UI state removed (card system deleted).
  previewRoutes = null;
  selection.unitId = null;
  hover.unitId = null;
  dragState = null;
}

// --- Match flow ------------------------------------------------------------

function beginRound(): void {
  // Pass G — Begin Round is only valid in planning; draft uses its own
  // Confirm button and resolution can't loop back through this path.
  if (state.phase !== 'planning') return;
  if (!state.playerStrategy) return;
  // Pass C — multi-variant strategies require an explicit A/B pick before
  // Begin Round can fire. Top-bar UI also disables the button; this is a
  // belt-and-suspenders guard for the keyboard / __sim path.
  const playerStrat = strategyById(state.playerStrategy, state.teamSide[state.playerTeam], state.map);
  if (playerStrat && playerStrat.variants.length > 1 && state.playerVariantChoice === null) return;

  const aiTeam: Team = state.playerTeam === 'defenders' ? 'attackers' : 'defenders';
  const aiSide = state.teamSide[aiTeam];
  const pickRng = createRng((state.seed ^ (state.round * 0x9e3779b1)) >>> 0);
  const aiId = pickAiStrategy(state, aiTeam, aiSide, pickRng);
  let next = applyStrategies(
    state, state.playerTeam, state.playerStrategy, aiTeam, aiId, pickRng,
    state.playerVariantChoice,
  );
  // Pass 9 m1 / H3.4 — round-start summary in the kill feed. Card fields
  // dropped (card system removed).
  next = {
    ...next,
    events: [
      ...next.events,
      {
        tick: next.tick,
        roundIndex: next.round,
        type: 'strategyPick',
        round: next.round,
        playerTeam: next.playerTeam,
        playerStrategy: next.playerStrategy,
        aiStrategy: next.aiStrategy,
      },
    ],
  };
  initialUnitsById = snapshotUnits(next.units);
  setState(next);
  // Clear UI selection so the next planning phase starts fresh.
  previewRoutes = null;
  loop.start();
}

function handleRoundEnd(): void {
  // Loop has already called endRound; state.roundResult/scores/matchOver are set.
  const winner = state.roundResult?.winner ?? null;
  if (winner && winner !== 'draw') {
    const stratId = winner === state.playerTeam ? state.playerStrategy : state.aiStrategy;
    state = recordStrategyWin(state, winner, stratId);
  }
  // H3.4 — card discard/draw lifecycle removed.

  const scoreLine = `Score: ${state.scores[state.playerTeam]} – ${state.scores[state.playerTeam === 'defenders' ? 'attackers' : 'defenders']}`;
  // Pass B — distinguish plant outcomes from elimination/timeout. Walk the
  // most recent events of the round backward to find the deciding action.
  const recent = state.events.slice(-12).reverse();
  let outcome = 'eliminate';
  for (const e of recent) {
    if (e.type === 'detonate') { outcome = 'detonate'; break; }
    if (e.type === 'defuse') { outcome = 'defuse'; break; }
    if (e.type === 'plant') break; // stop scanning past the most recent plant
  }
  const decided =
    outcome === 'detonate' ? '— spike detonated' :
    outcome === 'defuse'   ? '— spike defused' :
    '';
  const winLine = (label: string) => `${label} round ${state.round} ${decided}. ${scoreLine}`;
  const summary =
    winner === 'draw'
      ? `Round ${state.round} ended in a draw. ${scoreLine}`
      : winner === state.playerTeam
        ? winLine('You win')
        : winLine('Opponent wins');

  // Pass A5 — append the per-round stats table to the modal body so the
  // player sees K/D/A/ACS/KAST per unit alongside the round outcome.
  const body = `<p class="re-headline">${summary}</p>${renderRoundEndStats(state, state.round)}`;

  showModal(`Round ${state.round}`, body, [
    {
      label: 'Continue',
      primary: true,
      onClick: () => {
        if (state.matchOver) return showMatchEndModal();
        if (isHalftime(state)) return showHalftimeModal();
        setState(advanceToNextRound(state));
        initialUnitsById = snapshotUnits(state.units);
      },
    },
  ]);
}

function showHalftimeModal(): void {
  showModal(
    'Halftime',
    'Sides swap: each team moves to the opposite spawn. Same units, roles, and traits.',
    [{
      label: 'Continue to Round 4',
      primary: true,
      onClick: () => {
        const swapped = halftimeSwap(state);
        setState(advanceToNextRound(swapped));
        initialUnitsById = snapshotUnits(state.units);
      },
    }],
  );
}

function showMatchEndModal(): void {
  const w = state.matchWinner;
  const title = w === 'draw' ? "Draw — 3–3" : `${w === state.playerTeam ? 'You win!' : 'Opponent wins'}`;
  const headline =
    w === 'draw'
      ? 'Sudden-death tiebreaker is deferred to Pass 9. Match ends in a draw.'
      : `Final score: ${state.scores.defenders} (defenders) – ${state.scores.attackers} (attackers).`;
  // Pass A5 — full scoreboard (sorted by ACS, MVP marker, per-round ACS
  // sparkline) replaces the summary-only body.
  const body = `<p class="me-headline">${headline}</p>${renderMatchEndScoreboard(state)}`;
  const currentMap = state.map.name;
  showModal(title, body, [{
    label: 'New Match',
    primary: true,
    onClick: () => {
      // Pass E m5 / Pass G — preserve mode but increment seed so the next
      // match isn't identical (in Draft mode this re-rolls the pool too).
      // In Standard mode the seed advance is inert (flat-50 attributes).
      clearPlanningUiState();
      matchSeed = (matchSeed + 1) >>> 0;
      state = buildInitialState(currentMap, matchMode, matchSeed);
      initialUnitsById = snapshotUnits(state.units);
      rerenderAll();
    },
  }]);
}

// --- Loop ------------------------------------------------------------------

const loop = new PlaybackLoop({
  getState: () => state,
  setState: (next) => { state = next; },
  onTick: () => rerenderAll(),
  onRoundEnd: () => handleRoundEnd(),
});

// --- Mouse interactions ----------------------------------------------------

attachHover(handle.canvas, () => state.units, (unitId) => {
  hover.unitId = unitId;
  rerenderAll();
});

attachClickToCommand(handle.canvas, {
  getUnits: () => (state.phase === 'draft' ? [] : state.units),
  onSelect: (unitId) => {
    if (state.phase === 'draft') return; // ignore canvas clicks during draft
    selection.unitId = unitId;
    rerenderAll();
  },
});

// Pass E3 — drag player units within their starting zone during planning.
// Drag is gated on planning phase + the unit being on the player team; the
// drop is validated against the team's current-side spawn region.
attachUnitDrag(handle.canvas, {
  // Pass G — only planning allows drag (draft + resolution suppress it).
  canDrag: () => state.phase === 'planning',
  unitAt: (hex) => {
    for (const u of state.units) {
      if (u.team !== state.playerTeam) continue;
      if (u.state !== 'alive') continue;
      if (u.pos.col === hex.col && u.pos.row === hex.row) return u;
    }
    return null;
  },
  onCommit: (unitId, target) => {
    const u = state.units.find((x) => x.id === unitId);
    if (!u) return false;
    const spawnKey = state.teamSide[state.playerTeam] === 'defender' ? 'def_spawn' : 'atk_spawn';
    const spawnRegion = state.map.regions[spawnKey] ?? [];
    if (!isValidDropHex(u, target, spawnRegion, state.units, (h) => passableAt(state.map, h))) {
      // Invalid drop — re-render anyway to clear any hover highlight.
      rerenderCanvas();
      return false;
    }
    if (u.pos.col === target.col && u.pos.row === target.row) {
      rerenderCanvas();
      return true; // no-op
    }
    const newUnits = state.units.map((x) =>
      x.id === unitId ? { ...x, pos: { ...target } } : x,
    );
    setState({ ...state, units: newUnits });
    initialUnitsById = snapshotUnits(newUnits);
    recomputePreview();
    rerenderAll();
    return true;
  },
  onHover: (hex) => {
    // While dragging, treat the cursor hex as the hover target for the
    // existing hover-highlight rendering. (Doesn't pin a unit; just keeps
    // the canvas in sync visually.)
    if (hex) {
      const u = state.units.find((x) => x.pos.col === hex.col && x.pos.row === hex.row);
      hover.unitId = u?.id ?? null;
    } else {
      hover.unitId = null;
    }
    rerenderCanvas();
  },
  // F1 — track cursor pixel during drag so the renderer can draw a "ghost"
  // unit following the cursor (rather than the unit invisibly teleporting
  // on release, which playtesters found jarring).
  onDragState: (s) => {
    dragState = s;
    rerenderCanvas();
  },
});

// H3.4 — attachCardTargeting removed (card system + targeting UI deleted).

window.addEventListener('keydown', (ev) => {
  const target = ev.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
  const key = ev.key.toLowerCase();
  if (key === DEBUG_KEY) {
    debug.on = !debug.on;
    rerenderAll();
  } else if (key === REGION_LABEL_KEY) {
    showRegionLabels = !showRegionLabels;
    rerenderAll();
  }
});

rerenderAll();

// Pass E3.2 — auto-open the help modal on first load per browser; the
// "Got it" button writes a flag to localStorage so it doesn't reopen on
// every reload. Players can reopen any time via the topbar "?" button.
maybeShowFirstLoadHelp();

// Dev-only inspection hook (stripped from production builds via DEV guard).
if (import.meta.env.DEV) {
  (window as unknown as { __sim?: unknown }).__sim = {
    getState: () => state,
    setState,
    assign: (id: string, col: number, row: number) =>
      setState(assignTarget(state, id, { col, row })),
    step: (n = 1) => { for (let i = 0; i < n; i++) setState(stepTick(state)); },
    getVisibility: () => ({
      defenders: [...state.visibility.defenders],
      attackers: [...state.visibility.attackers],
    }),
    setFacing: (id: string, facing: number) =>
      setState({ ...state, units: state.units.map((u) => (u.id === id ? { ...u, facing: facing as Unit['facing'] } : u)) }),
    place: (id: string, col: number, row: number) =>
      setState({ ...state, units: state.units.map((u) => (u.id === id ? { ...u, pos: { col, row } } : u)) }),
    recompute: () => setState({ ...state, visibility: computeVisibility(state).visibility }),
    cone: (id: string) => {
      const d = computePerUnitDebug(state)[id];
      if (!d) return null;
      return { halfDeg: (d.halfRad * 180) / Math.PI, coneCount: d.cone.size, visibleCount: d.visible.size };
    },
    // v0.29.0 — set the 2 tactical traits (array) + the personality.
    setTactical: (id: string, traits: string[]) =>
      setState({ ...state, units: state.units.map((u) => (u.id === id ? { ...u, tacticalTraits: traits as Unit['tacticalTraits'] } : u)) }),
    setPersonality: (id: string, t: string | null) =>
      setState({ ...state, units: state.units.map((u) => (u.id === id ? { ...u, personality: t as Unit['personality'] } : u)) }),
    getRosterUnlocks: () => [], // v0.28.0 — strategies decoupled from traits; no roster unlocks
    getUnlockContributors: (team?: Team) => {
      const t = team ?? state.playerTeam;
      const units = state.units.filter((u) => u.team === t);
      return unlockContributors(units);
    },
    getAvailableStrategies: (team?: Team) => {
      const t = team ?? state.playerTeam;
      const units = state.units.filter((u) => u.team === t);
      const side = state.teamSide[t];
      return availableStrategies(units, side, state.map).map((s) => ({
        id: s.id, name: s.name, description: s.description,
        complianceThreshold: s.complianceThreshold ?? 50,
      }));
    },
    // H3.2 — compliance roll inspection: returns the chance (0-100) the
    // given unit follows its directive this tick given strategy +
    // situational pressure. Useful for verifying the formula against
    // hand-crafted rosters.
    getCompliance: (unitId: string, complianceThreshold = 50, situationalPressure = 0) => {
      const u = state.units.find((unit) => unit.id === unitId);
      if (!u) return null;
      return compliancePct(u, complianceThreshold, situationalPressure);
    },
    setRole: (id: string, role: keyof typeof ROLE_AGGRESSION) =>
      setState({
        ...state,
        units: state.units.map((u) =>
          u.id === id
            ? { ...u, role: role as Unit['role'], modifiers: { ...u.modifiers, aggression: ROLE_AGGRESSION[role], offPosition: role !== u.preferredRole } }
            : u,
        ),
      }),
    getAttributes: () =>
      state.units.map((u) => ({
        id: u.id, team: u.team, weapon: u.weapon, role: u.role, preferredRole: u.preferredRole,
        hero: u.hero,
        tactical: u.tacticalTraits, personality: u.personality,
        // Pass H1 — `handling` (legacy per-weapon view) is just weaponAffinity now;
        // the per-weapon split collapsed into one sub-attribute.
        aggression: u.modifiers.aggression,
        handling: u.attributes.weaponAffinity,
        offPos: u.modifiers.offPosition,
      })),
    // --- Pass 2c: personality CHEMISTRY (stub for the v1 management layer) ---
    // Computes the locker-room interaction read for a team's personalities.
    // Pure + deterministic; NOT consumed by the live sim, so it has no match
    // effect today — exposed here only for inspection + headless verification.
    // getChemistry() defaults to the player's team; pass a team to override.
    getChemistry: (team?: Team) => {
      const t = team ?? state.playerTeam;
      return computeTeamChemistry(
        state.units
          .filter((u) => u.team === t)
          .map((u) => ({ id: u.id, personality: u.personality })),
      );
    },
    // --- Pass A1 / H1: per-unit attribute ratings ---
    // getRatings() returns the 10 hidden sub-attributes per unit; getRatings(id)
    // returns one. getVisible(id?) returns the 5 visible aggregates instead.
    // Used for sim verification + headless A/B tests.
    getRatings: (id?: string) => {
      if (id === undefined) {
        return Object.fromEntries(state.units.map((u) => [u.id, u.attributes]));
      }
      return state.units.find((u) => u.id === id)?.attributes ?? null;
    },
    getVisible: (id?: string) => {
      if (id === undefined) {
        return Object.fromEntries(state.units.map((u) => [u.id, aggregateVisible(u.attributes)]));
      }
      const u = state.units.find((unit) => unit.id === id);
      return u ? aggregateVisible(u.attributes) : null;
    },
    // setRating(id, 'aim', 90) or setRating(id, 'mapIQ', 80). F2 — mapIQ
    // collapsed to a single number; pre-fix nested-key forms removed.
    setRating: (id: string, key: string, value: number) => {
      setState({
        ...state,
        units: state.units.map((u) => {
          if (u.id !== id) return u;
          const a = u.attributes;
          if (key in a) return { ...u, attributes: { ...a, [key]: value } };
          return u;
        }),
      });
    },
    // Pass A5 — performance stats inspection hooks.
    getRoundStats: (round?: number) =>
      computeRoundStats(state.events, round ?? state.round, state.units),
    getMatchStats: () => computeMatchStats(state.events, state.units),
    runSkirmish: (seed: number, opts?: unknown) => runSkirmish(seed, opts as Parameters<typeof runSkirmish>[1]),
    runBatch: (n = 50, opts?: unknown) => runBatch(n, opts as Parameters<typeof runBatch>[1]),
    // Pass 9 m5 — validation harness (strategy matrix + card sanity +
    // determinism). All deterministic; ~30s total at default seeds=20.
    runStrategyRound: (seed: number, opts: Parameters<typeof runStrategyRound>[1]) =>
      runStrategyRound(seed, opts),
    runStrategyMatrix: (seeds = 20, map?: 'Foundry' | 'Atoll', includeUnlocks = false) =>
      runStrategyMatrix(seeds, map, includeUnlocks),
    // H3.5 — replaces cardSanityCheck. Empirical check that high-Tenacity
    // rosters outperform low-Tenacity on demanding strategies (compliance
    // roll biting). See batch.runComplianceTest.
    runComplianceTest: (seeds = 20, map?: 'Foundry' | 'Atoll') => runComplianceTest(seeds, map),
    determinismCheck: (seeds = 10, map?: 'Foundry' | 'Atoll') => determinismCheck(seeds, map),
    runValidation: (seeds = 20) => {
      const matrix = runStrategyMatrix(seeds);
      const compliance = runComplianceTest(seeds);
      const det = determinismCheck(Math.min(seeds, 10));
      // eslint-disable-next-line no-console
      console.log('═══ Strategy matrix (baseline 3×3, defender win %) ═══');
      // eslint-disable-next-line no-console
      console.table(matrix);
      // eslint-disable-next-line no-console
      console.log('═══ Compliance test (high vs low Tenacity, defender win %) ═══');
      // eslint-disable-next-line no-console
      console.table(compliance);
      // eslint-disable-next-line no-console
      console.log(`═══ Determinism: ${det.matched}/${det.total} matched ═══`);
      if (det.mismatchedSeeds.length > 0) {
        // eslint-disable-next-line no-console
        console.warn('Mismatched seeds:', det.mismatchedSeeds);
      }
      return { matrix, compliance, det };
    },
    // AI-quality probe — the three balance-independent signals (skill-pays /
    // strategy structure / behavior proxies). Replaces the reflex of running a
    // full matrix after every AI tweak; aggregate win% is a balance gate, run
    // separately. Defaults to the canonical map (Foundry II). See aiQuality.ts.
    aiQuality: (seeds = 20, map: Parameters<typeof runAiQuality>[1] = 'Foundryv2') => {
      const report = runAiQuality(seeds, map);
      // eslint-disable-next-line no-console
      console.log(formatAiQuality(report));
      return report;
    },
    // --- Pass 7 match-flow hooks ---
    pickStrategy: (id: string) =>
      setState({ ...state, playerStrategy: id, playerVariantChoice: null }),
    pickVariant: (idx: number) => setState({ ...state, playerVariantChoice: idx }),
    beginRound: () => beginRound(),
    strategies: (side: 'attacker' | 'defender') =>
      // H3 — returns the FULL strategy list for the side (baseline + all
      // unlock variants), regardless of roster. Use getAvailableStrategies
      // for the roster-filtered view.
      strategiesFor(side, state.map).map((s) => ({ id: s.id, name: s.name, description: s.description, requiresUnlock: !!s.requiresUnlock })),
    // Run one round headlessly: apply the player's chosen strategy + AI pick,
    // step to elimination, end the round, then advance (with halftime swap).
    // Returns { winner, ticks, scoresAfter, matchOver, halftimeTaken }.
    simulateRound: (playerStrategyId: string, maxTicks = ROUND_TICK_LIMIT) => {
      if (state.matchOver) return { error: 'match over' };
      const aiTeam: Team = state.playerTeam === 'defenders' ? 'attackers' : 'defenders';
      const aiSide = state.teamSide[aiTeam];
      const pickRng = createRng((state.seed ^ (state.round * 0x9e3779b1)) >>> 0);
      const aiId = pickAiStrategy(state, aiTeam, aiSide, pickRng);
      // Pass C — honor `state.playerVariantChoice` for the headless run too,
      // so __sim drives match the UI's variant pick.
      let s = applyStrategies(
        state, state.playerTeam, playerStrategyId, aiTeam, aiId, pickRng,
        state.playerVariantChoice,
      );
      // H3.4 — card commit removed (card system deleted). Strategy synergies
      // + hero passives are wired in applyStrategies above.
      const startTick = s.tick;
      let winner: Team | null = null;
      for (let i = 0; i < maxTicks; i++) {
        s = stepTick(s);
        // H3.fix1 — honor plant detonation/defuse outcomes (set by stepTick
        // into roundResult). Then check elimination (now handles post-plant
        // mutual annihilation correctly via match.eliminationWinner).
        if (s.roundResult && s.roundResult.winner !== 'draw') {
          winner = s.roundResult.winner;
          break;
        }
        winner = eliminationWinner(s);
        if (winner) break;
      }
      // No elimination within the cap → defender side wins on timeout (Pass 7.5
      // fix). Round always has a winner now (never 'draw' here).
      const w: Team = winner ?? defenderTeam(s);
      const timedOut = !winner;
      // Capture ticks BEFORE advanceToNextRound resets s.tick.
      const ticksUsed = s.tick - startTick;
      s = endRoundFn(s, w);
      s = recordStrategyWin(s, w, w === state.playerTeam ? playerStrategyId : aiId);
      // H3.4 — processCardsAtRoundEnd removed (card system deleted).
      const halftimeTaken = isHalftime(s);
      const matchOver = s.matchOver;
      const scoresAfter = { ...s.scores };
      if (!matchOver) {
        if (halftimeTaken) s = halftimeSwap(s);
        s = advanceToNextRound(s);
      }
      setState(s);
      initialUnitsById = snapshotUnits(s.units);
      return {
        winner: w,
        ticks: ticksUsed,
        timedOut,
        playerStrategy: playerStrategyId,
        aiStrategy: aiId,
        scoresAfter,
        matchOver,
        halftimeTaken,
      };
    },
    // Pass E m5 — accept optional mode + seed; default to current UI state.
    newMatch: (mapName?: 'Foundry' | 'Atoll', mode?: MatchMode, seed?: number) => {
      clearPlanningUiState();
      if (mode !== undefined) matchMode = mode;
      if (seed !== undefined) matchSeed = seed;
      state = buildInitialState(mapName ?? state.map.name, matchMode, matchSeed);
      initialUnitsById = snapshotUnits(state.units);
      rerenderAll();
    },
    setMap: (name: 'Foundry' | 'Atoll' | 'Canyon' | 'Foundryv2' | 'Atoll_v2' | 'Foundryv4') => {
      clearPlanningUiState();
      state = buildInitialState(name, matchMode, matchSeed);
      initialUnitsById = snapshotUnits(state.units);
      rerenderAll();
    },
    setMode: (mode: MatchMode) => {
      clearPlanningUiState();
      matchMode = mode;
      state = buildInitialState(state.map.name, matchMode, matchSeed);
      initialUnitsById = snapshotUnits(state.units);
      rerenderAll();
    },
    setSeed: (seed: number) => {
      clearPlanningUiState();
      matchSeed = seed;
      state = buildInitialState(state.map.name, matchMode, matchSeed);
      initialUnitsById = snapshotUnits(state.units);
      rerenderAll();
    },
    getMatchMode: () => matchMode,
    getMatchSeed: () => matchSeed,
    // Pass G — draft phase introspection + headless drive.
    getDraft: () => state.draft ?? null,
    draftPick: (unitId: string) => {
      setState(commitDraftPick(state, unitId));
    },
    autoDraft: () => {
      setState(autoDraft(state));
    },
    finalizeDraft: () => {
      const finalized = finalizeDraft(state);
      if (finalized !== state) {
        initialUnitsById = snapshotUnits(finalized.units);
        setState(finalized);
      }
    },
    getMatch: () => ({
      round: state.round, scores: state.scores, teamSide: state.teamSide,
      playerStrategy: state.playerStrategy, aiStrategy: state.aiStrategy,
      roundResult: state.roundResult, matchOver: state.matchOver, matchWinner: state.matchWinner,
      timeoutUsed: state.timeoutUsed, aiStrategyWins: state.aiStrategyWins,
    }),
    getAi: () => state.ai,
    getEvents: () => state.events,
    getUnits: () => state.units.map((u) => ({ id: u.id, team: u.team, weapon: u.weapon, hp: u.hp, state: u.state, pos: u.pos })),
    setWeapon: (id: string, weapon: string) =>
      setState({ ...state, units: state.units.map((u) => (u.id === id ? { ...u, weapon: weapon as Unit['weapon'] } : u)) }),
    setHp: (id: string, hp: number) =>
      setState({ ...state, units: state.units.map((u) => (u.id === id ? { ...u, hp } : u)) }),
    addBuff: (id: string, buff: { hitPp?: number; headshotPp?: number; ticks?: number }) =>
      setState({
        ...state,
        buffs: {
          ...state.buffs,
          [id]: [
            ...(state.buffs[id] ?? []),
            { id: `dev-${state.tick}`, hitPp: buff.hitPp, headshotPp: buff.headshotPp, expiresAtTick: state.tick + (buff.ticks ?? 9999) },
          ],
        },
      }),
    getBuffs: () => state.buffs,
    // H3.4 — card __sim hooks removed (card system deleted). cardEffects
    // remains accessible via getState().cardEffects since hero passives + a
    // few strategy synergies still populate it.
    getPreviewRoutes: () => previewRoutes,
    getCardEffects: () => state.cardEffects,
    sampleHits: (shooterId: string, targetId: string, n = 400, ctx: Partial<ShotContextInput> & { seed?: number } = {}) => {
      const shooter = state.units.find((u) => u.id === shooterId)!;
      const target = state.units.find((u) => u.id === targetId)!;
      const rng = createRng(ctx.seed ?? 12345);
      const input: ShotContextInput = {
        stationary: ctx.stationary ?? true,
        stationaryTicks: ctx.stationaryTicks ?? 0,
        engagementTicks: ctx.engagementTicks ?? 1,
        firstShot: ctx.firstShot ?? false,
        allyFiredRecently: ctx.allyFiredRecently ?? false,
        lastAlive: ctx.lastAlive ?? false,
        adjacentToWall: ctx.adjacentToWall ?? false,
        ticksIntoRound: ctx.ticksIntoRound ?? 99,
        firstSightShot: ctx.firstSightShot ?? false,
      };
      let hits = 0; let headshots = 0; let band = '';
      for (let i = 0; i < n; i++) {
        const r = resolveShot(shooter, target, state.map, input, state.buffs[shooterId] ?? [], state.cardEffects, state.tick, rng);
        band = r.band;
        if (r.hit) hits++;
        if (r.headshot) headshots++;
      }
      return { n, band, hitPct: (hits / n) * 100, hsPctOfHits: hits ? (headshots / hits) * 100 : 0 };
    },
  };
}
