// Entry point. The only place the pure game/* logic meets the DOM.
//
// Wires:
//   - GameState (`buildInitialState` + setState reducer pattern).
//   - Render pipeline (`render` from render/renderer.ts).
//   - Playback loop (resolution-phase timer; calls `stepTick` → `onTick`).
//   - UI panels (topBar, sidePanel, cardPanel, draftPanel, bottomControls,
//     attributesPanel, actionLog, helpModal).
//   - Mouse + keyboard interactions (hover, click-to-select, drag-in-spawn,
//     V/R toggles).
//   - Match flow (planning → resolution → round-end modal → halftime swap →
//     next round → match-end modal → New Match).
//   - Draft flow (pool overlay → pick commits → finalizeDraft → planning).
//   - The `window.__sim` dev hook (DEV builds only) — see spec §14.2.

import './style.css';
import type { GameState, HexCoord, MapDefinition, MatchMode, PlaybackSpeed, Team, Unit } from './game/types.ts';
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
import { strategiesFor, strategyById, clearCustomStrategies } from './game/strategies.ts';
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
import { autoDraft, commitDraftPick, finalizeDraft, undoDraftPick } from './game/draft.ts';
import { renderActionLogOverlay } from './ui/actionLogOverlay.ts';
import { attachHover } from './ui/hover.ts';
import { attachClickToCommand } from './ui/clickToCommand.ts';
import { attachUnitDrag, isValidDropHex } from './ui/unitDrag.ts';
import { passableAt } from './game/pathfind.ts';
import { showModal, dismissModal } from './ui/modal.ts';
import { maybeShowFirstLoadHelp, showHelpModal } from './ui/helpModal.ts';
import { renderRoundEndStats } from './ui/roundEndPanel.ts';
import { renderMatchEndScoreboard } from './ui/matchEndScoreboard.ts';
import { computeMatchStats, computeRoundStats } from './game/stats.ts';
import { renderMainMenu } from './ui/mainMenu.ts';
import { showSeasonOpening } from './ui/seasonOpening.ts';
import { showWelcome } from './ui/welcome.ts';
import { showPreDraftBeat } from './ui/preDraftBeat.ts';
import { showFirstTeamMeeting } from './ui/firstTeamMeeting.ts';
import { showTeamStats } from './ui/teamStats.ts';
import { showMatchPrep } from './ui/matchPrep.ts';
import { showPlaybook } from './ui/playbook.ts';
import { reviewPlay } from './ui/coachWorker.ts';
import { showCoachmark, clearCoachmarks } from './ui/coachmark.ts';
import { runWalkthrough, type WalkStep } from './ui/walkthrough.ts';
import { showTrainingDay } from './ui/trainingDay.ts';
import { showEventScreen } from './ui/eventScreen.ts';
import { rollEvent, applyEvent, applyEffects, eventFlavor } from './game/events/runtime.ts';
import { readyBeats, advanceArc, holdBeat, type SlotContext } from './game/story/arcRuntime.ts';
import { ARCS } from './game/story/arcs.ts';
import { matchSummary } from './game/story/matchSummary.ts';
import { showArcBeat, arcFlavor } from './ui/arcBeatScreen.ts';
import { dueDepartures, departPlayer, signReplacement, reserveOrigins, cancelDeparture } from './game/story/redraft.ts';
import { showRedraft } from './ui/redraftPicker.ts';
import { effectChipsHtml } from './ui/effectChips.ts';
import { applyMatchMorale, teamMorale, moraleLabel, applyWeeklyMoraleDrift } from './game/morale.ts';
import { showPostMatch1Beat } from './ui/postMatch1Beat.ts';
import { showScoutIntroBeat } from './ui/scoutIntroBeat.ts';
import { showWeek4Beat } from './ui/week4Beat.ts';
import { showWeek5Break } from './ui/week5Break.ts';
import { offWeekEffects } from './game/offWeek.ts';
import { flightRiskCandidate, seasonLeavers } from './game/flightRisk.ts';
import { showFlightRiskBeat } from './ui/flightRiskBeat.ts';
import { showSeasonEpilogue } from './ui/seasonEpilogue.ts';
import { showStandings, standingsTableHtml } from './ui/standings.ts';
import { showBracket, bracketHtml } from './ui/playoffBracket.ts';
import { playerRank, madePlayoffs, playoffSeeds, rivalMatchIndexFor, simPlayoffWinner, teamNameForIndex } from './game/standings.ts';
import { LEAGUE, ECONOMY } from './game/config.ts';

// 1 → "1st", 2 → "2nd", … (standings ordinal).
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
import { saveSeason, loadSeason, clearSavedSeason, hasSavedSeason } from './ui/seasonSave.ts';
import { playbookCapacity } from './game/playbookGating.ts';
import { applyTraining, applyMatchExperience, drillPlay } from './game/training.ts';
import { crossedBreakpoints } from './game/breakpoints.ts';
import { showBreakpoints } from './ui/breakpointModal.ts';
import { HALFTIME_AFTER_ROUND } from './game/config.ts';
import { startSeason, buildSeasonMatch, buildPlayoffMatch, recordSeasonResult, advanceSeasonPhase, currentWeek, seasonOver, seasonWins, leaguePointsForResult } from './game/season.ts';
import type { SeasonState } from './game/season.ts';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app root missing in index.html');

const shell = buildShell(root);
// Main-menu overlay host (the front door). Shown when screen === 'menu'; the
// match chrome renders behind it.
const menuHost = document.createElement('div');
menuHost.id = 'main-menu';
root.appendChild(menuHost);
// Phase 4 — thin management header (week / next match / LP / team-stats), shown
// across the season's management + dialogue screens (not the live match or menu).
const seasonHeaderHost = document.createElement('div');
seasonHeaderHost.id = 'season-header';
seasonHeaderHost.style.display = 'none';
document.body.appendChild(seasonHeaderHost);
let seasonHeaderOn = false;
function renderSeasonHeader(): void {
  if (!seasonHeaderOn || !season) {
    seasonHeaderHost.style.display = 'none';
    document.body.classList.remove('with-mgmt-header');
    return;
  }
  const s = season;
  const nextOpp = s.idx < s.K ? (s.opponents[s.idx]?.name ?? '—') : 'Playoffs';
  seasonHeaderHost.style.display = 'flex';
  document.body.classList.add('with-mgmt-header');
  seasonHeaderHost.innerHTML = `
    <div class="sh-left">
      <span class="sh-item"><b>Week ${currentWeek(s)}</b> / ${s.K}</span>
      <span class="sh-sep">·</span>
      <span class="sh-item">Next: <b>${nextOpp}</b></span>
      <span class="sh-sep">·</span>
      <span class="sh-item">LP <b>${s.leaguePoints}</b></span>
    </div>
    <button class="sh-team" data-team type="button">Team stats</button>`;
  seasonHeaderHost.querySelector<HTMLButtonElement>('[data-team]')?.addEventListener('click', () => { if (season) showTeamStats(season); });
}
function setSeasonHeader(on: boolean): void { seasonHeaderOn = on; renderSeasonHeader(); }
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
// Player units' plan start positions (post spawn-optimization) from the same
// preview — used to snap units to their route origin on pick (see snapPlayerToPlan).
let previewPositions: Record<string, HexCoord> | null = null;
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
// App-level screen + season state, layered above the per-match GameState. The
// app boots to the menu; picking a mode builds a match and flips to 'match'.
let screen: 'menu' | 'match' = 'menu';
let season: SeasonState | null = null;
// B1b — seed count for the background assistant-coach matchup review. Modest:
// the read is qualitative, so it tolerates noise; fewer seeds = faster feedback.
const COACH_REVIEW_SEEDS = 12;
let selectedMap: MapDefinition['name'] = 'Foundryv4';
// F1 — drag state: non-null while the player is dragging a unit during
// planning. Read by the renderer to draw a "ghost" unit at the cursor pixel.
let dragState: { unitId: string; pixel: { x: number; y: number } } | null = null;

function recomputePreview(): void {
  const p = previewPlayerPlan(state, { strategyId: state.playerStrategy });
  previewRoutes = p.routes ?? null;
  previewPositions = p.positions ?? null;
}

// On a strategy/variant pick, place the player's units at their plan's start
// positions (after strategy-aware spawn optimization) so they sit at the route
// origins instead of the spawn-corner. No-op on maps that don't optimize spawns
// (positions == current pos there). Begin Round re-runs the same optimization by
// target, so the round outcome is unchanged — this is purely planning legibility.
function snapPlayerToPlan(): void {
  if (!previewPositions) return;
  const pos = previewPositions;
  let changed = false;
  const units = state.units.map((u) => {
    const p = pos[u.id];
    if (p && (p.col !== u.pos.col || p.row !== u.pos.row)) { changed = true; return { ...u, pos: { ...p } }; }
    return u;
  });
  if (!changed) return;
  state = { ...state, units };
  initialUnitsById = snapshotUnits(units);
}

// --- Render pipeline -------------------------------------------------------

function rerenderCanvas() {
  // Tutorial match (season match 1) — show the faint A/B site labels so a new
  // manager can map the lettered sites to the canvas.
  const showSiteLabels = matchMode === 'season' && season?.idx === 0;
  render(
    handle.ctx, state, hover, selection, debug,
    handle.cssWidth, handle.cssHeight,
    showEnemiesPlanning, previewRoutes, showRegionLabels,
    dragState, showSiteLabels,
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
      snapPlayerToPlan();
      rerenderCanvas();
    },
    onPickVariant: (idx: number) => {
      setState({ ...state, playerVariantChoice: idx });
      recomputePreview();
      snapPlayerToPlan();
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
    onUnpick: (unitId: string) => {
      setState(undoDraftPick(state, unitId));
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
      // Season: capture the drafted roster + schedule, then the post-draft team
      // talk sets the club's early lean before match 1 builds.
      if (matchMode === 'season') {
        const roster = finalized.units.filter((u) => u.team === finalized.playerTeam);
        const s = startSeason(roster, finalized.map.name, matchSeed, 8, 5);
        seasonEpilogueDone = false; // fresh season — re-arm the end-of-season epilogue
        // Advance past draft phase so the canvas shows planning (not the draft
        // overlay) while the management screens run on top.
        initialUnitsById = snapshotUnits(finalized.units);
        setState(finalized);
        // First Team Meeting (the drafted squad meets; the highest-Leadership player
        // offers the identity choice → club lean; records story hooks) → Welcome
        // briefing ("Start the season") → the week loop.
        showFirstTeamMeeting(s.playerRoster, (lean) => {
          season = { ...s, clubLean: lean, upgrades: [], storyFlags: seasonStoryFlags };
          saveSeason(season);
          setSeasonHeader(true);
          showWelcome(() => runSeasonWeek(), undefined);
        });
        return;
      }
      initialUnitsById = snapshotUnits(finalized.units);
      setState(finalized);
    },
  });
  // Pass E m4 — Action Log overlay anchored top-left in canvas.
  renderActionLogOverlay(shell.actionLog, state);
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
    onMenu: goToMenu,
    onOpenHelp: () => showHelpModal('play'),
    lockMap: matchMode === 'season',
  });
}

function rerenderAll() {
  rerenderCanvas();
  rerenderChrome();
  renderMenu();
  maybeShowSeasonCoaching();
}

// Campaign onboarding — a few one-shot tooltips during the opening so a new
// manager learns the loop without a heavy scripted tutorial. Each shows once
// (coachmark.ts owns the localStorage dedupe); the guidebook carries the rest.
function maybeShowSeasonCoaching(): void {
  if (matchMode !== 'season') return;
  // The draft board gets its own guided spotlight tour (once) — walks the recruit
  // list, the detail panel, the pick tray and Confirm, one element at a time. Only
  // the authored season draft (its pool carries characterIds); season isn't set yet.
  if (state.phase === 'draft') {
    if (state.draft?.pool.some((u) => u.characterId)) runWalkthrough('draft-tour', draftTour());
    return;
  }
  // In-match tips fire only in the tutorial match (the telegraphed opponent).
  if (!season || season.idx !== 0) return;
  if (state.phase === 'planning' && state.round === 1) {
    // First match → the guided spotlight tour of the match UI (runs once).
    runWalkthrough('m1-tour', firstMatchTour());
  } else if (state.phase === 'planning' && state.round === HALFTIME_AFTER_ROUND + 1) {
    showCoachmark(
      'season-plan-atk',
      'Sides swapped — you\'re <strong>attacking</strong> now. They sit back in an even <strong>Hold</strong>. <strong>Execute</strong> or <strong>Control</strong> pries that open.',
    );
  }
}

// Draft-board guided tour — walks the roster browser element by element, shown
// once. Targets resolve lazily against the live #draft-panel DOM (a recruit is
// always pre-selected, so the detail panel exists). Mirrors firstMatchTour.
function draftTour(): WalkStep[] {
  const q = (sel: string) => (): HTMLElement | null => document.querySelector<HTMLElement>(sel);
  return [
    { title: 'Build your squad', body: 'Draft five players from these twelve hopefuls — this is the team you\'ll carry all season, so choose the mix you like.' },
    { target: q('.ds-list'), title: 'The recruits', body: 'Everyone who tried out. <strong>Click any name</strong> to size them up on the right.' },
    { target: q('.ds-center'), title: 'Who you\'re weighing up', body: 'The recruit you\'ve selected. (The portraits are placeholders for now — real art\'s on the way.)' },
    { target: q('.ds-chips'), title: 'Their kit', body: 'Role, hero, weapon and personality at a glance. <strong>Hover any chip</strong> for what it means.' },
    { target: q('.ds-intro'), title: 'A first read', body: 'A short sketch of who they are, and how they play. Their full story unfolds as you play together…' },
    { target: q('.ds-stats'), title: 'Their stats', body: 'The five core stats. The bars are <strong>zoomed</strong> so specialists stand out — hover a label for what each one means.' },
    { target: q('.ds-hero'), title: 'Their Hero ability', body: 'Every recruit brings a <strong>Hero</strong> — a once-a-round signature that fires when its moment comes. The four play very differently: a medic, a scout, a hunter, a wall. This line spells out theirs, and the reference breaks down all four.' },
    { target: q('.ds-draftbtn'), title: 'Sign them', body: 'Like what you see? Draft them here. Changed your mind? Click a picked player up top to release them.' },
    { target: q('.ds-picktray'), title: 'Your squad', body: 'Your five picks fill in up here as you go. You need all five before you can start.' },
    { target: q('.ds-confirm'), title: 'Lock it in', body: 'Once you\'ve got five, <strong>Confirm</strong> to meet the team and kick off the season.' },
    { target: q('.ds-legend'), title: 'A reference, any time', body: 'And this guide explains every chip and stat whenever you want it — just open it up.' },
  ];
}

// First-match guided tour — anchored to real chrome (shell.*), shown once.
// Canvas steps describe the map/sites/spawns; control steps point at the strategy
// menu, Begin Round, and playback.
function firstMatchTour(): WalkStep[] {
  return [
    { target: () => shell.canvasArea, title: 'Welcome to Canyon', body: 'This is the map your squad fights on. Win <strong>4 rounds</strong> to take the match.' },
    { target: () => shell.canvasArea, title: 'The two sites', body: 'There are two plant sites on this map — <strong>A</strong> and <strong>B</strong>. On defense, stop the enemy planting the spike there; on attack, plant it and hold the site.' },
    { target: () => shell.canvasArea, title: 'Your squad', body: 'The coloured dots are your units at their starting positions. Each round both squads spawn at opposite ends of the map — yours below, the enemy\'s above.' },
    { target: () => shell.cardPanel, title: 'Pick your strategy', body: 'Choose your plan for the round here, and check the <strong>Scout</strong> for the read. For this first match, your opponent only knows one trick: <strong>Rush</strong> one site head-on — <strong>Stack</strong> or <strong>Hold</strong> meets it.' },
    { target: () => shell.topBar.querySelector('.btn-primary') ?? shell.topBar, title: 'Begin the round', body: 'When your plan is set, hit <strong>Begin Round</strong> — the yellow button here — to play it out.' },
    { target: () => shell.bottomBar, title: 'Playback', body: 'Once the round runs, control speed and <strong>pause / resume</strong> down here with the play button.' },
    { title: "You're set", body: 'The <strong>Action Log</strong> (top-left) shows every shot, kill and plant as the round plays out, and you can <strong>hover any unit</strong> on the map to see their stats. Good luck out there.' },
  ];
}

// Tutorial pause: the very first round of the first match halts at first enemy
// contact, so a new manager sees a duel begin before it resolves. Resume via the
// play button. One-shot per session; the coachmark also dedupes across sessions.
let tutorialContactDone = false;
// R2d — set while a player PLAYOFF match is in flight so showMatchEndModal routes
// the result into the bracket (showPlayoffResult) rather than the season recorder.
let playoffActive = false;
// Guards the season-end morale epilogue (showSeasonEpilogue) so it plays at most
// once even though the end screens can be re-reached on resume/re-entry.
let seasonEpilogueDone = false;
// Phase 4 — story-flag hooks captured during the opening cutscene (Worlds winner,
// the player's dialogue choices); threaded into the new season at draft confirm.
let seasonStoryFlags: Record<string, string> = {};
// Plays the morale epilogue (any season-end leavers say goodbye) once, then runs
// the actual ending. A well-managed squad has no leavers ⇒ straight to the result.
function runEpilogueThen(after: () => void): void {
  if (!season || seasonEpilogueDone) { after(); return; }
  seasonEpilogueDone = true;
  showSeasonEpilogue(season, seasonLeavers(season), after);
}
function maybeTutorialContactPause(): void {
  if (matchMode !== 'season' || !season || season.idx !== 0) return;
  if (tutorialContactDone || state.round !== 1 || state.phase !== 'resolution') return;
  // tracking is keyed per-unit with null until acquisition; a non-null entry at
  // ticksLost 0 = a unit is actively seeing an enemy right now → first contact.
  const contact = Object.values(state.tracking).some((t) => t != null && t.ticksLost === 0);
  if (!contact) return;
  tutorialContactDone = true;
  loop.pause();
  showCoachmark('m1-contact', "<strong>Contact!</strong> Your units have spotted the enemy and a duel is about to break out. Watch how it plays — then press <strong>&#9654;</strong> (bottom-left) to resume.");
}

function setState(next: GameState) {
  state = next;
  rerenderAll();
}

// --- App screens (menu <-> match) -----------------------------------------

function renderMenu(): void {
  if (screen === 'menu') {
    renderMainMenu(menuHost, 'v0.122.0', {
      onPlay: startMode,
      onSettings: showSettingsModal,
      onPatchNotes: () => showHelpModal('patch'),
      onGuidebook: () => showHelpModal('play'),
      // Part 6 — Continue resumes the single-slot autosave; shown only when one exists.
      onContinue: hasSavedSeason() ? continueSeason : undefined,
    });
    menuHost.style.display = 'flex';
  } else {
    menuHost.style.display = 'none';
  }
}

function startMode(mode: MatchMode): void {
  clearPlanningUiState();
  clearCoachmarks();
  tutorialContactDone = false; // re-arm the first-contact pause for a fresh season
  playoffActive = false;
  setSeasonHeader(false);
  matchMode = mode;
  season = null;
  // Season opens on the campaign intro story, then a player-only draft; the
  // other modes launch straight into a match on the Settings-selected map.
  if (mode === 'season') {
    // Opening cutscene → welcome briefing → the draft, with Back stepping back up
    // the chain. The Worlds winner is rolled once here (stable across re-entry) and
    // the cutscene's choices + result are captured into seasonStoryFlags for the
    // season to carry (threaded in at draft confirm).
    seasonStoryFlags = {};
    const worldsChampion = Math.random() < 0.5 ? 'G3' : 'Paper Hex';
    // Opening cutscene → pre-draft "tryouts" beat → card tutorial → draft. Back
    // steps up the chain; the Worlds winner + cutscene choices feed seasonStoryFlags.
    const flowOpening = (): void => showSeasonOpening(worldsChampion, (flags) => {
      seasonStoryFlags = flags;
      flowPreDraft();
    }, goToMenu);
    const flowPreDraft = (): void => showPreDraftBeat(
      () => launchSeasonDraft(), // (card tutorial dropped — the new draft screen gets its own onboarding later)
      flowOpening,
    );
    flowOpening();
    return;
  }
  // Standard / Draft are dev/testing modes — keep enemies visible in planning.
  showEnemiesPlanning = true;
  state = buildInitialState(selectedMap, mode, matchSeed);
  initialUnitsById = snapshotUnits(state.units);
  screen = 'match';
  rerenderAll();
}

// Season plays on Canyon — its dense, tight geometry keeps unit movement legible
// (short rotations, forced contact) for the campaign. The draft is player-only
// (build your own squad); startSeason runs on confirm.
// Show the Match Prep screen for the current season match, then build + start it
// with the chosen prep (play style / leader / team talk). Used for match 1 (after
// the dashboard) and every subsequent match (from the match-end modal).
function launchMatchPrep(onBack?: () => void): void {
  const s = season;
  if (!s) return;
  showMatchPrep(s, state.map, (prep) => {
    const m = buildSeasonMatch(s, state.map, prep);
    initialUnitsById = snapshotUnits(m.units);
    setSeasonHeader(false); // live match — hide the management header
    setState(m);
  }, onBack,
    () => openSeasonPlaybook(() => launchMatchPrep(onBack)),
    // League table — view standings any time; re-open prep on close.
    () => showStandings(s, () => launchMatchPrep(onBack)));
}

// Open the season Playbook editor (B1 + Part 6 gating). Passes the authoring
// unlock (week-2 gate) and roster-derived capacity through to the editor; saves
// and deletes land on the live season.customStrategies AND the autosave so they
// persist + resolve. `onClose` decides where we return.
function openSeasonPlaybook(onClose: () => void, tutorial = false): void {
  let handle: { refresh: () => void } | null = null;
  handle = showPlaybook(state.map, season?.customStrategies ?? [], season?.playerRoster ?? [], {
    onSave: (play) => {
      if (!season) return;
      // Upsert by id so editing a saved play (same id) updates it in place rather
      // than duplicating; a fresh save just appends.
      const others = season.customStrategies.filter((p) => p.id !== play.id);
      season = { ...season, customStrategies: [...others, play] };
      saveSeason(season);
      // B1b — measure the play's matchup lazily in a background worker; when it
      // lands, enrich the shared play object (visible to both season + the open
      // editor, same ref) and re-render the coach read in place.
      reviewPlay(play, state.map.name, COACH_REVIEW_SEEDS, (matchups, seeds) => {
        play.measured = { matchups, seeds };
        handle?.refresh();
      });
    },
    onDelete: (id) => {
      if (!season) return;
      const { [id]: _drop, ...restMastery } = season.playMastery ?? {};
      season = { ...season, customStrategies: season.customStrategies.filter((p) => p.id !== id), playMastery: restMastery };
      saveSeason(season);
    },
    onClose,
  }, {
    authoringUnlocked: season?.authoringUnlocked ?? false,
    capacity: playbookCapacity(season?.playerRoster ?? []) + (season?.bonusPlaybookSlots ?? 0),
    playMastery: season?.playMastery ?? {},
    tutorial,
  });
}

// Phase 4 — run a data-driven ambient event for a week slot. Rolls the event
// deterministically (stable per slotKey), shows the generic screen, applies the
// chosen effects to the live season, then hands off (onDone advances + saves).
// Effects are applied here but NOT saved until onDone advances the phase, so a
// reload mid-event re-rolls the same event and re-applies nothing.
function runWeekEvent(slotKey: string, onDone: () => void): void {
  if (!season) return;
  const { event, subjectId } = rollEvent(season, slotKey);
  const subject = subjectId ? (season.playerRoster.find((u) => u.id === subjectId) ?? null) : null;
  const subjectName = subject?.name ?? null;
  const extra = eventFlavor(event, subject, season.results);
  showEventScreen(event, subjectName, extra, (choiceIdx) => {
    season = applyEvent(season!, event, subjectId, choiceIdx);
    onDone();
  });
}

// Phase 3e — after a slot's ambient content, surface any READY character-arc beat.
// ONE beat resolves per slot: if two+ are ready, Sam frames a choice (engage one;
// the rest are held, and after two holds a beat defaults to its neglect path).
function runArcBeats(slot: 'pre-match' | 'post-match', onDone: () => void): void {
  if (!season) { onDone(); return; }
  const ctx: SlotContext = {
    slot, idx: season.idx, week: currentWeek(season), wins: seasonWins(season),
    matchSummary: slot === 'post-match' ? (season.lastMatchSummary ?? null) : null,
  };
  const ready = readyBeats(season, ctx);
  // After the beat (or if none), resolve any arc departures that have come due.
  const done = (): void => runDepartures(onDone);
  if (ready.length === 0) { done(); return; }

  const play = (arcId: string, held: string[]): void => {
    for (const a of held) season = holdBeat(season!, a);
    const arc = ARCS[arcId];
    const rt = season!.arcs.find((r) => r.arcId === arcId)!;
    const beat = arc.beats[rt.stage];
    const subject = season!.playerRoster.find((u) => u.characterId === arc.characterId) ?? null;
    const extra = arcFlavor(beat, subject, season!.results);
    showArcBeat(beat, subject?.name ?? null, extra, season!.storyFlags ?? {},
      (choiceIdx) => {                        // apply the beat, return what changed for the chips
        const res = advanceArc(season!, arcId, choiceIdx, ctx);
        season = res.season;
        saveSeason(season);
        return res.effects;
      },
      done,
    );
  };

  if (ready.length === 1) { play(ready[0].arcId, []); return; }
  // Collision — Sam holds one arc while you take the other (a held beat can wait
  // two slots before it defaults). One beat per slot keeps the triage real.
  const opts = ready.map((r) => {
    const arc = ARCS[r.arcId];
    const u = season!.playerRoster.find((x) => x.characterId === arc.characterId);
    return { arcId: r.arcId, name: u?.name ?? arc.characterId };
  });
  const rest = opts.length > 2 ? ' and the others' : '';
  const body = `<p class="me-headline">Sam catches you in the doorway. &ldquo;${opts[0].name} and ${opts[1].name}${rest} both wanted a word. Take one — I'll keep the rest company for now.&rdquo;</p>`;
  showModal('A word before you go', body, opts.map((o, i) => ({
    label: `Sit with ${o.name}`, primary: i === 0,
    onClick: () => play(o.arcId, opts.filter((x) => x.arcId !== o.arcId).map((x) => x.arcId)),
  })));
}

// Phase 4b — resolve any arc-triggered departures now due: the player says goodbye,
// the room takes a morale hit, and you sign a replacement from the reserve (the
// Origins you passed on). Runs after each slot's arc beat. None due ⇒ straight
// through. If the reserve is somehow empty, the departure is cancelled (the player
// stays) so the roster never drops below five.
function runDepartures(onDone: () => void): void {
  if (!season) { onDone(); return; }
  const due = dueDepartures(season);
  if (due.length === 0) { onDone(); return; }
  const handle = (i: number): void => {
    if (!season || i >= due.length) { if (season) saveSeason(season); onDone(); return; }
    const dep = due[i];
    if (reserveOrigins(season).length === 0) { season = cancelDeparture(season, dep.characterId); handle(i + 1); return; }
    const res = departPlayer(season, dep.characterId);
    season = res.season;
    if (!res.slotId) { saveSeason(season); handle(i + 1); return; }
    saveSeason(season);
    showRedraft(res.unit, reserveOrigins(season), dep.reason, (pickedId) => {
      season = signReplacement(season!, pickedId, res.slotId!);
      saveSeason(season);
      handle(i + 1);
    });
  };
  handle(0);
}

// Part 6 — the season week loop. Drives the meta-loop one phase at a time off
// season.phase: training → preEvent → match → postEvent, with a one-off
// mid-season break between the halves. Re-entrant (each screen's Continue calls
// back in) and resumable from the autosave. The match phase delegates to the
// existing match flow; showMatchEndModal records the result, advances to
// postEvent, and re-enters here. `onFirstBack` wires the week-1 training Back
// button to the pre-season dashboard; later weeks are forward-only.
function runSeasonWeek(onFirstBack?: () => void): void {
  const s = season;
  if (!s) return;
  setSeasonHeader(true); // management context — show the header (refreshes week/LP)
  const advance = (): void => {
    season = advanceSeasonPhase(season!);
    saveSeason(season);
    runSeasonWeek();
  };
  switch (s.phase) {
    case 'training': {
      // 3e — standing-condition weekly morale drift (e.g. imissu's Homesick), once
      // per week (driftWeek guard so a resume doesn't re-apply).
      const driftWk = String(currentWeek(s));
      if (s.storyFlags?.driftWeek !== driftWk) {
        season = { ...season!, morale: applyWeeklyMoraleDrift(season!.morale ?? {}, season!.playerRoster), storyFlags: { ...(season!.storyFlags ?? {}), driftWeek: driftWk } };
        saveSeason(season);
      }
      const openTraining = (): void => {
      const cur = season!; // live read — a flight-risk beat may have moved morale first
      showTrainingDay(currentWeek(cur), cur.playerRoster, cur.focusFreshness ?? {}, cur.morale ?? {}, cur.customStrategies, cur.playMastery ?? {}, cur.leaguePoints, (choice) => {
        // Apply the free session (optionally focused), then any LP-bought extra
        // whole-squad sessions; Set-Pieces on a chosen play also drills its mastery.
        // Deduct the League Points spent. Then roll the week forward.
        const before = season!.playerRoster;
        let res = applyTraining(season!.playerRoster, choice.track, { focusId: choice.focusId, freshness: season!.focusFreshness ?? {} });
        let roster = res.roster;
        let freshness = res.freshness;
        for (const [t, n] of Object.entries(choice.extras)) {
          for (let i = 0; i < n; i++) {
            res = applyTraining(roster, t as typeof choice.track, { freshness });
            roster = res.roster;
            freshness = res.freshness;
          }
        }
        const playMastery = choice.track === 'setpieces' && choice.drilledPlayId
          ? drillPlay(season!.playMastery ?? {}, choice.drilledPlayId)
          : season!.playMastery ?? {};
        season = { ...season!, playerRoster: roster, focusFreshness: freshness, playMastery, leaguePoints: season!.leaguePoints - choice.lpSpent };
        saveSeason(season);
        // Phase 5 — resolve any training-day obligations (e.g. Cardo's promise to be focus-trained).
        if ((season!.obligations ?? []).length > 0) {
          const focusedChar = choice.focusId ? season!.playerRoster.find((u) => u.id === choice.focusId)?.characterId : undefined;
          let sfx = season!;
          for (const ob of season!.obligations ?? []) {
            const kept = ob.require === 'focused-self' && focusedChar === ob.characterId;
            if (!kept) { const sid = sfx.playerRoster.find((u) => u.characterId === ob.characterId)?.id ?? null; sfx = applyEffects(sfx, ob.onBreak, sid); }
          }
          season = { ...sfx, obligations: [] };
          saveSeason(season);
        }
        // 3e — announce any attribute tier the session(s) pushed the squad across, then advance.
        showBreakpoints(crossedBreakpoints(before, roster), roster, advance);
      }, cur.idx === 0 ? onFirstBack : undefined, cur.idx === Math.floor(cur.K / 2));
      };
      // Mid-season flight risk: surface a struggling player once (before training).
      // Intervening lifts their morale clear of it; ignoring leaves them at risk for
      // the season-end epilogue. Fires at most once per player (frHandled list).
      const afterIntro = (): void => {
        const handled = (season!.storyFlags?.frHandled ?? '').split(',').filter(Boolean);
        const at = flightRiskCandidate(season!, handled);
        if (at) {
          showFlightRiskBeat(at, (effects) => {
            season = applyEffects(season!, effects, at.id);
            season = { ...season!, storyFlags: { ...(season!.storyFlags ?? {}), frHandled: [...handled, at.id].join(',') } };
            saveSeason(season);
            openTraining();
          });
        } else openTraining();
      };
      // Week 4 (idx 3): Sam's coffee check-in + off-week heads-up, once, before training.
      if (s.idx === 3 && !s.storyFlags?.offWeekLean) {
        showWeek4Beat(seasonWins(s), s.playerRoster, (lean) => {
          season = { ...season!, storyFlags: { ...(season!.storyFlags ?? {}), offWeekLean: lean } };
          saveSeason(season);
          afterIntro();
        });
      } else {
        afterIntro();
      }
      break;
    }
    case 'preEvent': {
      // Week 2 (idx 1): the analyst kid (Remi) ambushes you outside — accepting
      // unlocks detailed scouting (you pick a focus) AND the custom playbook.
      if (s.idx === 1 && !s.authoringUnlocked) {
        showScoutIntroBeat((focus) => {
          season = {
            ...season!,
            authoringUnlocked: true,
            storyFlags: { ...(season!.storyFlags ?? {}), scoutingUnlocked: 'true', scoutFocus: focus, 'remi-met': 'true' },
          };
          saveSeason(season);
          // The playbook just opened — drop the player straight into the editor with
          // a guided tour the week it's introduced, then carry on to the match.
          openSeasonPlaybook(() => runArcBeats('pre-match', advance), true);
        });
      } else {
        runWeekEvent(`pre-${s.idx}`, () => runArcBeats('pre-match', advance));
      }
      break;
    }
    case 'match':
      // The match runs through the GameState loop; showMatchEndModal records the
      // result, steps the phase to postEvent, and re-enters runSeasonWeek.
      launchMatchPrep();
      break;
    case 'postEvent':
      // After match 1 (idx === 1): Sam and the player reflect on the first match
      // (tone branches on win/loss) — planting the idea of deeper scouting + their
      // own playbook (both unlock at the week-2 pre-match scout-kid beat).
      if (s.idx === 1) {
        showPostMatch1Beat(s.results[0] === 'W', s.playerRoster, () => runArcBeats('post-match', advance));
        break;
      }
      // After match 3 (idx === 3): the assistant coach explains the league format
      // on the standings screen — round-robin, and your next match is the last
      // before the bye (the mid-season break, when the league plays on without you).
      if (s.idx === 3) {
        showStandings(s, () => runArcBeats('post-match', () => {
          if (seasonOver(season!)) { endRegularSeason(); return; }
          advance();
        }), {
          kicker: 'Assistant coach',
          title: 'How the league works',
          sub: `It's a round-robin — you'll face all eight rivals once, and the top ${LEAGUE.playoffTeams} make the playoffs. Heads up: after your next match it's your <strong>bye week</strong> — the mid-season break. The league plays on without you, so the table will shift while you rest. Reach the final to save the shop.`,
        });
        break;
      }
      runWeekEvent(`post-${s.idx}`, () => runArcBeats('post-match', () => {
        if (seasonOver(season!)) { endRegularSeason(); return; }
        advance();
      }));
      break;
    case 'break': {
      // Week-5 bye: lock in the off-week focus (anchored to the week-4 lean), the
      // squad reacts in character, then the trade-off lands + is shown before the
      // week rolls on to its Special Training.
      const lean = s.storyFlags?.offWeekLean ?? 'undecided';
      showWeek5Break(s.playerRoster, s.morale ?? {}, seasonWins(s), s.results.length, lean, (focus) => {
        const effects = offWeekEffects(focus);
        const body = effects.length
          ? `<p class="me-headline">How the week landed:</p>${effectChipsHtml(effects, null)}`
          : `<p class="me-headline">The week drifted by — no plan, no edge gained. A missed chance the rivals won't waste.</p>`;
        showModal('The bye week', body, [{ label: 'On to Special Training →', primary: true, onClick: () => {
          season = { ...applyEffects(season!, effects, null), storyFlags: { ...(season!.storyFlags ?? {}), offWeekFocus: focus } };
          saveSeason(season);
          advance();
        } }]);
      });
      break;
    }
  }
}

// Part 6 — resume the autosaved season from the main menu. Rebuilds a live
// GameState on the season's map (standard build = no draft) as the backdrop for
// the week-loop overlays, drops in the current week's matchup, then hands off to
// the week loop at the saved phase.
function continueSeason(): void {
  const loaded = loadSeason();
  if (!loaded) return;
  clearPlanningUiState();
  clearCoachmarks();
  matchMode = 'season';
  season = loaded;
  showEnemiesPlanning = false;
  state = buildInitialState(loaded.mapName, 'standard', loaded.seed);
  // Drop in the current week's matchup as the backdrop — but only while there
  // IS one. A save parked at the final post-event has idx === K (no schedule
  // entry left); buildSeasonMatch would index past the schedule, so skip it and
  // let runSeasonWeek fall straight through postEvent → season results.
  if (!seasonOver(loaded)) state = buildSeasonMatch(loaded, state.map);
  initialUnitsById = snapshotUnits(state.units);
  screen = 'match';
  playoffActive = false;
  rerenderAll();
  // Regular season done → resume the playoffs (or the missed-out ending);
  // otherwise pick up the week loop at the saved phase.
  if (seasonOver(loaded)) endRegularSeason();
  else runSeasonWeek();
}

function launchSeasonDraft(): void {
  // Campaign: enemies are hidden during planning (proper fog) — the read comes
  // from the Scout, not from seeing their setup. The "Enemies" toggle still works.
  showEnemiesPlanning = false;
  state = buildInitialState('Canyon', 'season', matchSeed);
  initialUnitsById = snapshotUnits(state.units);
  screen = 'match';
  rerenderAll();
}

function goToMenu(): void {
  dismissModal();
  clearCoachmarks();
  loop.pause();
  season = null;
  playoffActive = false;
  setSeasonHeader(false);
  // B0/B1 — drop any authored plays from the strategy registry so a fresh
  // (non-season) match started from the menu doesn't inherit the prior season's
  // custom plays. Season matches re-register their own set in buildSeasonMatch.
  clearCustomStrategies();
  screen = 'menu';
  rerenderAll();
}

function showSettingsModal(): void {
  const maps: [string, string][] = [['Foundryv4', 'Foundry IV'], ['Atoll_v2', 'Atoll II'], ['Canyon', 'Canyon']];
  const opts = maps.map(([v, l]) => `<option value="${v}"${v === selectedMap ? ' selected' : ''}>${l}</option>`).join('');
  const body =
    '<div style="display:flex;flex-direction:column;gap:14px;">' +
    '<label style="font-size:13px;">Map <span style="color:#8a92a3;">(Standard / Draft)</span><br>' +
    `<select id="set-map" style="margin-top:4px;padding:6px;background:#0e1116;color:#d6dae3;border:1px solid #232838;border-radius:4px;width:100%;">${opts}</select></label>` +
    `<label style="font-size:13px;">Seed<br><input id="set-seed" type="number" value="${matchSeed}" style="margin-top:4px;padding:6px;background:#0e1116;color:#d6dae3;border:1px solid #232838;border-radius:4px;width:100%;"></label>` +
    '<p style="font-size:11px;color:#8a92a3;margin:0;">Season always plays on Canyon — its tight geometry keeps the campaign readable.</p>' +
    '</div>';
  showModal('Settings', body, [{ label: 'Done', primary: true, onClick: () => {} }]);
  const mapSel = document.getElementById('set-map') as HTMLSelectElement | null;
  mapSel?.addEventListener('change', () => { selectedMap = mapSel.value as MapDefinition['name']; });
  const seedInp = document.getElementById('set-seed') as HTMLInputElement | null;
  seedInp?.addEventListener('change', () => { const s = parseInt(seedInp.value, 10); if (!Number.isNaN(s)) matchSeed = s >>> 0; });
}

// Missed the playoffs (finished 5th–9th) — the season ends here. (Making the top
// 4 routes to the playoff bracket instead; see endRegularSeason / showPlayoffEnd.)
function showSeasonEndModal(): void {
  const s = season;
  if (!s) return;
  setSeasonHeader(false);
  // Morale reckoning first — any low-morale players say goodbye before the result.
  if (!seasonEpilogueDone) { runEpilogueThen(showSeasonEndModal); return; }
  clearSavedSeason();
  const wins = seasonWins(s);
  const losses = s.results.length - wins;
  const rank = playerRank(s);
  const story = `<strong>${ordinal(rank)} of ${LEAGUE.teams}.</strong> ${wins}–${losses} — short of the top ${LEAGUE.playoffTeams} it took to reach the playoffs. The shop's future is up in the air... but a scrappy roster of locals just proved it can hang with the circuit. There's always next season.`;
  const body = `<p class="me-headline">${story}</p>${standingsTableHtml(s)}`;
  showModal('The season ends', body, [
    { label: 'New season', primary: true, onClick: () => startMode('season') },
    { label: 'Main menu', onClick: goToMenu },
  ]);
}

// --- R2d: playoffs ---------------------------------------------------------
// The bracket team-index of the player's current opponent: in a semifinal it's
// the other team in their pair; in the final it's the other semifinal's winner.
function playerPlayoffOpponent(po: { seeds: number[]; semiA: number | null; semiB: number | null; stage: string }): number {
  const p = LEAGUE.playerTeamIndex;
  const inA = po.seeds[0] === p || po.seeds[3] === p;
  if (po.stage === 'semi') {
    return inA ? (po.seeds[0] === p ? po.seeds[3] : po.seeds[0]) : (po.seeds[1] === p ? po.seeds[2] : po.seeds[1]);
  }
  return inA ? (po.semiB ?? -1) : (po.semiA ?? -1);
}

// Regular season over → branch: top 4 enter the bracket (init once, idempotent on
// resume), everyone else gets the missed-playoffs ending.
function endRegularSeason(): void {
  if (!season) return;
  if (!madePlayoffs(season)) { showSeasonEndModal(); return; }
  if (!season.playoffs) {
    const seeds = playoffSeeds(season).map((r) => r.teamIndex);
    season = { ...season, playoffs: { seeds, semiA: null, semiB: null, champion: null, stage: 'semi' } };
    saveSeason(season);
  }
  if (season.playoffs!.stage === 'done') { showPlayoffEnd(); return; }
  runPlayoffs();
}

// Drive the bracket: resolve the rival half of the round (seeded sim), show the
// bracket, then play the player's match — or finish. Re-entrant + resumable.
function runPlayoffs(): void {
  if (!season?.playoffs) return;
  setSeasonHeader(true);
  const po = season.playoffs;
  if (po.stage === 'done') { showPlayoffEnd(); return; }
  const p = LEAGUE.playerTeamIndex;
  const inA = po.seeds[0] === p || po.seeds[3] === p;
  if (po.stage === 'semi') {
    // Sim the semifinal the player isn't in (once) so the final opponent is known.
    let semiA = po.semiA;
    let semiB = po.semiB;
    if (inA && semiB === null) semiB = simPlayoffWinner(season, 0, po.seeds[1], po.seeds[2]);
    if (!inA && semiA === null) semiA = simPlayoffWinner(season, 0, po.seeds[0], po.seeds[3]);
    if (semiA !== po.semiA || semiB !== po.semiB) {
      season = { ...season, playoffs: { ...po, semiA, semiB } };
      saveSeason(season);
    }
    showBracket(season, () => launchPlayoffMatch('Semifinal', 0), {
      title: 'Semifinals',
      sub: 'Win it to reach the final. The other semifinal has already been decided.',
      cta: 'To your semifinal →',
    });
    return;
  }
  // final
  showBracket(season, () => launchPlayoffMatch('Final', 1), {
    title: 'The Final',
    sub: 'One match for the title — and to save the shop.',
    cta: 'To the final →',
  });
}

// Player's playoff match through Match Prep (with the bracket opponent override).
function launchPlayoffMatch(label: string, roundSalt: number): void {
  if (!season?.playoffs) return;
  const oppTi = playerPlayoffOpponent(season.playoffs);
  const k = rivalMatchIndexFor(oppTi);
  const oppRoster = season.schedule[k];
  const oppInfo = season.opponents[k];
  const reenter = (): void => launchPlayoffMatch(label, roundSalt);
  showMatchPrep(season, state.map, (prep) => {
    const m = buildPlayoffMatch(season!, state.map, prep, oppRoster, oppInfo, roundSalt);
    initialUnitsById = snapshotUnits(m.units);
    playoffActive = true;
    setSeasonHeader(false); // live match — hide the management header
    setState(m);
  }, undefined,
    () => openSeasonPlaybook(reenter),
    () => showStandings(season!, reenter),
    { info: oppInfo, oppRoster, label });
}

// A playoff match ended — award LP + match XP (no idx++/recordSeasonResult),
// update the bracket, then continue (next stage or the season-end).
function showPlayoffResult(): void {
  playoffActive = false;
  if (!season?.playoffs) return;
  const po = season.playoffs;
  const playedStage = po.stage;
  const p = LEAGUE.playerTeamIndex;
  const inA = po.seeds[0] === p || po.seeds[3] === p;
  const oppTi = playerPlayoffOpponent(po);
  const w = state.matchWinner;
  const playerWon = w === state.playerTeam;
  const oppTeam: Team = state.playerTeam === 'defenders' ? 'attackers' : 'defenders';
  const pr = state.scores[state.playerTeam];
  const or = state.scores[oppTeam];
  const lp = leaguePointsForResult(playerWon, pr, or);
  // Bank LP + match XP + morale ripple (carry to next season). No idx advance, no results[] push.
  let next: SeasonState = {
    ...season,
    leaguePoints: season.leaguePoints + lp,
    playerRoster: applyMatchExperience(season.playerRoster),
    morale: applyMatchMorale(season.morale ?? {}, season.playerRoster, playerWon),
  };
  let semiA = po.semiA;
  let semiB = po.semiB;
  let champion = po.champion;
  let stage = po.stage;
  const winnerTi = playerWon ? p : oppTi;
  if (playedStage === 'semi') {
    if (inA) semiA = winnerTi; else semiB = winnerTi;
    if (playerWon) {
      stage = 'final';
    } else {
      // Eliminated — crown a champion from the two semifinal winners (flavour).
      const otherWinner = inA ? semiB! : semiA!;
      champion = simPlayoffWinner(next, 1, otherWinner, winnerTi);
      stage = 'done';
    }
  } else {
    champion = winnerTi;
    stage = 'done';
  }
  next = { ...next, playoffs: { ...po, semiA, semiB, champion, stage } };
  season = next;
  saveSeason(season);

  const stageName = playedStage === 'final' ? 'Final' : 'Semifinal';
  const headline = playerWon ? `You win the ${stageName}!` : `You lose the ${stageName}.`;
  const lpLine = `League Points: <strong>+${lp}</strong> earned · <strong>${season.leaguePoints}</strong> total.`;
  showModal(playerWon ? `${stageName} won` : `${stageName} lost`,
    `<p class="me-headline">${headline}</p><p class="me-headline">${lpLine}</p>${renderMatchEndScoreboard(state)}`,
    [{ label: 'Continue', primary: true, onClick: runPlayoffs }]);
}

// Bracket complete — champion / finalist (shop saved) / semifinalist ending.
function showPlayoffEnd(): void {
  if (!season?.playoffs) return;
  setSeasonHeader(false);
  // Morale reckoning first — even champions can lose a disillusioned player.
  if (!seasonEpilogueDone) { runEpilogueThen(showPlayoffEnd); return; }
  clearSavedSeason();
  const po = season.playoffs;
  const p = LEAGUE.playerTeamIndex;
  const reachedFinal = po.semiA === p || po.semiB === p;
  const isChampion = po.champion === p;
  const outcome: 'champion' | 'finalist' | 'semifinalist' = isChampion ? 'champion' : reachedFinal ? 'finalist' : 'semifinalist';
  const prize = ECONOMY.playoffPrize[outcome];
  const champName = po.champion != null ? teamNameForIndex(season, po.champion) : '—';
  const title = isChampion ? 'CHAMPIONS — the shop is saved!' : reachedFinal ? 'Finalists — the shop is saved' : 'Out in the semifinals';
  const story = isChampion
    ? '<strong>You won it all.</strong> Pixel Perfect lifts the trophy — the prize money clears the debt with room to spare, and Sam frames the bracket above the counter.'
    : reachedFinal
      ? `<strong>So close.</strong> You made the final — ${champName} took the title, but reaching it was enough: the finalist prize keeps the lights on. Next season, the trophy.`
      : `<strong>A real run.</strong> You made the playoffs and pushed to the semifinals before ${champName} ended it. Not the fairytale — but a scrappy shop squad just proved it belongs.`;
  const moneyLine = `Prize money: <strong>$${prize.toLocaleString()}</strong>${outcome === 'semifinalist' ? ' — not enough to save the shop, but a foundation for next season.' : ''}`;
  showModal(title, `<p class="me-headline">${story}</p><p class="me-headline">${moneyLine}</p>${bracketHtml(season)}`, [
    { label: 'New season', primary: true, onClick: () => startMode('season') },
    { label: 'Main menu', onClick: goToMenu },
  ]);
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
  // Pass 9 m1 / H3.4 — round-start summary in the Action Log. Card fields
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
  // R2d — a playoff match routes into the bracket, not the regular-season recorder.
  if (playoffActive) { showPlayoffResult(); return; }
  const w = state.matchWinner;
  const playerWon = w === state.playerTeam;
  const headline =
    w === 'draw'
      ? 'Sudden-death tiebreaker is deferred to Pass 9. Match ends in a draw.'
      : `Final score: ${state.scores.defenders} (defenders) – ${state.scores.attackers} (attackers).`;
  const scoreboard = renderMatchEndScoreboard(state);

  // Season: record this match, advance to the week's post-match event, then
  // re-enter the week loop (it surfaces the post-event, then the next week — or
  // the season results once the schedule is done).
  if (season) {
    // v1 economy — League Points earned from this result (win base + margin, or a
    // loss consolation), banked in recordSeasonResult. Computed here too for the
    // matchday readout. Round scores: player's vs the opponent's.
    const oppTeam: Team = state.playerTeam === 'defenders' ? 'attackers' : 'defenders';
    const playerRounds = state.scores[state.playerTeam];
    const oppRounds = state.scores[oppTeam];
    const lpEarned = leaguePointsForResult(playerWon, playerRounds, oppRounds);
    season = recordSeasonResult(season, playerWon, playerRounds, oppRounds); // advances idx + banks LP
    // Part 6 (3d) — bank match experience: Improvisation (Composure/Adaptability)
    // grows only by playing, so a green squad firms up over the season.
    const beforeXp = season.playerRoster;
    season = { ...season, playerRoster: applyMatchExperience(season.playerRoster) };
    const xpCrossings = crossedBreakpoints(beforeXp, season.playerRoster); // 3e — match-XP milestones
    const afterRoster = season.playerRoster;
    // Phase 4 — morale ripple: a win lifts the room, a loss stings.
    season = { ...season, morale: applyMatchMorale(season.morale ?? {}, season.playerRoster, playerWon) };
    // 3e — stamp the finished match's summary (last-alive / negative-K/D) for the
    // post-event slot's onMatchEvent arc triggers (e.g. Moony's curse).
    season = { ...season, lastMatchSummary: matchSummary(state) };
    season = advanceSeasonPhase(season);            // match → postEvent
    saveSeason(season);
    const wins = seasonWins(season);
    const rank = playerRank(season);
    const seasonLine = `Season: ${wins}–${season.results.length - wins} after ${season.idx} of ${season.K} · currently <strong>${ordinal(rank)} of ${LEAGUE.teams}</strong> — top ${LEAGUE.playoffTeams} make the playoffs.`;
    // v1 economy — League Points earned this match + running total (spend on training).
    const lpLine = `League Points: <strong>+${lpEarned}</strong> earned · <strong>${season.leaguePoints}</strong> total — spend them on training.`;
    const moraleLine = `Squad morale: <strong>${moraleLabel(teamMorale(season.morale, season.playerRoster))}</strong> — ${playerWon ? 'the win lifts the room' : 'a tough one to take'}.`;
    const title = w === 'draw' ? 'Match drawn' : playerWon ? 'Match won' : 'Match lost';
    showModal(title, `<p class="me-headline">${headline}</p><p class="me-headline">${seasonLine}</p><p class="me-headline">${lpLine}</p><p class="me-headline">${moraleLine}</p>${scoreboard}`, [
      // Surface any tier the match XP pushed the squad across, then continue the week.
      { label: 'Continue', primary: true, onClick: () => showBreakpoints(xpCrossings, afterRoster, () => runSeasonWeek()) },
      { label: 'Main menu', onClick: goToMenu },
    ]);
    return;
  }

  const title = w === 'draw' ? 'Draw — 3–3' : `${playerWon ? 'You win!' : 'Opponent wins'}`;
  const currentMap = state.map.name;
  showModal(title, `<p class="me-headline">${headline}</p>${scoreboard}`, [
    {
      label: 'New match',
      primary: true,
      onClick: () => {
        clearPlanningUiState();
        matchSeed = (matchSeed + 1) >>> 0;
        state = buildInitialState(currentMap, matchMode, matchSeed);
        initialUnitsById = snapshotUnits(state.units);
        rerenderAll();
      },
    },
    { label: 'Main menu', onClick: goToMenu },
  ]);
}

// --- Loop ------------------------------------------------------------------

const loop = new PlaybackLoop({
  getState: () => state,
  setState: (next) => { state = next; },
  onTick: () => { rerenderAll(); maybeTutorialContactPause(); },
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
