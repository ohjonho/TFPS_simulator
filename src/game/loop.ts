// Drives the resolution phase. Owns the setInterval that fires stepTick at
// (TICK.msAt1x / speed) cadence. Calls back to the host with the new state
// after each tick so render + UI can refresh.

import type {
  Axial,
  GameState,
  GhostEntry,
  PlaybackSpeed,
  Team,
  TrackEntry,
} from './types.ts';
import { TICK } from './config.ts';
import { allUnitsFinished, stepTick } from './tick.ts';
import { computeVisibility } from './vision.ts';

export type LoopCallbacks = {
  getState: () => GameState;
  setState: (next: GameState) => void;
  onTick: () => void;
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
    const next: GameState = {
      ...state,
      playback: { ...state.playback, playing: true },
    };
    this.cb.setState(next);
    this.schedule(next.playback.speed);
    this.cb.onTick();
  }

  pause(): void {
    const state = this.cb.getState();
    if (!state.playback.playing) return;
    this.clearTimer();
    this.cb.setState({
      ...state,
      playback: { ...state.playback, playing: false },
    });
    this.cb.onTick();
  }

  setSpeed(speed: PlaybackSpeed): void {
    const state = this.cb.getState();
    const next: GameState = {
      ...state,
      playback: { ...state.playback, speed },
    };
    this.cb.setState(next);
    if (next.playback.playing) this.schedule(speed);
    this.cb.onTick();
  }

  // Reset progress to tick 0 without changing paths. Used by Replay in Pass 2.
  // Pass 3: also resets visibility / ghosts / tracking / prev-tick snapshots so
  // the round starts from a clean fog state, then recomputes initial visibility.
  reset(initialPositions: Record<string, GameState['units'][number]>): void {
    this.clearTimer();
    const state = this.cb.getState();
    const restoredUnits = state.units.map((u) => {
      const init = initialPositions[u.id];
      if (!init) return u;
      return { ...u, pos: init.pos, facing: init.facing, state: 'alive' as const, hp: init.hp };
    });
    const resetCursors: GameState['cursors'] = {};
    const resetTracking: Record<string, TrackEntry | null> = {};
    const resetPrevPos: Record<string, Axial> = {};
    const resetPrevHold: Record<string, number> = {};
    for (const u of restoredUnits) {
      resetCursors[u.id] = { progress: 0, holdRemaining: 0, consumedWaypointAtIndex: null };
      resetTracking[u.id] = null;
      resetPrevPos[u.id] = u.pos;
      resetPrevHold[u.id] = 0;
    }
    const resetGhosts: Record<Team, Record<string, GhostEntry>> = {
      defenders: {},
      attackers: {},
    };
    const seed: GameState = {
      ...state,
      units: restoredUnits,
      cursors: resetCursors,
      tick: 0,
      playback: { ...state.playback, playing: false },
      visibility: { defenders: new Set(), attackers: new Set() },
      ghosts: resetGhosts,
      tracking: resetTracking,
      prevPos: resetPrevPos,
      prevHoldRemaining: resetPrevHold,
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
    const next = stepTick(state);
    this.cb.setState(next);
    this.cb.onTick();
    if (allUnitsFinished(next)) {
      this.clearTimer();
      this.cb.setState({
        ...next,
        playback: { ...next.playback, playing: false },
      });
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
