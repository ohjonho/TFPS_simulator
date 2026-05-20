# Tactical FPS Team Sim — v0 Match Simulator

This document is the build specification for v0 of a match simulator that will later become the in-match component of an esports team management game. Paste this entire document into your AI coding assistant (Claude Code, Cursor, v0, etc.) as the project brief. Then work through the build plan section by section — do not attempt to build everything in one prompt.

---

## 1. Project Overview

**v0 scope:** isolate and validate the in-match simulation system. The full game (rosters, training, sponsors, drama, season structure) is OUT OF SCOPE here. The goal of v0 is to prove that watching simulated tactical FPS matches feels meaningful, and that player traits, loadouts, and map layouts interact in interesting ways.

**Style reference:** Valorant-style round-based tactical FPS, viewed from a top-down hex perspective with auto-chess-style pre-planned paths and reactive engagement behavior.

**Inspirations:** Esports Godfather (management loop), Frozen Synapse (path-planning tactical), Into the Breach (deterministic puzzle-tactics feel).

---

## 2. Tech Stack

- **Platform:** Browser-based, single-player.
- **Recommended:** HTML5 Canvas + TypeScript, or React + a 2D canvas library (Pixi.js, Konva). Choose whichever is most idiomatic for the coding assistant.
- **No backend.** All logic client-side, state in memory.
- **No persistence required for v0.** Refresh = fresh state.
- **Visuals:** Abstract / minimal. Colored squares for units, hex grid with shaded walls. No 3D, no audio, no fancy animations. Shot effects = a brief line flash from shooter to target.
- **Architecture:** keep game logic separated from rendering so the simulator could later be ported to a native engine.

---

## 3. Core Game Loop

A **match** is up to 6 rounds (plus possible sudden death). Each round:

1. **Planning phase.** Player draws paths and waypoints for their 3 units. Player sees: own units, own loadouts/traits, enemy spawn area, the map. Player does NOT see live enemy positions or enemy paths.
2. **AI selection.** AI opponent picks one strategy at random from a predefined pool for the current map and side.
3. **Resolution phase.** Both teams execute paths simultaneously. Combat resolves automatically. Player watches.
4. **Round end.** Round ends when one team has zero units alive. Winning team +1 round score.

**Match end:** first team to 4 round wins. If 3–3, sudden death: full loadouts, must win one attack AND one defense round in a row to win the match.

---

## 4. Map Specifications

### 4.1 Grid
Hex grid, **20 columns wide × 30 rows tall** (600 hexes). Defenders spawn at the top (north), attackers spawn at the bottom (south).

### 4.2 Map Elements

| Symbol | Element | Vision | Movement |
|--------|---------|--------|----------|
| `.` | Open hex | Passes | Allowed |
| `#` | Full wall | BLOCKS | Blocked |
| `=` | Half wall | Passes | Blocked |
| `D` | Defender spawn | Passes | Allowed |
| `A` | Attacker spawn | Passes | Allowed |

**Half-wall cover effect:** when a unit is adjacent to a half-wall and a shot crosses that half-wall toward it, incoming hit chance is reduced by **20 percentage points**.

### 4.3 Range Definitions (hex distance)

- Short: 1–4 hexes
- Medium: 5–10 hexes
- Long: 11+ hexes

### 4.4 Map A — "Long Sightlines"

Open layout favoring snipers and rifles. Slightly defender-favored: more pre-positioned cover near defender spawn. Wide mid area with a central wall block to break direct sightlines and force split decisions.

```
   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9
0  . . . . . D D D D . . . . . . . . . . .
1  . . . . . . . . . . . . . . . . . . . .
2  # # # = = . . . . . . . . . = = # # # #
3  . . . . . . . . . . . . . . . . . . . .
4  . . . . . . . . . . . . . . . . . . . .
5  . . = = . . . . . . . . . . . . = = . .
6  . . . . . . . . . # # # . . . . . . . .
7  . . . . . . . . . # # # . . . . . . . .
8  . . . . . . . . . # # # . . . . . . . .
9  . . = = . . . . . . . . . . . . = = . .
10 . . . . . . . . . . . . . . . . . . . .
11 . . . . . . . . . . . . . . . . . . . .
12 # # # = = . . . . . . . . . = = # # # #
13 . . . . . . . . . . . . . . . . . . . .
14 . . . . . . . . A A A A . . . . . . . .
```

The above is the first 15 rows for illustration. Extend to 30 rows using a similar pattern: another stretch of long open mid, another half-wall band, another central feature, then attacker spawn at row 29. The full map should give attackers ~12+ hexes of open crossing per side approach.

### 4.5 Map B — "Tight Angles"

Corridor-heavy layout favoring shotguns and aggressive traits. Hallways 3–4 hexes wide and 6–8 hexes long. Multiple short sightlines, few long ones. Cover placed to enable peek/repeek duels.

Design features:
- 2 main hallways from each spawn to mid
- A central room (~5×5) where hallways converge
- Side rooms with short sightlines providing flank routes
- Half-wall cover at key corners and at hallway entrances

Generate the specific layout during Pass 1 of the build plan.

---

## 5. Unit Mechanics

### 5.1 Properties

Each unit has:
- **HP:** 3 (max)
- **Loadout:** Shotgun / Rifle / Sniper (assigned pre-match)
- **Skill trait:** 1 of 4, randomly assigned at match start
- **Behavioral trait:** 1 of 6, randomly assigned at match start
- **Position:** current hex
- **Facing:** one of 6 hex directions
- **State:** Alive / Dead

### 5.2 Movement

- Default speed: **1 hex per tick**.
- Sniper speed: **0.5 hex per tick** (moves every other tick).
- Run-n-Gun trait: +0.5 hex per tick.
- Tick = ~1 second of real time (adjustable with playback speed: 1x / 2x / 4x).

### 5.3 Loadouts

| Weapon | Hit % Short | Hit % Medium | Hit % Long | Body Dmg | Head Dmg | Fire Rate | Move Speed |
|--------|:-----------:|:------------:|:----------:|:--------:|:--------:|:---------:|:----------:|
| Shotgun | 90% | 30% | 5% | 1 | 2 | 1 / tick | 1.0 |
| Rifle | 70% | 75% | 55% | 1 | 2 | 1 / tick | 1.0 |
| Sniper (stationary) | 30% | 60% | 90% | 2 | 4 | 1 / 2 ticks | 0.5 |
| Sniper (moving) | 15% | 30% | 45% | 2 | 4 | 1 / 2 ticks | 0.5 |

**Sniper additional rules:**
- Vision cone narrows to **45°** when stationary; normal 90° when moving.
- Headshot bonus at long range: **+10 percentage points** headshot chance at 11+ hexes (so 40% base instead of 30%).

### 5.4 Headshot Mechanic (nested rolls)

Per fired shot:
1. Roll hit using weapon × range hit %. If miss, no damage.
2. If hit, roll headshot: **30% base** (40% sniper at long range).
3. Apply damage: body = weapon body dmg; head = weapon head dmg.
4. Traits may modify hit % (additive) or headshot % (additive).

---

## 6. Vision & Information

### 6.1 Vision Cone

- 90° cone in the direction the unit currently faces.
- **Infinite range** along cone, blocked only by full walls.
- Half-walls do NOT block vision.
- Default cone direction matches movement direction; or matches the facing direction specified at a hold waypoint.
- If an enemy enters the cone, the cone snaps to track the closest visible enemy until that enemy dies or is lost from sight.
- **Sniper:** 45° cone when stationary, 90° when moving.

### 6.2 Fog of War

- Team-shared vision: a hex is visible if any allied unit has it in their cone.
- Enemy units render only when currently visible to the player's team.
- Last-seen enemy position persists as a faded "ghost" marker for 5 ticks after losing sight.

---

## 7. Trait System

Each unit gets **1 skill trait + 1 behavioral trait**, randomly assigned at match start.

### 7.1 Skill Traits (random pick of 1)

| Trait | Effect |
|-------|--------|
| Sharp Aim | +10 percentage points hit % across all weapons |
| Headhunter | +10 percentage points headshot chance with rifle only |
| Eagle Eye | Vision cone +30° (so 120° normal, 75° sniper stationary) |
| First Shot | +20 percentage points hit % on the unit's first shot of any engagement |

### 7.2 Behavioral Traits (random pick of 1)

| Trait | Effect |
|-------|--------|
| Sentinel | +15 hit %, +10 headshot %, when stationary for 3+ consecutive ticks |
| Run-n-Gun | +0.5 movement speed; +10 hit % while moving |
| Lurker | +15 hit %, +10 headshot %, when adjacent to any wall hex |
| Entry | +20 hit % during first 3 ticks of any engagement; −10 after |
| Trader | +15 hit % if any ally has fired in the last 3 ticks |
| Clutch | +20 hit %, +15 headshot %, when last alive on team |

### 7.3 Trait-Modified Behavior

In addition to stat modifiers, some traits change behavior:

- **Entry:** when enemy spotted, pushes forward 1 hex toward the enemy instead of holding (subject to walls and LoS).
- **Lurker:** when at 1 HP, retreats by routing to the nearest wall hex (path interruption).
- **Clutch:** when last alive, ignores normal retreat behavior; continues engaging.
- **Sentinel:** does not retreat at 1 HP; holds position.

**Default retreat behavior (for any unit not modified by trait):** at 1 HP, route to nearest wall hex to break LoS. Resume original path if not re-engaged for 3 ticks.

---

## 8. Path Planning Phase

### 8.1 Player Inputs

For each of 3 units, the player can:

1. **Draw a movement path:** click-drag along hexes from the unit's spawn position. Path can be any length within map bounds.
2. **Add waypoints:** click any hex on the drawn path to set a **hold action** — "hold N ticks facing direction X." Direction is one of 6 hex directions.
3. **End-of-path behavior:** when the unit reaches the end of the drawn path, it holds final position facing the direction of last movement (or the last specified hold direction).

### 8.2 Visualization

- Drawn paths shown as colored lines per unit.
- Waypoints shown as numbered circles with a facing arrow.
- Player can clear and redraw any unit's path before locking in.
- "Begin Round" button commits all paths, triggers AI strategy selection, and starts resolution.

### 8.3 Engagement Override (Hybrid Behavior)

When a unit's vision cone acquires a spotted enemy:
- Unit STOPS executing its path.
- Unit engages: faces enemy, fires per loadout rules each tick.
- When enemy is dead or out of LoS for 3+ consecutive ticks, unit resumes path from current hex.
- Trait modifiers may alter this (see 7.3).

---

## 9. AI Opponent

For v0, the AI opponent uses **predefined strategies**, randomly selected per round.

### 9.1 Strategy Pool

For each map × side combination (so 4 combinations total: Map A defenders, Map A attackers, Map B defenders, Map B attackers), define **3 strategies**. Each strategy is a hand-designed set of paths + waypoints + loadout assignments for the AI's 3 units.

Example strategies for Map A defenders:
- "Long hold": all 3 hold sniper-friendly angles from spawn; loadouts = 2 snipers + 1 rifle.
- "Stagger split": 1 holds long, 2 push different mid sides; loadouts = 1 sniper + 2 rifles.
- "Aggressive mid": all 3 push mid to take central wall; loadouts = 2 shotguns + 1 rifle.

The AI picks one at random at round start. Player does NOT see which.

### 9.2 AI Trait Assignment

AI units also get random traits (same trait pool as player). For v0, AI loadouts are pre-defined per strategy. The player's team also has pre-defined loadouts (chosen pre-match by the player); v0 does not include in-match loadout changes.

---

## 10. Round & Match Structure

- 6 rounds total: 3 attack, 3 defense. Player chooses starting side (or random).
- First team to 4 round wins takes the match.
- If 3–3 after 6 rounds: **sudden death** — full loadouts, must win one attack AND one defense round in a row.
- **Timeout:** Each team has 1 timeout, available at match point (when their score is 3 and opponent is < 4). On timeout, the player can redraw all paths before the next round begins. No loadout changes in v0.
- **Half transition:** at round 3 → round 4, teams swap sides. Same units, same loadouts, same traits. Defender-favor flips.

---

## 11. UI Requirements

### 11.1 Match Screen Layout
- Top bar: round score (P vs AI), round number, current half (Atk/Def), timeouts remaining.
- Center: hex map with units, paths, vision/fog of war during resolution.
- Side panel: unit details (HP, loadout, traits) for hovered/selected unit.
- Bottom: playback controls (Play/Pause, 1x/2x/4x, Replay last round).

### 11.2 Planning Phase UI
- Map shown without fog of war for the player's side (but no live enemy info).
- Enemy spawn area highlighted (just the zone, no units).
- Unit cards showing each player's loadout + traits.
- Path-drawing tools: click-drag to draw, click on path to add a waypoint (modal: hold ticks + facing direction).
- "Begin Round" button.

### 11.3 Resolution Phase UI
- Fog of war active.
- Paths shown faintly as units execute them.
- Shot events: brief line flash from shooter to target.
- Damage popups: "−1" or "−2 HS" floating above hit unit.
- Death: unit greys out and remains visible as a marker.

### 11.4 Kill Feed
Persistent log shown at side or bottom of screen. Format:

```
T:12 — A2 (Rifle) → B1 [body, 1 dmg]
T:14 — A2 (Rifle) → B1 [HEAD, 2 dmg] KILL
T:18 — B3 (Sniper) → A1 [body, 2 dmg]
T:23 — A3 (Shotgun) → B2 [body, 1 dmg] @ short, half-wall cover
...
```

### 11.5 Replay
- After each round, a "Replay" button re-runs the same round at the chosen speed.
- Replay must be deterministic: uses recorded random seed, paths, and AI strategy.

---

## 12. Out of Scope for v0

Do NOT build:
- Multiple matches, seasons, tournaments
- Player roster management, training, signing, scouting
- Economy / money / in-match loadout purchases
- Pistol rounds
- Abilities or character agents
- 3D rendering
- Audio
- Mobile / touch controls (keyboard + mouse only)
- Save / load
- Multiplayer
- Sponsors, business management, drama, storylines

---

## 13. Validation Criteria for v0

v0 is successful if all (or at least 4 of these 6) are observably true:

1. **Trait differentiation:** two different trait combinations on the same unit produce visibly different play patterns across multiple matches.
2. **Map character:** Map A produces noticeably more sniper/rifle kills; Map B produces noticeably more shotgun/close kills.
3. **Defender favor:** in neutral matchups across 20+ rounds, defenders win 55–65% of rounds. Not so dominant that attackers feel hopeless.
4. **Match length:** a full match (6+ rounds) takes 5–10 minutes of real time at 1x.
5. **Causal legibility:** after watching a round, the player can articulate why their team won or lost (using kill feed + replay).
6. **AI variety:** AI feels different across rounds; the 3 strategies per side feel distinguishable.

If these hit, the concept is validated and the management layer can be built on top. If they don't, identify which mechanics need tuning before expanding scope.

---

## 14. Engineering Notes

- **Determinism.** Given the same paths, AI strategy, and random seed, the round must resolve identically. This makes replays trivial and bugs reproducible. Use a seeded PRNG for all rolls.
- **Tuning.** Pull all numbers (hit %, dmg, trait modifiers, range thresholds) into a single config object or file. Expect to iterate heavily.
- **Tick simulation.** Run the game loop in discrete ticks. Each tick: update positions → update vision → resolve engagements → apply damage → check round end. Playback speed scales tick duration, not tick logic.
- **Logging.** Keep an internal event log of every shot, hit, miss, kill, and state change. This powers the kill feed AND lets the replay system render past rounds.

---

# Build Plan: 7 Passes to a Working v0

Do NOT attempt to build all of this in one prompt. Build in 7 incremental passes, validating after each. The order matters: vision logic is the riskiest piece, so it gets built before combat. Tuning happens at the end.

## Pass 1 — Map Rendering & Static Units

**Goal:** render the hex grid, draw walls/cover from a data definition, place units at spawn positions.

**Deliverables:**
- Hex grid renderer (20×30)
- Map loader from 2D array (`.`, `#`, `=`, `D`, `A`)
- Map A defined and loaded
- Units rendered as colored squares with weapon icons at spawn hexes
- UI shell with empty side panel and placeholder controls

**Validation:** Map A renders correctly, distinct visual for full walls vs half-walls, defender/attacker spawns clear, can hover a unit to see placeholder info.

**Prompt seed:**
> Build the foundation of a hex-grid tactical simulator: render a 20-wide × 30-tall hex grid, load Map A from a 2D array, and place 3 defender + 3 attacker units at their spawn hexes. Distinguish full walls (block vision + movement) from half-walls (cover only, vision passes). Use HTML5 Canvas + TypeScript. Use abstract visuals: colored squares for units (3 blue, 3 red), shaded hexes by terrain type. No game logic yet — this is the static foundation.

## Pass 2 — Path Drawing & Movement

**Goal:** player draws movement paths; units execute them tick by tick.

**Deliverables:**
- Click-drag path drawing per unit
- Waypoint creation (click existing path → modal for hold duration + facing direction)
- "Begin Round" button locks paths
- Tick-based movement: 1 hex/tick default, 0.5 for sniper
- Playback controls: Play / Pause / 1x / 2x / 4x

**Validation:** Can draw 3 paths with waypoints, hit Begin, watch units move along paths and hold at waypoints with correct facing.

## Pass 3 — Vision Cones & Fog of War

**Goal:** implement directional vision with wall occlusion and team-shared fog. **This is the riskiest pass — validate thoroughly.**

**Deliverables:**
- 90° cone per unit, infinite range, blocked by full walls only
- Cone tracks movement direction or hold facing
- Team-shared visibility (allies share what they see)
- Enemy units rendered only when visible
- Faded "ghost" marker for 5 ticks after losing sight
- Sniper: 45° cone when stationary, 90° when moving
- Cone snaps to track nearest visible enemy once spotted

**Validation:** Move a unit into LoS of an enemy → enemy appears. Walk behind a full wall → enemy disappears, ghost marker shows for 5 ticks. Half-walls do NOT block vision. Two allies in different parts of map cooperatively reveal an enemy seen by one of them.

## Pass 4 — Combat Resolution

**Goal:** units engage spotted enemies; damage, HP, deaths work.

**Deliverables:**
- Hybrid engagement: unit stops path when enemy spotted, engages
- Per-tick hit roll based on weapon × range hit %
- On hit, nested headshot roll (30% base, 40% sniper at 11+ hexes)
- Damage applied; units die at 0 HP
- Fire rates per loadout (sniper every 2 ticks)
- Half-wall cover applies −20 percentage points to incoming hit %
- Unit resumes path 3 ticks after losing LoS to all enemies
- Basic kill feed (text log, no fancy formatting yet)
- Sniper accuracy penalty while moving

**Validation:** Two units in LoS shoot each other; eventually one dies. Shotgun-close vs sniper-long produce clearly different kill rates. Half-wall cover noticeably extends duels. Kill feed records shots in order.

## Pass 5 — Trait System

**Goal:** all 10 traits implemented, randomly assigned at match start.

**Deliverables:**
- 4 skill traits with stat modifiers
- 6 behavioral traits with stat modifiers AND behavioral overrides (Entry pushes forward, Lurker retreats to wall, Clutch ignores retreat, Sentinel holds at 1 HP)
- Random trait assignment at match start (1 skill + 1 behavioral per unit)
- Trait display on unit cards in side panel
- Default retreat behavior at 1 HP (route to nearest wall)

**Validation:** Run the same match twice with manually swapped trait sets — outcomes differ visibly. Lurker visibly hugs walls when low HP. Entry visibly pushes when spotting an enemy.

## Pass 6 — Round Structure, Match Flow, AI Opponent

**Goal:** full match loop with rounds, sudden death, timeout, and AI strategies.

**Deliverables:**
- Round end detection (one team eliminated)
- Round scoring, half transition at round 3 → 4 (swap sides)
- First-to-4 win condition
- 3–3 sudden death (must win 1 attack + 1 defense in a row)
- 1 timeout per side at match point; on use, allows redraw of all paths
- AI opponent: 3 predefined strategies × 4 (map × side combinations) = 12 strategies total
- AI picks random strategy per round, applies pre-defined loadouts and random traits

**Validation:** Play a full match start to finish, including a 3-3 sudden death scenario. AI behavior varies round to round. Timeout works at match point.

## Pass 7 — Replay, Polish, Tuning

**Goal:** deterministic replay, polished kill feed, end-of-match summary, and a tuning pass.

**Deliverables:**
- Deterministic round replay using recorded seed + paths + AI strategy
- Polished kill feed with timestamps, weapon, range, cover note, kill flag
- Damage popups in the world ("−1", "−2 HS")
- Death animation (fade to grey marker)
- End-of-match screen: final score, MVP (most kills), round-by-round summary
- Tuning pass: run validation criteria, adjust numbers in config until validation criteria hit

**Validation:** Run the 6 validation criteria from section 13. Achieve at least 4 of 6 before declaring v0 done.

---

## Final Notes for the Builder

- After each pass, ASK the user to verify the validation criteria before moving on. Do not stack passes.
- Surface tunable parameters early (hit %, damage values, trait modifiers, range thresholds). Expect heavy iteration on these.
- The 30-row maps are not yet fully defined; design them collaboratively with the user during Pass 1 (Map A based on the 15-row template provided, Map B fresh).
- Once v0 is validated, the management layer (rosters, training, sponsors, tournaments) will be built ON TOP of this simulator. Design the simulator so unit stats and trait modifiers are CONFIGURABLE per unit (not hardcoded constants on a fixed roster) — this is critical for the future management layer to work.
