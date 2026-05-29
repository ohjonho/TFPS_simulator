# Tactical FPS Match Simulator (v0)

A deterministic, tick-based tactical-FPS round simulator. Two hand-authored
hex maps, a draftable roster of 3 units per team, a roster-filtered
strategy menu, and a full event-log-driven stats pipeline. The proof-of-
concept simulation layer for a future esports team-manager game.

Browser-only. No backend, no installed dependencies beyond what
`npm install` pulls. TypeScript + Vite + HTML5 Canvas — vanilla, no
React, no game engine.

---

## Getting started

```bash
npm install
npm run dev       # Vite dev server at http://localhost:5173
npm run build     # tsc --noEmit + Vite production build
npm run preview   # serve the production build locally
```

A first-load tutorial modal walks through the planning UI; the `?` button
in the top bar reopens it.

## What the player does

1. **Draft** — at match start (in Draft mode, the default), pick 3 units
   from a generated pool of 8 over a snake-pick order with the AI. Each
   pool card shows the unit's loadout, role, hero, traits, and the 5
   visible attribute aggregates. Two units are discarded.
2. **Plan** — each round, pick one **strategy** from the menu. The menu
   shows the 6 baseline strategies plus any **variant strategies** your
   roster's traits unlock. Multi-variant strategies need an A/B pick for
   the site bet. Drag your units inside the spawn zone if you want a
   different starting layout.
3. **Watch** — Begin Round, the round resolves on the timer (1× / 2× /
   4× / Pause). The kill feed surfaces shots, plants, defuses, and
   strategy picks.
4. **Repeat** — first to 4 round wins takes the match. Sides swap at
   halftime (round 3 → 4).

## What's modeled

- **30×40 pointy-top hex grid** with 8 cell types (walls, sites, plant
  zones, cover, mid, spawns, open). Cover blocks movement but not vision
  and applies a hit penalty.
- **Two maps** — Foundry (symmetric, tight B / wide A, mid pillar) and
  Atoll (asymmetric, long B sniper lane, A labyrinth).
- **Three loadouts** — shotgun, rifle, sniper, each with its own
  hit-table-by-range-band, damage, fire rate. Snipers must settle for 2
  ticks before qualifying for their stationary hit table.
- **23 traits** (skill / behavioral / personality), **4 roles**, **3
  heroes (origins)**. Trait combat-hooks fire on per-shot context
  (stationary, first shot, ally fired recently, last alive, adjacent to
  wall, etc.).
- **5 visible + 10 hidden attributes per unit**, normally distributed in
  Draft mode. Combat / vision math reads hidden subs directly; visible
  aggregates are display-only.
- **Per-unit AI directives** authored per role per strategy: hold an
  angle, peek-and-retreat, trade for an ally, commit to a site,
  safe-sniper-with-relocation. Each tick rolls **directive compliance**
  against Tenacity + Composure + strategy threshold.
- **Spike plant** (2-tick plant → 20-tick fuse / 4-tick defuse).
  Post-plant attackers re-target to cover-with-LoS-to-plant to deny
  defuse.
- **Team-shared fog of war** with directional cones, supercover
  occlusion (walls block, cover doesn't), and 5-tick ghost markers for
  recently-seen enemies.
- **Stats pipeline** — K / D / A / damage / KAST / ACS / headshots,
  computed pure-functionally from the event log. Round-end + match-end
  modals with MVP marker and per-round ACS sparkline.

## What's intentionally not modeled

v0 is the simulation layer only. Outside scope:

- **Management / season layer** — no rosters across matches, no XP, no
  morale, no sponsors, no scouting, no trades.
- **Audio / 3D / juice** — abstract canvas only.
- **In-round utility (smokes / flashes / abilities)** — combat is
  weapons + traits + role.
- **Sudden death** — 3-3 currently lands on a draw with a note in the
  match-end modal.

## Determinism

Given the same `(map, mode, seed, player draft picks, player strategy
picks)` tuple, the match produces a bit-identical event log across runs.
Replay re-runs the round from the round-start snapshot. The headless
harness (`__sim.runValidation`) verifies the invariant on every release.

## Documentation

- `docs/spec.md` — full v0 reference: match flow, maps, units,
  attributes, traits, vision, combat, AI, plant, stats, configuration,
  code map.
- `CLAUDE.md` — coding agent contract: architecture rules, code style,
  v0 status.
- `src/game/config.ts` — every tunable value, commented.

## Project layout

```
src/
├── main.ts                 Entry point (wires state, render, loop, UI, __sim hook)
├── style.css               3-column shell + panels + chip styles
├── game/                   Pure logic (no DOM / canvas imports)
├── render/                 Canvas drawing
├── ui/                     DOM panels + interactions
└── maps/                   Hand-authored map definitions
docs/
└── spec.md                 v0 reference
```

See `docs/spec.md` §13 for the per-module reference.

## Dev tools

In dev builds, `window.__sim` exposes the sim API for the browser
console:

```js
// Quick sanity checks
__sim.getState()                       // current GameState
__sim.step(5)                          // advance 5 ticks
__sim.sampleHits('D1', 'A1', 400)      // empirical hit rate / HS rate

// Roster / strategy introspection
__sim.getRatings('D1')                 // 10 hidden attrs
__sim.getVisible('D1')                 // 5 visible aggregates
__sim.getAvailableStrategies()         // roster-filtered menu
__sim.getRosterUnlocks()               // strategies this roster unlocks

// Headless validation (~30s at defaults)
__sim.runValidation(20)                // strategy matrix + compliance + determinism
```

See `src/main.ts` for the full hook surface.

## License

Unpublished. Personal project.
