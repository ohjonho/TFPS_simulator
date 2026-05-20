\# Tactical FPS Match Simulator — v0



\## Project Context



This is v0 of a match simulator for a future esports team management game. The full design spec is in `docs/spec.md` — read the relevant sections before any non-trivial work. The spec has 14 sections of game design plus a 7-pass build plan. v0's goal is to validate the core simulation before any management layer.



\## Build Discipline



\- \*\*One pass at a time.\*\* Do not skip ahead or pull features from later passes.

\- \*\*Validate before advancing.\*\* Each pass has explicit validation criteria. Confirm with me before starting the next.

\- \*\*Numbers in config.\*\* All tunable values (hit %, damage, trait modifiers, range thresholds, grid size, hex size) live in a single config module. No magic numbers in game logic.



\## Architecture Rules



\- \*\*Logic separate from rendering.\*\* `src/game/` is pure logic, no DOM or canvas imports. `src/render/` handles drawing. Keeps the sim portable for later Electron/Tauri wrapping or native ports.

\- \*\*Deterministic simulation.\*\* Given the same inputs (paths + AI strategy + seed), rounds must resolve identically. Use a seeded PRNG for ALL random rolls.

\- \*\*Tick-based loop.\*\* Discrete ticks (\~1s real time at 1x). Per tick: positions → vision → engagements → damage → round-end check. Playback speed scales tick duration, never tick logic.

\- \*\*Event log.\*\* Every shot, hit, miss, kill, state change goes into an internal log. Powers the kill feed AND deterministic replays.



\## Tech Stack



\- TypeScript (strict mode), Vite, HTML5 Canvas. Vanilla — no React, no game engine.

\- No backend. State in memory.

\- Browser-only for v0; architecture must permit later desktop wrap.



\## Code Style



\- Strict TypeScript.

\- Pure functions in `src/game/` wherever possible.

\- Small modules; one concept per file.

\- Comment intent, not mechanics.



\## Workflow



\- Use Plan mode (Shift+Tab twice) before non-trivial changes.

\- Describe your approach and wait for approval before implementing.

\- After each pass, run the validation criteria from `docs/spec.md` and confirm with me before continuing.

