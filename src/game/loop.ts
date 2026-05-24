// Drives the resolution phase. Owns the setInterval that fires stepTick at
// (TICK.msAt1x / speed) cadence and calls back to the host after each tick so
// render + UI refresh. Salvaged from the legacy loop, trimmed to Pass 2 state
// (no vision/ghosts/tracking).

import type {
  AiState,
  Buff,
  GameState,
  GhostEntry,
  HexCoord,
  MoveState,
  Team,
  TrackEntry,
} from './types.ts';
import type { PlaybackSpeed, Unit } from './types.ts';
import { ROUND_TICK_LIMIT, TICK } from './config.ts';
import { roundFinished, stepTick } from './tick.ts';
import { blankMove } from './movement.ts';
import { findPath } from './pathfind.ts';
import { computeVisibility } from './vision.ts';
import { initialAi } from './state.ts';
import { defenderTeam, eliminationWinner, endRound } from './match.ts';

export type LoopCallbacks = {
  getState: () => GameState;
  setState: (next: GameState) => void;
  onTick: () => void;
  // Called once after a round ends (elimination → endRound). Host shows the
  // round-result modal and decides whether to halftime-swap / advance / match-end.
  onRoundEnd?: () => void;
};

export class PlaybackLoop {
  private timerId: number | null = null;
  private cb: LoopCallbacks;

  constructor(callbacks: LoopCallbacks) {
    this.cb = callbacks;
  }

  start(): void {
    const state = this.cb.getState();
    if (state.playback.playing) return;
    const next: GameState = { ...state, playback: { ...state.playback, playing: true } };
    this.cb.setState(next);
    this.schedule(next.playback.speed);
    this.cb.onTick();
  }

  pause(): void {
    const state = this.cb.getState();
    if (!state.playback.playing) return;
    this.clearTimer();
    this.cb.setState({ ...state, playback: { ...state.playback, playing: false } });
    this.cb.onTick();
  }

  setSpeed(speed: PlaybackSpeed): void {
    const state = this.cb.getState();
    const next: GameState = { ...state, playback: { ...state.playback, speed } };
    this.cb.setState(next);
    if (next.playback.playing) this.schedule(speed);
    this.cb.onTick();
  }

  // Restore units to their spawn snapshot, recompute each route from spawn so a
  // replay reruns identically, reset tick to 0, and pause. Used by Replay and
  // Back-to-Planning.
  reset(initialUnitsById: Record<string, Unit>): void {
    this.clearTimer();
    const state = this.cb.getState();
    const restoredUnits = state.units.map((u) => {
      const init = initialUnitsById[u.id];
      if (!init) return u;
      // Pass 8: also restore cardFlags + maxHp (both mutate during a tick via
      // Guardian Aura / safe-window / crossfire counters / last-stand ghost-
      // skip), so Replay restarts from the post-commitCards state of the round.
      return {
        ...u,
        pos: init.pos,
        facing: init.facing,
        hp: init.hp,
        maxHp: init.maxHp,
        state: init.state,
        cardFlags: { ...init.cardFlags },
      };
    });
    const resetMoves: Record<string, MoveState> = {};
    const resetTracking: Record<string, TrackEntry | null> = {};
    const resetPrevPos: Record<string, HexCoord> = {};
    const resetAi: Record<string, AiState> = {};
    const resetBuffs: Record<string, Buff[]> = {};
    for (const u of restoredUnits) {
      const goal = state.targets[u.id];
      const path = goal ? findPath(state.map, u.pos, goal) : null;
      resetMoves[u.id] = path ? { path, progress: 0 } : blankMove(u.pos);
      resetTracking[u.id] = null;
      resetPrevPos[u.id] = u.pos;
      resetAi[u.id] = initialAi();
      resetBuffs[u.id] = [];
    }
    const resetGhosts: Record<Team, Record<string, GhostEntry>> = {
      defenders: {},
      attackers: {},
    };
    const seed: GameState = {
      ...state,
      units: restoredUnits,
      moves: resetMoves,
      tick: 0,
      playback: { ...state.playback, playing: false },
      visibility: { defenders: new Set(), attackers: new Set() },
      ghosts: resetGhosts,
      tracking: resetTracking,
      prevPos: resetPrevPos,
      ai: resetAi,
      events: [],
      buffs: resetBuffs,
    };
    const { visibility } = computeVisibility(seed);
    this.cb.setState({ ...seed, visibility });
    this.cb.onTick();
  }

  dispose(): void {
    this.clearTimer();
  }

  private schedule(speed: PlaybackSpeed): void {
    this.clearTimer();
    const intervalMs = TICK.msAt1x / speed;
    this.timerId = window.setInterval(() => this.fire(), intervalMs);
  }

  private fire(): void {
    const state = this.cb.getState();
    if (!state.playback.playing) {
      this.clearTimer();
      return;
    }
    const after = stepTick(state);
    // Pass 7: a team eliminated → end of round.
    const winner = eliminationWinner(after);
    if (winner) {
      this.clearTimer();
      const ended = endRound(after, winner);
      this.cb.setState(ended);
      this.cb.onTick();
      this.cb.onRoundEnd?.();
      return;
    }
    // Pass 7.5: round time limit — defender side wins on timeout.
    if (after.tick >= ROUND_TICK_LIMIT) {
      this.clearTimer();
      const ended = endRound(after, defenderTeam(after));
      this.cb.setState(ended);
      this.cb.onTick();
      this.cb.onRoundEnd?.();
      return;
    }
    this.cb.setState(after);
    this.cb.onTick();
    if (roundFinished(after)) {
      this.clearTimer();
      this.cb.setState({ ...after, playback: { ...after.playback, playing: false } });
      this.cb.onTick();
    }
  }

  private clearTimer(): void {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }
}
