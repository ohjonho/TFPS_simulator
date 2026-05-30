# Tactical FPS Match Simulator — Coding Contract

## Project status

**v0 is complete.** The simulator ships a draftable roster, a roster-filtered
strategy menu, deterministic tick-based rounds with spike-plant, two
hand-authored maps, and the full event-log / stats / UI surface. The
build history that produced it is preserved in `git log`.

**Future work targets v1**: a management layer on top of this simulator
(rosters across matches, training, sponsors, season structure). Several
fields in the v0 data model are inert and waiting for that layer — see
`docs/spec.md` §15.

The full v0 reference is `docs/spec.md`. Read the relevant sections
before non-trivial work.

## Architecture rules

- **Logic separate from rendering.** `src/game/` is pure logic with no
  DOM or canvas imports. `src/render/` draws. `src/ui/` mounts panels
  and reads events. This keeps the sim portable for a later desktop
  wrap (Electron / Tauri) or native port.
- **Deterministic simulation.** Given the same
  `(map, mode, seed, player picks)`, a match must resolve bit-for-bit
  identically. Every random roll routes through the seeded PRNG in
  `src/game/rng.ts`. Per-tick rolls re-derive via `hashSeed(seed, tick)`
  so a tick's outcome is independent of earlier-tick roll counts.
- **Tick-based loop.** Discrete ticks (~1s at 1×). Per-tick pipeline
  lives in `src/game/tick.ts` (vision → AI → movement → fire → vision →
  round-end). Playback speed scales tick *duration*, never tick
  *logic*.
- **Event log is the source of truth.** Every shot, hit, kill, plant,
  defuse, detonate, strategy pick, and round result lands in
  `state.events`. The kill feed, stats, round/match modals, and headless
  harness all read from it.
- **Numbers in config.** All tunable values live in
  `src/game/config.ts`. No magic numbers in game logic. Re-tuning the
  sim should never require touching non-config files.

## Code style

- Strict TypeScript (`tsconfig.json` has strict + erasableSyntaxOnly).
- Pure functions in `src/game/` wherever possible. `tick.ts`,
  `match.ts`, `combat.ts`, `directives.ts`, `stats.ts`, `batch.ts`,
  `pathfind.ts`, `vision.ts`, `attributes.ts` are all pure.
- Small modules; one concept per file.
- Comment intent, not mechanics. Reference spec sections when relevant.
- Never create new documentation files unless explicitly requested.

## Tech stack

- TypeScript strict + Vite + HTML5 Canvas. Vanilla — no React, no game
  engine, no UI library.
- No backend. State in memory.
- Browser-only for v0. Architecture permits a later desktop wrap.

## Workflow

- For non-trivial changes, use Plan mode (Shift+Tab twice) before
  implementing. Describe the approach and wait for approval.
- Touch one concern at a time — bundling unrelated fixes makes review
  harder.
- After meaningful behavior changes, run the headless validation:
  `npx vite build && npx tsc --noEmit`, then in the dev console
  `__sim.runValidation(20)`. The determinism check is a hard invariant
  (must report 0 mismatches).
- Use the validation harness in `src/game/batch.ts` for tuning. The
  strategy matrix + compliance test surface roster-composition effects
  on win rate.
- **Ship the patch note with the change.** Any change a player can
  observe in-game — new or changed behavior, UI, controls, balance — gets
  a terse bullet in `PATCH_NOTES` (`src/ui/helpModal.ts`, the Help →
  Patch notes tab): newest section on top, bump the version, explain
  *why* not just what. That tab is the player's only changelog. A
  player-facing change isn't done until its note is there — treat it like
  the determinism check, non-negotiable, part of the same commit.

## Where things live

- **All tunables** → `src/game/config.ts`.
- **State shape + event log + Directive union** → `src/game/types.ts`.
- **Per-tick pipeline** → `src/game/tick.ts`.
- **Combat math** → `src/game/combat.ts` (the effective-stat seam is in
  here — every pp contribution flows through one of its hooks).
- **AI directives** → `src/game/directives.ts` + per-strategy directive
  specs in `src/game/strategies.ts`.
- **Roster generation** → `src/game/attributes.ts rollUnitMeta` +
  `src/game/draft.ts generatePool`.
- **Headless harness** → `src/game/batch.ts`.
- **The `__sim` dev hook** → `src/main.ts` (only mounted in DEV builds).
- **Player-facing changelog** → `PATCH_NOTES` in `src/ui/helpModal.ts`
  (update on every observable change — see Workflow).

When uncertain about behavior, the cheapest path is: read `config.ts` for
the numbers, read `types.ts` for the state shape, then jump to the file
that owns the behavior using `docs/spec.md` §13's module map.
