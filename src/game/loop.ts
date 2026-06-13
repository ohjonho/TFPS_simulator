// `PlaybackLoop` drives the resolution phase. Owns the setInterval that
// fires `stepTick` at `TICK.msAt1x / speed` cadence and calls back to the
// host after each tick so render + UI refresh.
//
// Round-end precedence inside `fire()`:
//   1. Plant detonation / defuse (`state.roundResult` set by stepTick).
//   2. Elimination (via `eliminationWinner`).
//   3. Round timer (`state.tick >= ROUND_TICK_LIMIT`) → defender wins.
//
// `reset(initialUnitsById)` restores the round-start snapshot (units +
// HP + facing + AI counters + buffs + plant state + cardEffects) for
// Replay / Back-to-Planning. The snapshot itself lives in main.ts.

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
        // Pass 9: restore round-start directives so Replay re-uses the same
        // behaviors (they don't change during a tick today, but be explicit).
        directives: [...init.directives],
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
      beliefs: { defenders: [], attackers: [] },
      tracking: resetTracking,
      prevPos: resetPrevPos,
      ai: resetAi,
      events: [],
      buffs: resetBuffs,
      // Pass B — clear plant + prev-visibility on Replay so replays start
      // from a known clean state.
      plant: { planted: null, planting: null, defusing: null },
      prevPerUnitVisible: {},
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
    // Pass B: spike plant outcomes are decided inside stepTick (detonation
    // → attackers; defuse → defenders). If stepTick set roundResult, it
    // takes precedence over elimination/timeout.
    if (after.roundResult) {
      this.clearTimer();
      const ended = endRound(after, after.roundResult.winner);
      this.cb.setState(ended);
      this.cb.onTick();
      this.cb.onRoundEnd?.();
      return;
    }
    // Pass 7: a team eliminated → end of round.
    // H3.fix1 — post-plant elimination is now decisive: attackers wipe defenders
    // = ATK wins (no defuser possible); defenders wipe attackers = DEF wins
    // (uncontested defuse — the sim doesn't need to play out the defuse ticks);
    // mutual annihilation post-plant = ATK wins (spike detonates uninterrupted).
    // eliminationWinner now handles the plant tiebreaker internally; loop just
    // honors whatever it returns.
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
    // Pass B: timeout ignored when the spike is down (let detonation play out).
    if (after.tick >= ROUND_TICK_LIMIT && after.plant.planted === null) {
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
