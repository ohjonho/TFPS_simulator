# Tactical FPS Match Simulator — v0 Reference

This document describes v0 of the simulator **as it actually shipped**. It is
the reference for what's in the code today — not a build plan. The iterative
build history is preserved in `git log`; the per-pass plan archive lives in
`~/.claude/plans/` for the working session that produced this build.

v0's purpose was to **validate the in-match simulation** for a future esports
team-manager game (Valorant-inspired). The management layer (rosters across
matches, training, sponsors, season structure) is **out of scope** here. v0
delivers a draftable roster, a tactical strategy menu, a deterministic
tick-based round, two hand-authored maps, and the stat/event surfaces needed
to evaluate whether unit / strategy choices matter.

---

## 1. Match flow

A match is up to 6 rounds, first team to `MATCH_WIN_SCORE = 4` wins.

Per round:

1. **Draft** (match start, Draft mode only). 8 units generated; player and AI
   snake-pick 3 each (P-A-A-P-P-A). Two units discarded. See §10.
2. **Planning.** Player sees score, both rosters (with traits / role / hero /
   attributes), and a strategy menu filtered by their roster's traits. Player
   picks one strategy (and an A/B variant if applicable) and clicks **Begin
   Round**. AI picks its own strategy via a weighted heuristic.
3. **Resolution.** Both teams execute autonomously. Player watches with
   playback controls (1× / 2× / 4× / Pause / Replay).
4. **Round end.** Triggered by elimination, spike detonation, defuse, or the
   `ROUND_TICK_LIMIT` timer expiring (defenders win on timeout — "attackers
   ran out of time"). Round-end modal shows the result + per-unit K/D/A/ACS
   table.
5. **Halftime** after round 3: each team's side swaps. Same units, same
   traits, opposite spawn.
6. **Next round** or **match end**. Match-end modal shows the full scoreboard
   sorted by ACS with MVP marker and per-round ACS sparkline.

Standard mode uses fixed loadouts (2 rifles + 1 sniper per team) and flat-50
attributes — the debug baseline. Draft mode is the default and produces
varied rosters with normally-distributed attributes.

---

## 2. Architecture

- **Browser-only, no backend.** TypeScript strict, Vite, HTML5 Canvas.
  Vanilla — no React, no game engine.
- **`src/game/` is pure logic** with no DOM or canvas imports. `src/render/`
  draws. `src/ui/` mounts panels and reads events. `src/maps/` defines the
  hex grids. This keeps the sim portable for a later desktop wrap.
- **Deterministic.** Given the same `(seed, map, mode, player picks)` tuple,
  a match resolves bit-for-bit identically. Every random roll routes through
  the seeded PRNG in `src/game/rng.ts` (mulberry32 + per-tick re-derivation
  via `hashSeed(seed, tick)`).
- **Tick-based.** ~1 s of real time per tick at 1×. Playback speed scales
  tick *duration*, not tick *logic*. Per tick (in `src/game/tick.ts`):
  1. snapshot pre-tick positions,
  2. compute visibility,
  3. plant/defuse state update,
  4. AI decisions (directives → fallback tree),
  5. movement,
  6. fire / damage resolution,
  7. recompute visibility / tracking / ghosts,
  8. round-end check.
- **Event log.** Every shot, hit, miss, kill, plant, defuse, detonate,
  strategy pick, and round result is appended to `state.events`. The kill
  feed, round-end stats, match-end scoreboard, and headless harness all read
  from it. Replays are bit-identical because the event log is a pure function
  of `(seed, picks)`.
- **All tunables in `src/game/config.ts`.** Hit table, damage, range bands,
  trait bonuses, attribute formulas, compliance thresholds, plant timers,
  draft pool size — every magic number lives here. Game logic never inlines
  numerics.

---

## 3. Maps

### 3.1 Grid

- **30 columns × 40 rows**, pointy-top hexes, odd-row offset coords
  `{col, row}`. Defenders spawn at the top (north), attackers at the bottom
  (south).
- Hex geometry: `HEX = { size: 13, w = size·√3, vs = size·1.5, mx = 12, my = 12 }`.
- Hex distance uses axial conversion via `hexDistance` in `src/game/hex.ts`.

### 3.2 Cell types

| Type | Vision | Movement | Notes |
|------|--------|----------|-------|
| `wall` | Blocks | Blocked | Architectural |
| `open` | Passes | Allowed | Default traversable |
| `def` / `atk` | Passes | Allowed | Spawn markers |
| `site` | Passes | Allowed | Site interior (region tag) |
| `plant` | Passes | Allowed | Subset of site; spike-plantable |
| `mid` | Passes | Allowed | Region-labeled open space |
| `cover` | Passes | **Blocked** | Half-wall — adjacent target gets −20pp HR |

Cover only blocks **movement**, never vision. The cover penalty fires when a
shot's hex-line crosses a `cover` hex adjacent to the target (see
`shotCrossesCover` in `src/game/combat.ts`).

### 3.3 Range bands (hex distance)

- **Short** 1–4 · **Medium** 5–10 · **Long** 11+

### 3.4 The two maps

Both maps are hand-authored in code as a sequence of region fills using
`src/maps/gridUtils.ts` helpers and translated from the
`hex_maps_foundry_atoll.html` prototype.

- **Foundry** (`src/maps/foundry.ts`) — symmetric two-site map. Tight B
  squeeze, wider A site, central mid pillar breaking the long sightline.
  Regions: `def_spawn`, `atk_spawn`, `mid`, `mid_pillar`, `a_site` /
  `a_plant` / `a_connector` / `a_main` / `a_lobby`, B-side mirrors.
- **Atoll** (`src/maps/atoll.ts`) — asymmetric. Wide B dock with a long
  sniper lane, tight A labyrinth with internal walls. Regions add
  `b_dock`, `mid_courtyard`, `a_maze`.

The top bar's Map toggle rebuilds the match on the chosen map preserving the
current `(matchMode, matchSeed)`.

### 3.5 Map schema (`src/maps/types.ts`)

```ts
type CellType = 'wall' | 'open' | 'def' | 'atk' | 'site' | 'plant' | 'mid' | 'cover';
type HexCoord = { col: number; row: number };
type MapDefinition = {
  name: 'Foundry' | 'Atoll';
  width: 30; height: 40;
  grid: CellType[][];                                    // grid[row][col]
  regions: Record<string, HexCoord[]>;                   // strategies reference these
  sites: { A: SiteInfo; B: SiteInfo };                   // hexes + plantHexes + centerHex
  spawns: { defenders: HexCoord[]; attackers: HexCoord[] };
  character: 'open_sightlines' | 'tight_corridors_asymmetric';
};
```

Regions are required because strategies and directives reference hexes **by
region name**, e.g. "Vanguard goes to `a_site` centroid." `regionCentroid` in
`src/game/strategies.ts` returns the middle passable hex of a region.

---

## 4. Units

### 4.1 Identity

Each unit (`src/game/types.ts Unit`) carries:

- `id`, `team`, `pos`, `facing` (0-5, clockwise from N), `hp`, `maxHp`, `state`.
- `weapon`: `shotgun` / `rifle` / `sniper`.
- `role` + `preferredRole`: Vanguard / Tactician / Warden / Specialist.
  Off-preferred role triggers a −10pp HR penalty.
- `hero` (origin): Angelic / Techy / Cursed — passive ability tag, no
  decision surface (§4.6).
- `skillTrait`, `behavioralTrait`, `personalityTrait`: one per category from
  the 23-trait pool (§4.4).
- `attributes`: 10 hidden sub-ratings (0–100, 50 = baseline) feeding 5
  visible aggregates (§4.3).
- `modifiers`: dynamic — `aggression` (per role + strategy mod),
  `offPosition`, `retreatThresholdMod` (strategy-driven).
- `directives`: 0+ tactical directives for this round, injected by the
  strategy (§7.3).
- `cardFlags`: per-unit boolean / hex flags set by hero passives + a few
  strategy synergies. (The name is historical; the card system was removed
  in H3.4. The flag/effect plumbing remains because hero passives reuse it.)

### 4.2 Loadouts

| Weapon | HR short | HR medium | HR long | Body / head dmg | Fire rate | Move speed |
|--------|---------:|----------:|--------:|----------------:|----------:|-----------:|
| Shotgun | 80% | 30% | 5% | 1 / 2 | 1 / tick | 1.0 |
| Rifle | 70% | 75% | 55% | 1 / 2 | 1 / tick | 1.0 |
| Sniper stationary | 30% | 60% | 80% | 2 / 4 | 1 / 2 ticks | 1.0 |
| Sniper moving | 15% | 30% | 45% | 2 / 4 | 1 / 2 ticks | 1.0 |

Sniper uses the **stationary** row only after `SNIPER_SETTLED_TICKS = 2`
consecutive ticks of stillness; otherwise it shoots from the **moving** row.
Snipers also get +10pp headshot at long range when stationary.

`maxHp = 3`. Guardian Aura (Angelic hero) adds +1 maxHp to allies within 5
hexes; restored at round end.

### 4.3 Attributes (5 visible, 10 hidden)

The hidden 10 are the source of truth — combat / vision math reads them
directly. The visible 5 are a weighted-sum aggregation for display only
(see `ATTRIBUTES.aggregation` in config, and `aggregateVisible` in
`src/game/attributes.ts`).

| Visible aggregate | Hidden subs feeding it | What it does in v0 |
|---|---|---|
| **Mechanics** | aim, headshot, reflexes, weaponAffinity | HR + HS pp contributions; reflexes scales First Shot magnitude |
| **Game Sense** | vision, mapIQ | Cone width + ghost duration + cover-seek radius |
| **Discipline** | tenacity | Gates the per-tick directive compliance roll (§7.4) |
| **Improvisation** | composure, adaptability* | Last-alive HR retention via composure; adaptability inert |
| **Leadership** | comms* | Inert in v0 (placeholder for v1 hero auras) |

*`adaptability` and `comms` are generated but not yet consumed — they're
forward state for v1. The UI greys them with an "H3" badge in the attribute
panel's Details disclosure.

**Generation modes** (`ATTRIBUTES.generation.distribution`):
- `flat`: every attribute = 50 (Standard mode default; deterministic).
- `normal`: truncated-normal sample, mean 50, stdDev 12, clamped to [10, 90]
  (the Draft default — produces variety).
- `uniform`: uniform in [min, max].

### 4.4 Traits (23, three categories)

Each unit picks one trait per category. Trait list in
`config.ts TRAITS_BY_ID`:

| Category | Traits |
|---|---|
| **Skill** (mechanical) | Sharp Aim, Headhunter, Eagle Eye, First Shot, Spray Down, Deadeye, Close Quarters |
| **Behavioral** (engagement style) | Sentinel, Run-n-Gun, Lurker, Entry, Trader, Clutch, Roamer, Hot Head |
| **Personality** (mental + social) | Big Brain, Ego, Composed, Leader, Lone Wolf, Paranoid, Patient, Old Pro |

Each trait carries:
- **Sub-attribute deltas** applied at unit generation (e.g. Sharp Aim = +15
  aim). Stacked on top of the rolled attribute.
- **Conditional combat hooks** (e.g. Sentinel +25 HR / +20 HS after 3 ticks
  stationary) — see `combat.ts traitHitPp` / `traitHeadshotPp`.
- **`unlocks: StrategyId[]`** — strategies this trait makes available to the
  roster (§7.2). Skill traits unlock nothing; behavioral + personality each
  unlock one variant strategy.
- **`tier`**: `starter` / `earned` / `event`. v0 picks uniformly across
  tiers; v1's management layer would gate scouting + XP-earned traits.

### 4.5 Roles

Vanguard (aggression 70), Tactician (50), Warden (35), Specialist (55).
Aggression contributes to early-round HR via the `modifiers.aggression`
modifier (combat.ts), and an above-`AGGRESSION_PUSH_THRESHOLD` value makes
an idle, order-less unit advance toward the enemy spawn.

`preferredRole` is set at unit generation and equals `role` by default. Pass
H-era off-position handling: setting `role !== preferredRole` triggers
`offPosition: true` and the −10pp HR penalty.

### 4.6 Heroes (origins)

Passive abilities (no decision surface), set per unit at draft / match start:

- **Angelic** — Guardian Aura: allies within 5 hex get +1 max HP, always on.
- **Techy** — Tactical Scan: round-start reveal of all enemy positions for
  3 ticks (per `CARD_EFFECTS.tacticalScan.ticks`).
- **Cursed** — Mark Target: the first enemy this unit spots each round is
  auto-marked all round — allies get +20pp HR / +10pp HS vs the mark and
  team visibility includes the marked hex for 5 ticks even past LoS.

Hero passives wire through `match.applyStrategies` → `cardEffects` /
`cardFlags`. The "card" names are historical; v0's card system was removed
in the H3 redesign and these flags became the synergy plumbing.

---

## 5. Vision & fog

### 5.1 Vision cone

- Base half-angle 45° (90° full).
- Sniper while stationary: 22.5° half (45° full).
- Eagle Eye trait: +15° half (so 120° full normal, 75° full stationary
  sniper).
- High Vision attribute: +0.4°/(rating − 50) half-angle, capped at ±20°.
- **Infinite range** along the cone, blocked only by `wall` cells.
  `cover` does not block.

### 5.2 Facing

- Default = direction of last movement.
- When an enemy enters the cone, facing snaps to point at the **closest
  visible enemy** by hex distance (lowest-id tiebreak).
- When the tracked enemy dies or has been unseen for
  `VISION.trackLossThreshold = 3` consecutive ticks, facing reverts to the
  unit's directive-default or to a periodic re-face toward enemy-spawn /
  mid-centroid (Pass E m1).

### 5.3 Occlusion

- Supercover hex-line trace (`hexLine` in `hex.ts`) from viewer to candidate
  hex. Cone filter applied first; occlusion check on hexes passing the cone.
- A `wall` hex on the line hides the target. `cover` does not.

### 5.4 Fog of war

- **Team-shared** visibility. A hex is visible to a team if any alive
  teammate has it in their cone unblocked.
- Enemy units render only when in the player team's visibility set during
  resolution.
- **Ghost markers** for enemies lost from sight persist `VISION.ghostTicks =
  5` (±1 by Vision attribute) at the last-seen hex, then clear.
- Planning has an optional "Show enemies" debug toggle (default on);
  resolution always respects fog.

### 5.5 Debug overlay

`V` toggles a debug overlay (`drawDebugVision.ts`) drawing per-unit cone
edges, visible-hex tint, and tracking lines. `R` toggles region-name labels
on the map.

---

## 6. Combat

### 6.1 Pipeline (`src/game/combat.ts resolveShot`)

For each shooter→target pair this tick:

1. **Range band** from `hexDistance` and `RANGE` thresholds.
2. **Base HR** from `HIT_TABLE[weapon × band]`. Sniper picks `stationary`
   or `moving` row based on `SNIPER_SETTLED_TICKS` test.
3. **Effective HR** = `baseHit + traitHitPp + modifierHitPp + cardHitPp +
   buffHitPp − coverPenalty`, clamped to `HIT_CLAMP = [5%, 95%]`.
4. **Hit roll** via the seeded `Rng.chance`.
5. **Headshot roll** on a hit: 30% base, +10pp for stationary sniper at
   long range, plus trait / modifier / mark contributions, clamped to the
   same window.
6. **Damage** = `DAMAGE[weapon].head` or `.body`. Apply at end of tick
   (simultaneous damage — both can die same tick).

### 6.2 Effective-stat seam

`combat.ts` exposes the contribution hooks the rest of the sim feeds:

| Hook | What contributes |
|---|---|
| `traitHitPp` | Sharp Aim, First Shot, Sentinel, Run-n-Gun, Lurker, Entry, Trader, Clutch, Spray Down, Deadeye, Close Quarters, Patient |
| `traitHeadshotPp` | Headhunter (rifle), Sentinel, Lurker, Entry, Clutch |
| `modifierHitPp` | Aggression (early-round), Weapon Affinity attribute, Off-Position penalty, default Clutch (last-alive without the trait) |
| `cardHitPp` / `cardHeadshotPp` | Hero passives via `cardEffects` (Mark Target / Cursed) — and a small set of strategy-synergy bonuses |
| Buffs | Any active `Buff` on `state.buffs[unitId]` (cleared per `expiresAtTick`) |

The seam is one place to add new pp contributions without touching the roll
or clamp logic. Every contribution is pure-function of `(unit, ctx,
state)` and goes through the same seeded RNG.

### 6.3 Per-shot context (`ShotContextInput`)

Caller-supplied flags that drive trait gating:

- `stationary`, `stationaryTicks` (Sentinel)
- `engagementTicks`, `firstShot` (Entry / Spray Down / First Shot)
- `allyFiredRecently` (Trader)
- `lastAlive` (Clutch)
- `adjacentToWall` (Lurker)
- `ticksIntoRound` (aggression early-round window, Patient late-round)
- `firstSightShot` (Peeker's Advantage: −10pp on a target that wasn't in the
  shooter's visibility last tick)

### 6.4 Fire rate

- `FIRE_RATE.shotgun = FIRE_RATE.rifle = 1`, `FIRE_RATE.sniper = 2` ticks.
- `AiState.shotClock` counts down; fire only when ≤ 0.

---

## 7. AI behavior

### 7.1 Three-tier composition

1. **Strategy** (round-level). Player picks one strategy per round; it
   assigns per-role region targets and per-role `Directive`s. See §7.2.
2. **Directives** (per-unit). Each unit carries a small list of `Directive`
   objects evaluated in priority order at the top of every tick. See §7.3.
3. **Default behavior tree** (per-tick fallback). If no directive applies
   (or compliance fails), the legacy tick.ts decision tree fires: retreat
   → engage → region move → push/hold by aggression → cover-seek shuffle.

### 7.2 Strategies

15 strategies authored in `src/game/strategies.ts`:

- **Baseline 6** (always available): Defender = Hold / Stack / Pressure;
  Attacker = Execute / Rush / Control.
- **Trait-unlocked variants** (gated by `requiresUnlock`): each behavioral
  + personality trait unlocks one variant. Defender unlocks: Anchor_Hold,
  Crossfire_Lockdown, Last_Stand_Defense, Mind_Games, Hold_Composure,
  Coordinated_Lockdown, Rotate_Stack, Wide_Watch, Slow_Burn. Attacker
  unlocks: Mobile_Push, Patient_Flank, Coordinated_Execute, Solo_Frag,
  Scatter_Push, Aggressive_Peek. (Mind_Games is shared by both sides.)

A strategy is **available** to a team if ≥1 unit on the roster carries an
unlock trait. `availableStrategies` in `src/game/traits.ts` filters the
menu shown to the player; the AI's picker (`aiOpponent.ts pickAiStrategy`)
filters identically.

Per-strategy mods (`STRATEGY_MODS` in config):
- `aggression` delta added to every unit's `modifiers.aggression`.
- `retreatThreshold` delta added to `AI.retreatHpThreshold`.
- `complianceThreshold` for the directive roll (§7.4). Trait-unlocked
  variants raise this above 50 — higher ceiling, lower floor design.

Each strategy also defines per-role `variants[v][role]` with:
- `region` — the region centroid is the unit's primary target.
- `directives` — composable behaviors (§7.3).
- `usePerimeterPath` — A* picks `findPerimeterPath` (Slow Flank route).
- `anchorOffset` — pulls defender targets back behind a region's centroid
  toward the spawn (Hold-style strategies).

The variant choice (e.g. Hold A vs Hold B for site selection) is picked
explicitly by the player; the AI picks via the seeded RNG. The `playerSide`
sees a strategy's `variants[idx][0].region` label as the A/B button.

### 7.3 Directives

`Directive` is a discriminated union (`types.ts`). Each evaluator is a pure
function `(unit, state, prevAi) → DirectiveDecision | null` in
`src/game/directives.ts`. Higher-priority directives win.

| Directive | What it does |
|---|---|
| `hold_angle` | Face a fixed hex, do not move, engage if enemy in cone |
| `safe_sniper` | Hold sightline; after N shots BFS to nearest cover and re-hold |
| `rotate_on_team_contact` | If watched ally has fresh tracking, re-target after delay |
| `trade_for` | For N ticks after an ally fires / dies, engage their firingTarget if visible |
| `peek_and_retreat` | Alternate between peek hex and cover hex on a cadence; fire when at peek |
| `commit_site` | Go to siteHex; only leave on contact in named regions |

`applyStrategies` resolves region-named directive specs to concrete
HexCoords using `regionCentroid` + the unit's preferred site variant.

### 7.4 Compliance roll

Each tick that a directive's evaluator would apply, it first rolls against
the unit's compliance probability:

```
compliancePct = clamp(
  50 + 0.5×Tenacity_delta + 0.3×Composure_delta − complianceThreshold_delta
     − situationalPressure,
  5, 95)
```

(See `compliancePct` in `directives.ts` for the exact formula and term
sources.) High Tenacity + low strategy threshold → near-100% adherence; low
Tenacity + high threshold + under-fire pressure → frequent breaks. On
failure the directive returns `null` and the legacy behavior tree fires.

### 7.5 Default behavior tree (`tick.ts`)

The fallback when no directive applies. Per unit, in priority order:

1. **Retreat** if `hp ≤ AI.retreatHpThreshold + retreatThresholdMod`. Goes
   to nearest `wall`-adjacent hex (Lurker's wall preference). Override:
   Sentinel / Entry / Clutch / Reckless-Push / Hot-Head don't retreat.
2. **Engage** if any visible enemy. Pick closest enemy (lowest-id tiebreak).
   Stop moving. `engageStickyTicks` keeps the engagement live for 2 ticks
   after losing LoS to avoid flip-flop.
3. **Move toward assigned region** if a target is set and not yet reached.
4. **Push to enemy spawn** if no target and aggression ≥
   `AGGRESSION_PUSH_THRESHOLD`.
5. **Hold** otherwise. After `ROTATE_AFTER_HOLD_TICKS = 15` ticks of no
   contact, re-target to mid centroid (light stalemate breaker).

Movement uses A* (`pathfind.findPath`) over `passableAt` (excludes `wall`
and `cover`). Cover-aware: each step costs `1 + 0.3` extra if the
neighbor has no cover-adjacent neighbor of its own (`MOVE.coverPathPreference`).
`findPerimeterPath` adds a perimeter-pull weight for Slow Flank routes.

### 7.6 Post-plant attacker hold

When the spike is down, alive attackers off the plant zone retarget to a
cover-adjacent hex within `POST_PLANT_SEARCH_RADIUS = 6` of their current
position with line-of-sight to the plant centroid and in the rifle/sniper
sweet-spot range. They hold the angle to deny defuse instead of wandering.

---

## 8. Spike plant

`PlantState` on `GameState.plant`:
- `planted`: `{ site, plantedAtTick } | null` — set when a plant completes.
- `planting` / `defusing`: in-progress action, cleared each tick that
  doesn't continue.

Mechanics (`updatePlantState` in `tick.ts`):

- **Plant**: an alive attacker remains on any `plant` hex of a site for
  `PLANT_TICKS = 2` consecutive ticks with no alive defender on the same
  site's plant hexes. Sets `planted`, pushes `'plant'` event.
- **Detonation**: `DETONATION_TICKS = 20` ticks after planted with no
  defuse — attackers win the round, pushes `'detonate'`.
- **Defuse**: an alive defender remains on the planted site's plant hexes
  for `DEFUSE_TICKS = 4` consecutive ticks with no attacker present.
  Clears `planted`, pushes `'defuse'`, defenders win the round.

Round-end precedence in `loop.fire()`:

1. Detonation / defuse winner (set by `updatePlantState`).
2. Elimination winner. **Post-plant mutual annihilation** awards the round
   to attackers (planting was the win condition).
3. Round timer expiry → defender side wins.

---

## 9. Match flow details

- `MATCH_WIN_SCORE = 4`. First team to score this many round wins takes the
  match.
- `MATCH_ROUND_COUNT = 6` regular rounds. Sudden-death tiebreaker for 3–3
  is deferred to a future pass (the match-end modal currently lands on a
  draw with a note).
- `HALFTIME_AFTER_ROUND = 3`. `halftimeSwap` flips `state.teamSide`
  entries; `startRound` then re-spawns each team at its new side's spawn.
- **Timeout**: a one-shot per team, active when the team is at match point
  (3 wins, opponent < 4). Player click is one button on the top bar.
- **Replay** restores the round-start snapshot (`initialUnitsById` taken
  at `beginRound`) and re-runs identically.
- **AI strategy bias**: `aiOpponent.pickAiStrategy` does a weighted
  random over available strategies — weight =
  `1 + state.aiStrategyWins[team][strategyId] + uniform[0,
  AI_STRATEGY_EXPLORATION)`. Wins recorded on `endRound` via
  `recordStrategyWin`.

---

## 10. Draft mode

Default match mode (`MatchMode = 'draft'`; Standard is the debug toggle).

`src/game/draft.ts`:

- `startDraft(map, seed)` generates an 8-unit pool. Each pool unit gets a
  random loadout (uniform from `LOADOUT_POOL`, with a ≥ 2-of-each-weapon
  soft constraint, resampling up to `DRAFT.maxComposeRetries`), a full
  `rollUnitMeta` (random skill / behavioral / personality trait, role +
  preferredRole, hero), and `generateAttributes` with mode
  `RANDOMIZE_ATTRIBUTES` ([40, 60] uniform). Pool ids are `P1..P8`.
- `DRAFT.snakeOrder = ['P','A','A','P','P','A']` — player picks 1st, 4th,
  5th. AI picks 2nd, 3rd, 6th.
- `aiPickHeuristic`: greedy on Aim attribute with a hard rule "don't end
  with zero rifles when a rifle is in the pool."
- `finalizeDraft` re-IDs picked units to `D1/A1/...` per spawn slot, sets
  facing per `units.ts` convention, and runs `buildStateFromUnits` to
  produce a normal `GameState` at `phase: 'planning'`.

Auto-draft toggle resolves the player's remaining picks via the same
heuristic. Confirm becomes available once all 6 picks are in.

---

## 11. Determinism + event log + stats

### 11.1 Determinism contract

For a given `(map, mode, seed, player draft picks, player strategy picks)`
tuple, the match log (`state.events`) is bit-identical across runs. This
is the foundation for Replay, the headless harness (`batch.ts`), and any
future training-data export.

Per-tick RNG is `createRng(hashSeed(seed, tick))` re-derived from the
match seed and current tick — so a tick's outcome is independent of how
many rolls earlier ticks consumed.

### 11.2 Event log

`GameEvent` discriminated union (`types.ts`):

- `shot` — every resolved attempted shot. Carries `hit`, `headshot`,
  `damage`, `cover`, `range`, `weapon`, `roundIndex`.
- `death` — pushed alongside the lethal `shot`.
- `plant` / `defuse` / `detonate` — spike-plant lifecycle.
- `strategyPick` — round-start summary (player + AI strategy ids).
- `roundResult` — round-end winner + tick count.

All carry `tick` and `roundIndex` so stats can filter to a single round
without timestamp-walking.

### 11.3 Performance stats (`src/game/stats.ts`)

Pure functions consuming `(events, units, roundIndex?)`:

- `computeRoundStats(events, round, units)` — per-unit
  `{ kills, deaths, assists, damage, headshotKills, acs, k/a/s/t }`. KAST
  flags: K = had a kill; A = had an assist (damaged the killer's victim
  within `assistWindowTicks`); S = survived the round; T = was traded
  (teammate killed the killer within `tradeWindowTicks`).
- `computeMatchStats(events, units)` — match-totals + per-round ACS
  history + MVP unit id.

ACS formula:
`acs = perRoundAvg(killValue × kills + assistValue × assists +
multikill3K × (k≥3 ? 1 : 0) + damageMultiplier × damage)`.

Round-end + match-end modals render these directly
(`ui/roundEndPanel.ts`, `ui/matchEndScoreboard.ts`).

### 11.4 Kill feed

`src/ui/killFeed.ts` formats the last N events. Sample lines:

```
R2 strategy — D: Hold | A: Rush
T:8 — D1 (Rifle) → A2 [HEAD, 2 dmg] @ short, cover · KILL
T:12 — ★ A1 planted the spike @ A
T:24 — 💥 SPIKE DETONATED @ A
```

The overlay (`killFeedOverlay.ts`) renders bottom-left of the canvas
during resolution.

---

## 12. UI surfaces

`src/ui/layout.ts` builds a three-column grid:

| Slot | Planning | Resolution |
|---|---|---|
| **Top bar** | Map / Mode / Fog POV / Show enemies / Regions / Help / Begin Round / Timeout | Score + round + half + Back-to-Planning |
| **Left panel** (`cardPanel.ts`) | Strategy menu (roster-filtered) + A/B variant picker | Empty |
| **Canvas** (`renderer.ts`) | Map + units (player team + previewed enemies) + preview routes | Map + units (fog applied) + committed routes + engagements + card-effect visuals |
| **Right panel** (`sidePanel.ts`) | Seed input (Draft only) + both rosters | Hovered unit info DL |
| **Bottom bar** (`bottomControls.ts`) | Disabled placeholders | Play / Pause / 1× / 2× / 4× / Replay |
| **Floating attribute panel** (`attributesPanel.ts`) | Hovered/selected unit's 5 visible aggregates + Details (10 hidden subs) | Same |
| **Kill feed overlay** (`killFeedOverlay.ts`) | Empty | Recent events bottom-left of canvas |
| **Draft overlay** (`draftPanel.ts`, Draft mode match-start only) | 8-unit pool grid + pick progress + Confirm | — |
| **Help modal** (`helpModal.ts`) | Tutorial + glossary + patch notes; auto-opens once per browser | Same |

Render pipeline (`renderer.ts`):
`background → grid → routes → fog → engagements → units → cardEffects →
regionLabels (R) → debugVision (V)`.

---

## 13. Code organization

```
src/
├── main.ts                       Entry point; wires state, render, loop, UI, __sim hook
├── style.css                     All styling (3-column shell + chips + panels)
├── game/                         Pure logic — no DOM / canvas imports
│   ├── config.ts                 ALL tunables (hit table, traits, attrs, plant, draft, …)
│   ├── types.ts                  Shared types (Unit, GameState, GameEvent, Directive, …)
│   ├── hex.ts                    Pointy-top offset/axial conversions, hexLine, hexDistance
│   ├── rng.ts                    Seeded mulberry32 PRNG + hashSeed
│   ├── pathfind.ts               A* + findPerimeterPath + passableAt + neighbors
│   ├── vision.ts                 Cone + occlusion + tracking + ghosts + per-team visibility
│   ├── combat.ts                 resolveShot + effective-stat seam (trait/mod/card/buff hooks)
│   ├── movement.ts               assignTarget + advanceUnit + effectiveSpeed
│   ├── unit-ai.ts                Helpers (cover-hold hex, retreat targets, facing)
│   ├── directives.ts             6 directive evaluators + compliance roll
│   ├── tick.ts                   The per-tick pipeline (AI → move → fire → vision → checks)
│   ├── loop.ts                   PlaybackLoop (timer-driven; pause/play/speed/reset)
│   ├── attributes.ts             generateAttributes + aggregateVisible + rollUnitMeta
│   ├── traits.ts                 availableStrategies + rosterUnlocks + unlockContributors
│   ├── strategies.ts             15 strategy definitions + regionCentroid
│   ├── aiOpponent.ts             pickAiStrategy (roster-filtered weighted random)
│   ├── match.ts                  startRound, applyStrategies, endRound, halftimeSwap
│   ├── state.ts                  buildInitialState + buildStateFromUnits
│   ├── draft.ts                  startDraft, commitDraftPick, autoDraft, finalizeDraft
│   ├── planningPreview.ts        previewPlayerPlan (what-if A* routes during planning)
│   ├── stats.ts                  computeRoundStats + computeMatchStats (pure on events)
│   ├── batch.ts                  Headless harness — runSkirmish / runStrategyMatrix /
│   │                             runComplianceTest / determinismCheck
│   └── units.ts                  createTeam (spawn-slot assignment + facing defaults)
├── render/                       Canvas drawing only
│   ├── canvas.ts                 setupCanvas (CSS+DPR sizing)
│   ├── renderer.ts               Pipeline orchestrator
│   ├── drawHexGrid.ts            8-type grid colors
│   ├── drawUnits.ts              Unit squares + weapon glyph + facing indicator + drag ghost
│   ├── drawRoutes.ts             Committed + preview A* breadcrumbs
│   ├── drawFog.ts                Hex tint + ghost markers
│   ├── drawEngagements.ts        Shooter→target lines during engaged ticks
│   ├── drawCardEffects.ts        Hero passive visuals (aura ring / mark crosshair / scan tint)
│   ├── drawRegionLabels.ts       R-key overlay
│   └── drawDebugVision.ts        V-key overlay (cones + visible hexes + tracking lines)
├── maps/                         Map definitions
│   ├── types.ts                  MapDefinition / CellType / HexCoord
│   ├── gridUtils.ts              fill / rect / hexesOfType / passable helpers
│   ├── foundry.ts                Foundry v2 layout
│   └── atoll.ts                  Atoll v2 layout
└── ui/                           DOM panels + interactions
    ├── layout.ts                 buildShell (3-col grid + all named slots)
    ├── topBar.ts                 Map/Mode/Fog/Region/Help/flow controls
    ├── sidePanel.ts              Roster + unit-info DL + seed input
    ├── cardPanel.ts              Strategy menu + A/B variant picker
    ├── bottomControls.ts         Play / speed / Replay
    ├── attributesPanel.ts        Floating 5-visible + 10-hidden panel
    ├── traitChip.ts              Trait pill with hover tooltip
    ├── unitMetaChip.ts           Role + hero pills with hover tooltip
    ├── hover.ts                  Canvas hex-hover → unit id
    ├── clickToCommand.ts         Canvas click → select unit (planning only)
    ├── unitDrag.ts               Drag player units within spawn zone
    ├── killFeed.ts               Event-line formatters
    ├── killFeedOverlay.ts        Bottom-left mount
    ├── modal.ts                  Centered overlay (round-end / halftime / match-end)
    ├── roundEndPanel.ts          K/D/A/ACS/KAST table for the round modal
    ├── matchEndScoreboard.ts     Full scoreboard sorted by ACS + per-round sparkline
    ├── helpModal.ts              Tutorial + glossary + patch notes
    └── draftPanel.ts             Pool grid + pick progress + Confirm (Draft only)
```

---

## 14. Development & verification

### 14.1 Dev loop

- `npm run dev` — Vite dev server at http://localhost:5173.
- `npm run build` — `tsc --noEmit` + Vite production build.
- `npm run preview` — serve the production build locally.

### 14.2 The `__sim` dev hook

`main.ts` mounts `window.__sim` in DEV builds with the full suite of
inspection / mutation / batch entry points. Highlights:

- `__sim.getState()` / `__sim.setState(s)`
- `__sim.step(n)` — advance the sim n ticks without the loop
- `__sim.place(id, col, row)` / `__sim.setFacing` / `__sim.setHp`
- `__sim.sampleHits(shooter, target, n, ctxOverride)` — empirical HR
- `__sim.getRatings(id?)` / `__sim.getVisible(id?)` / `__sim.setRating(id, key, value)`
- `__sim.getAvailableStrategies(team?)` / `__sim.simulateRound(stratId)`
- `__sim.runValidation(seeds)` — runs strategy matrix + compliance test
  + determinism check; prints a console summary

### 14.3 Validation harness (`src/game/batch.ts`)

All headless, all deterministic:

- `runSkirmish(seed, opts)` — one match start-to-finish.
- `runStrategyRound(seed, opts)` — single round with pinned strategies.
- `runStrategyMatrix(seeds, map, includeUnlocks)` — N seeds × every
  player-strategy × every AI-strategy cell, returns defender-win-% table.
- `runComplianceTest(seeds, map)` — high-Tenacity vs low-Tenacity rosters
  on demanding strategies; expects high-Tenacity to outperform measurably.
- `determinismCheck(seeds, map)` — runs each seed twice, hashes the event
  log, reports mismatch count (hard invariant: must be 0).

### 14.4 Smoke tests via the UI

- **Match flow.** Standard or Draft → pick a strategy → Begin Round →
  round resolves → modal → continue through halftime → first to 4 wins.
- **Visibility / fog.** Press `V`; cones, visible hexes, tracking lines
  should match the seeded outcome.
- **Spike plant.** Watch a Rush attacker reach the plant zone; the
  detonation timer appears in the top bar; defenders rotate to defuse.
- **Attributes.** Hover any unit in planning → 5 visible aggregates
  populated; open Details → 10 hidden subs, with H3-badged greys for the
  inert pair (adaptability + comms).
- **Replay.** Begin Round, let it resolve, click Replay — bit-identical
  re-run.

---

## 15. v1 hooks (what's intentionally inert)

These are wired in v0's data model but consumed only by display, awaiting
the management layer:

- **`adaptability` + `comms` sub-attributes** generated per unit; H3-badged
  inert in the attribute panel. Future fallback-tree quality + hero aura
  scaling.
- **Trait `tier`** (`starter` / `earned` / `event`) generated but treated
  uniformly. Future scouting / XP / event-trigger gating.
- **`preferredRole` mismatch** mechanic shipped, but v0 always assigns
  `role === preferredRole` at draft. Future training / season-build hooks
  would set off-position deliberately.
- **`hero`** as a passive ability tag. Future management layer could let
  managers swap hero training or hero abilities between matches.
- **Sites / plant hexes** are full schema for both maps; v0 uses them for
  the plant mechanic. v1's site-control mechanics ride on the same fields.
- **Match seed** is a single `number` — straightforward to expose via URL
  hash for sharing replays.

---

## 16. Configuration cheat sheet

All numbers live in `src/game/config.ts`. The headline knobs:

| Knob | Default | What it controls |
|---|---|---|
| `GRID` | 30 × 40 | Map dimensions |
| `MATCH_WIN_SCORE` | 4 | Rounds to win the match |
| `MATCH_ROUND_COUNT` | 6 | Regular rounds before tiebreak |
| `ROUND_TICK_LIMIT` | 60 | Max ticks per round (defender wins on timeout) |
| `HIT_TABLE` | per weapon × band | Base hit % |
| `HIT_CLAMP` | [5, 95] pp | Final hit % window |
| `COVER_HIT_PENALTY_PP` | 20 | Half-wall penalty |
| `FIRST_SIGHT_HIT_PENALTY_PP` | 10 | Peeker's advantage |
| `SNIPER_SETTLED_TICKS` | 2 | Ticks before sniper qualifies for stationary table |
| `VISION.ghostTicks` | 5 | Ghost marker lifetime |
| `AI.retreatHpThreshold` | 1 | HP at which a unit retreats |
| `AGGRESSION_PUSH_THRESHOLD` | 55 | Aggression at which idle units advance |
| `ROTATE_AFTER_HOLD_TICKS` | 15 | Idle hold → mid rotation |
| `PLANT_TICKS` | 2 | Ticks to plant |
| `DETONATION_TICKS` | 20 | Ticks plant → detonate |
| `DEFUSE_TICKS` | 4 | Ticks to defuse |
| `DRAFT.poolSize` | 8 | Draft pool size |
| `DRAFT.picksPerTeam` | 3 | Picks per team |
| `ATTRIBUTES.generation.distribution` | `'flat'` | `flat` / `normal` / `uniform` |
| `ATTRIBUTES.generation.mean / stdDev` | 50 / 12 | Normal-mode params |
| `RNG_SEED_DEFAULT` | `0x1a2b3c4d` | Match seed default |

Re-tuning the sim should never require touching non-config files.
