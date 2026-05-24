// Entry point. Wires game state, render, the playback loop, hover, click-to-
// command, and the Pass 7 match flow (planning → resolution → round-end →
// halftime/next round → match end).

import './style.css';
import type { GameState, HexCoord, PlayedCard, PlaybackSpeed, Team, Unit } from './game/types.ts';
import { previewPlayerPlan } from './game/planningPreview.ts';
import { cardById } from './game/cardData.ts';
import { buildInitialState } from './game/state.ts';
import { assignTarget } from './game/movement.ts';
import { stepTick } from './game/tick.ts';
import { computePerUnitDebug, computeVisibility } from './game/vision.ts';
import { resolveShot } from './game/combat.ts';
import type { ShotContextInput } from './game/combat.ts';
import { createRng } from './game/rng.ts';
import { runBatch, runSkirmish } from './game/batch.ts';
import { ROLE_AGGRESSION } from './game/config.ts';
import { PlaybackLoop } from './game/loop.ts';
import { DEBUG_KEY } from './game/config.ts';
import {
  advanceToNextRound,
  applyStrategies,
  commitCards,
  processCardsAtRoundEnd,
  halftimeSwap,
  isHalftime,
  recordStrategyWin,
  startRound,
} from './game/match.ts';
import { pickAiCard, pickAiStrategy } from './game/aiOpponent.ts';
import { defenderTeam, eliminationWinner, endRound as endRoundFn } from './game/match.ts';
import { ROUND_TICK_LIMIT } from './game/config.ts';
import { strategiesFor } from './game/strategies.ts';
import { setupCanvas } from './render/canvas.ts';
import { render } from './render/renderer.ts';
import type { DebugOverlay, RenderHover, Selection } from './render/renderer.ts';
import { buildShell } from './ui/layout.ts';
import { renderSidePanel } from './ui/sidePanel.ts';
import { renderBottomControls } from './ui/bottomControls.ts';
import { renderTopBar } from './ui/topBar.ts';
import { attachHover } from './ui/hover.ts';
import { attachClickToCommand } from './ui/clickToCommand.ts';
import { showModal } from './ui/modal.ts';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('#app root missing in index.html');

const shell = buildShell(root);
let state: GameState = buildInitialState();

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

// Pass 8 — planning UI state. `playerCard` is the card the player has chosen
// (with optional target). `previewRoutes` is the cached preview from
// previewPlayerPlan; recomputed on every selection change. Both live in UI
// state (not GameState) and reset to null on Begin Round / round end.
let playerCard: PlayedCard | null = null;
let previewRoutes: Record<string, HexCoord[]> | null = null;

// Pass 8 — auto-target a card on selection. Untargeted cards return immediately;
// targeted cards pick a sensible default so the player can play any card from
// the hand with one click. A future milestone adds canvas click-to-target.
function autoTargetCard(defId: string, contributorId: string): PlayedCard | null {
  const def = cardById(defId);
  if (!def) return null;
  const played: PlayedCard = { defId, contributor: contributorId };
  if (def.targeting === 'none') return played;

  // Pass 9 m3 — Mark Target no longer needs a target: the contributor's
  // first-spotted enemy is the mark. Fall through to the untargeted return.
  if (defId === 'setup_play' || defId === 'hold_the_line') {
    // Default hex = the contributor's current position (will be overridden by
    // strategy in applyStrategies, but commitCards' handler then sets it back).
    const u = state.units.find((unit) => unit.id === contributorId);
    if (!u) return null;
    played.target = u.pos;
    if (defId === 'setup_play') {
      // Bonus ally = first teammate that isn't the contributor.
      const ally = state.units.find((unit) => unit.team === state.playerTeam && unit.id !== contributorId);
      if (ally) played.secondaryTarget = ally.id;
    }
    return played;
  }
  if (defId === 'adapt') {
    // Default = Spearhead (Vanguard role) — universally useful effect.
    played.target = 'Vanguard';
    return played;
  }
  return played;
}

function recomputePreview(): void {
  previewRoutes = previewPlayerPlan(state, {
    strategyId: state.playerStrategy,
    card: playerCard,
  }).routes;
}

// --- Render pipeline -------------------------------------------------------

function rerenderCanvas() {
  render(handle.ctx, state, hover, selection, debug, handle.cssWidth, handle.cssHeight, showEnemiesPlanning, previewRoutes);
}

function rerenderChrome() {
  const hovered = hover.unitId
    ? state.units.find((u) => u.id === hover.unitId) ?? null
    : null;
  renderSidePanel(shell.sidePanel, hovered, state, {
    onPickStrategy: (id: string) => {
      setState({ ...state, playerStrategy: id });
      recomputePreview();
      rerenderCanvas();
    },
    // Pass 8 — pick (or clear) a card from the player's hand. For targeted
    // cards we auto-pick a sensible default in v0 (a future milestone adds
    // canvas click-targeting). The handler then triggers a preview recompute.
    onPickCard: (defId: string | null) => {
      if (defId === null) {
        playerCard = null;
      } else {
        const inHand = state.cards[state.playerTeam].hand.find((c) => c.defId === defId);
        if (!inHand) return;
        playerCard = autoTargetCard(defId, inHand.contributor);
      }
      recomputePreview();
      rerenderAll();
    },
    selectedCardId: playerCard?.defId ?? null,
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
      state = buildInitialState(name);
      initialUnitsById = snapshotUnits(state.units);
      rerenderAll();
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

function snapshotUnits(units: readonly Unit[]): Record<string, Unit> {
  const out: Record<string, Unit> = {};
  for (const u of units) out[u.id] = { ...u, pos: { ...u.pos }, modifiers: { ...u.modifiers } };
  return out;
}

// --- Match flow ------------------------------------------------------------

function beginRound(): void {
  if (!state.playerStrategy) return;
  const aiTeam: Team = state.playerTeam === 'defenders' ? 'attackers' : 'defenders';
  const aiSide = state.teamSide[aiTeam];
  const pickRng = createRng((state.seed ^ (state.round * 0x9e3779b1)) >>> 0);
  const aiId = pickAiStrategy(state, aiTeam, aiSide, pickRng);
  let next = applyStrategies(state, state.playerTeam, state.playerStrategy, aiTeam, aiId, pickRng);
  // Pass 8 — AI picks its card here (player's card is the UI-held playerCard).
  const aiCard = pickAiCard(state, aiTeam, aiSide, aiId, pickRng);
  next = commitCards(next, state.playerTeam, playerCard, aiTeam, aiCard, pickRng);
  // Pass 9 m1 — round-start summary in the kill feed so the player can see
  // what the AI picked without devtools.
  next = {
    ...next,
    events: [
      ...next.events,
      {
        tick: next.tick,
        type: 'strategyPick',
        round: next.round,
        playerTeam: next.playerTeam,
        playerStrategy: next.playerStrategy,
        aiStrategy: next.aiStrategy,
        playerCardDefId: playerCard?.defId ?? null,
        aiCardDefId: aiCard?.defId ?? null,
      },
    ],
  };
  initialUnitsById = snapshotUnits(next.units);
  setState(next);
  // Clear UI selection so the next planning phase starts fresh.
  playerCard = null;
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
  // Pass 8 — discard played cards + draw back up to hand cap (deterministic).
  state = processCardsAtRoundEnd(state, state.seed, state.round);

  const scoreLine = `Score: ${state.scores[state.playerTeam]} – ${state.scores[state.playerTeam === 'defenders' ? 'attackers' : 'defenders']}`;
  const body =
    winner === 'draw'
      ? `Round ${state.round} ended in a draw. ${scoreLine}`
      : winner === state.playerTeam
        ? `You win round ${state.round}. ${scoreLine}`
        : `Opponent wins round ${state.round}. ${scoreLine}`;

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
  const body =
    w === 'draw'
      ? 'Sudden-death tiebreaker is deferred to Pass 9. Match ends in a draw.'
      : `Final score: ${state.scores.defenders} (defenders) – ${state.scores.attackers} (attackers).`;
  const currentMap = state.map.name;
  showModal(title, body, [{
    label: 'New Match',
    primary: true,
    onClick: () => {
      state = buildInitialState(currentMap);
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
  getUnits: () => state.units,
  onSelect: (unitId) => { selection.unitId = unitId; rerenderAll(); },
});

window.addEventListener('keydown', (ev) => {
  if (ev.key.toLowerCase() !== DEBUG_KEY) return;
  const target = ev.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
  debug.on = !debug.on;
  rerenderAll();
});

rerenderAll();

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
    setTrait: (id: string, skill: string | null) =>
      setState({ ...state, units: state.units.map((u) => (u.id === id ? { ...u, skillTrait: skill as Unit['skillTrait'] } : u)) }),
    setBehavioral: (id: string, t: string | null) =>
      setState({ ...state, units: state.units.map((u) => (u.id === id ? { ...u, behavioralTrait: t as Unit['behavioralTrait'] } : u)) }),
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
        hero: u.hero, skill: u.skillTrait, behavioral: u.behavioralTrait,
        aggression: u.modifiers.aggression, handling: u.modifiers.weaponHandling, offPos: u.modifiers.offPosition,
      })),
    runSkirmish: (seed: number, opts?: unknown) => runSkirmish(seed, opts as Parameters<typeof runSkirmish>[1]),
    runBatch: (n = 50, opts?: unknown) => runBatch(n, opts as Parameters<typeof runBatch>[1]),
    // --- Pass 7 match-flow hooks ---
    pickStrategy: (id: string) => setState({ ...state, playerStrategy: id }),
    beginRound: () => beginRound(),
    strategies: (side: 'attacker' | 'defender') =>
      strategiesFor(side, state.map).map((s) => ({ id: s.id, name: s.name, description: s.description })),
    // Run one round headlessly: apply the player's chosen strategy + AI pick,
    // step to elimination, end the round, then advance (with halftime swap).
    // Returns { winner, ticks, scoresAfter, matchOver, halftimeTaken }.
    simulateRound: (playerStrategyId: string, maxTicks = ROUND_TICK_LIMIT) => {
      if (state.matchOver) return { error: 'match over' };
      const aiTeam: Team = state.playerTeam === 'defenders' ? 'attackers' : 'defenders';
      const aiSide = state.teamSide[aiTeam];
      const pickRng = createRng((state.seed ^ (state.round * 0x9e3779b1)) >>> 0);
      const aiId = pickAiStrategy(state, aiTeam, aiSide, pickRng);
      let s = applyStrategies(state, state.playerTeam, playerStrategyId, aiTeam, aiId, pickRng);
      // Pass 8 — also apply cards (player's pre-committed + AI's pick) so
      // simulateRound exercises the full Begin-Round pipeline.
      const aiCard = pickAiCard(state, aiTeam, aiSide, aiId, pickRng);
      s = commitCards(s, state.playerTeam, state.playedCard[state.playerTeam], aiTeam, aiCard, pickRng);
      const startTick = s.tick;
      let winner: Team | null = null;
      for (let i = 0; i < maxTicks; i++) {
        s = stepTick(s);
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
    newMatch: (mapName?: 'Foundry' | 'Atoll') => {
      state = buildInitialState(mapName);
      initialUnitsById = snapshotUnits(state.units);
      rerenderAll();
    },
    setMap: (name: 'Foundry' | 'Atoll') => {
      state = buildInitialState(name);
      initialUnitsById = snapshotUnits(state.units);
      rerenderAll();
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
    // --- Pass 8 card hooks ---
    getHand: (team: Team) => state.cards[team].hand.map((c) => ({
      defId: c.defId, contributor: c.contributor, name: cardById(c.defId)?.name ?? c.defId,
    })),
    getDeck: (team: Team) => ({
      deck: state.cards[team].deck.length,
      hand: state.cards[team].hand.map((c) => c.defId),
      discard: state.cards[team].discard.length,
    }),
    setPlayerCard: (defId: string | null, target?: HexCoord | string, secondaryTarget?: string) => {
      if (!defId) { playerCard = null; recomputePreview(); rerenderCanvas(); return; }
      // Find a CardInstance in the player's hand matching the def id.
      const inHand = state.cards[state.playerTeam].hand.find((c) => c.defId === defId);
      if (!inHand) { playerCard = null; recomputePreview(); rerenderCanvas(); return; }
      playerCard = { defId, contributor: inHand.contributor, target, secondaryTarget };
      recomputePreview();
      rerenderCanvas();
    },
    getPlayerCard: () => playerCard,
    getPreviewRoutes: () => previewRoutes,
    getCardEffects: () => state.cardEffects,
    getPlayedCard: (team: Team) => state.playedCard[team],
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
