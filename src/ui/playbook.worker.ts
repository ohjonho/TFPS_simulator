// Web Worker (Part 5 B1b) — runs the assistant-coach matchup measurement off the
// main thread so authoring/saving a play stays instant. Imports only pure game/
// logic (no DOM), so it bundles cleanly into a module worker. Receives a custom
// play + map + seeds, returns its measured matchups (defender-win% per opponent).

import { measureMatchups } from '../game/batch.ts';
import type { Strategy } from '../game/strategies.ts';
import type { MapDefinition } from '../game/types.ts';

type ReviewRequest = { id: string; play: Strategy; mapName: MapDefinition['name']; seeds: number };
type ReviewResult = { id: string; matchups: Record<string, number>; seeds: number };

// tsconfig lib is ["ES2023","DOM"] (no WebWorker lib), so `self` types as Window.
// A narrow local view keeps postMessage/onmessage well-typed for the worker.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<ReviewRequest>) => void) | null;
  postMessage: (msg: ReviewResult) => void;
};

ctx.onmessage = (e) => {
  const { id, play, mapName, seeds } = e.data;
  const matchups = measureMatchups(play, mapName, seeds);
  ctx.postMessage({ id, matchups, seeds });
};
