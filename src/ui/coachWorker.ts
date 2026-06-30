// Background "assistant coach" review manager (Part 5 B1b). Owns one lazily-
// created module Worker and a pending-callbacks map keyed by play id, so authored
// plays get their matchup measured off-thread without blocking the UI. Vite
// bundles the worker from the new URL(...) reference.

import type { Strategy } from '../game/strategies.ts';
import type { MapDefinition } from '../game/types.ts';

type ReviewDone = (matchups: Record<string, number>, seeds: number) => void;
type ReviewResult = { id: string; matchups: Record<string, number>; seeds: number };

let worker: Worker | null = null;
const pending = new Map<string, ReviewDone>();

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./playbook.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<ReviewResult>) => {
      const { id, matchups, seeds } = e.data;
      const cb = pending.get(id);
      if (cb) { pending.delete(id); cb(matchups, seeds); }
    };
  }
  return worker;
}

// Queue a play for background measurement. The latest request for a given play id
// wins (its callback replaces any earlier pending one). onDone fires on the main
// thread when the worker returns.
export function reviewPlay(
  play: Strategy,
  mapName: MapDefinition['name'],
  seeds: number,
  onDone: ReviewDone,
): void {
  pending.set(play.id, onDone);
  ensureWorker().postMessage({ id: play.id, play, mapName, seeds });
}
