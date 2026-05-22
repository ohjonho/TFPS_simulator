# Tactical FPS Team Manager — v0 Spec (rev 2)

This document supersedes all prior versions. It is the build specification for v0 of an esports team management simulator focused on a tactical FPS game (Valorant-inspired). v0 validates the core simulation and manager-agency loop. The full game (rosters, training, sponsors, seasons, drama) is OUT OF SCOPE here and is built on top of v0 in v1+.

Paste this entire document into your AI coding assistant as the project brief. Work through the 9-pass build plan in section 22 — do not attempt to build everything in one prompt.

---

## 1. Project Overview

**Game thesis.** An esports team manager simulator for a tactical FPS league. The player is the head coach / manager. They prepare the team (roles, loadouts, strategy book), make round-by-round strategic calls during matches, and play tactical "playbook cards" at key moments. They do NOT control units directly. Units execute autonomously via AI based on team strategy, individual traits, roles, heroes, and modifiers.

**Inspirations:** Esports Godfather (management loop), Football Manager (depth of preparation, sparingness of in-match intervention), Valorant (tactical FPS frame).

**v0 goal.** Validate that the in-match simulation feels meaningful, that manager-agency decisions (strategies + cards) visibly affect outcomes, and that trait/role/hero/loadout combinations produce distinct play patterns across the two maps.

**v1 target (post-v0).** Scale to 5v5, add spike-plant objective, add roster management layer, add utility cards, add morale system, expand card pool.

---

## 2. Tech Stack & Architecture

- **Platform:** Browser-based, single-player, no backend.
- **Language:** TypeScript (strict mode).
- **Rendering:** HTML5 Canvas. No game engine, no React.
- **State:** in-memory. No persistence in v0.
- **Visuals:** abstract / minimal. Hex grid with shaded terrain, colored squares for units with weapon icons, simple UI overlays. No 3D, no audio.
- **Tech-debt rules:**
  - **Game logic strictly separated from rendering.** `src/game/` is pure logic with no DOM or canvas imports. `src/render/` handles drawing. This enables later porting to Electron/Tauri or a native engine.
  - **Deterministic simulation.** Given the same inputs (strategy, cards played, seed), rounds must resolve identically. Use a seeded PRNG for all random rolls.
  - **Tick-based loop.** Discrete ticks (~1s real time at 1x speed). Per tick: AI decisions → movement → vision update → engagement → damage → state changes → round-end check. Playback speed scales tick *duration*, not tick *logic*.
  - **All tunable values in config.** Hit %, damage, trait modifiers, range thresholds, grid sizes, card effect numbers, AI thresholds — single config module. Expect heavy iteration.
  - **Event log.** Every shot, hit, miss, kill, card play, AI decision goes into an internal log. Powers the kill feed AND deterministic replays AND debug tools.

---

## 3. The Match Loop

A match consists of up to 6 rounds, plus possible sudden death. Each round:

1. **Planning phase (~15s real time, skippable).** Player sees current score, both teams' rosters with roles/loadouts/traits, hand of cards, and the strategy menu. Player picks one strategy and optionally plays one card. Clicks "Begin Round."
2. **AI opponent picks its strategy and card.** Hidden from player. Same logic as player but executed by simple AI heuristics.
3. **Resolution phase.** Both teams execute autonomously per their AI behavior, modified by their strategy and any played cards. Player watches with kill feed, playback speed controls, and the ability to pause.
4. **Round end.** Triggered when one team has zero units alive. Winning team +1 round score. Round-end screen shows result, kills, key events.
5. **Card draw.** Player draws 1 card (if hand < 3 cap). Used cards shuffle back into the deck.
6. **Next round.** At round 3 → 4, sides swap (attackers become defenders and vice versa). At match point (player's score = 3, opponent < 4), timeout becomes available. At sudden death (3–3), the sudden-death sub-loop begins.

**Match end:** first team to 4 round wins, or wins sudden death (see section 17).

---

## 4. Maps

### 4.1 Grid & Coordinate System

- **30 columns × 40 rows** hex grid (axial coordinates, "pointy-top" hexes).
- Hex distance computed by axial coord math.
- Defenders spawn at top (north), attackers at bottom (south).

### 4.2 Cell Types

| Code | Name | Vision | Movement | Notes |
|------|------|--------|----------|-------|
| `wall` | Full wall | BLOCKS | Blocked | Architectural / void |
| `open` | Open corridor/floor | Passes | Allowed | Default traversable |
| `def` | Defender spawn | Passes | Allowed | Spawn marker |
| `atk` | Attacker spawn | Passes | Allowed | Spawn marker |
| `site` | Site interior | Passes | Allowed | Latent v1 plant area marker |
| `plant` | Plant zone | Passes | Allowed | Subset of site; v1 plant-placement target |
| `mid` | Mid zone | Passes | Allowed | Same as open, region-labeled |
| `cover` | Cover (half-wall) | Passes | Blocked | Provides incoming hit % penalty |

**Half-wall cover effect:** when a unit is adjacent to a `cover` hex and a shot crosses that cover toward it, incoming hit chance is reduced by **20 percentage points**.

**Note:** in v0, `site` and `plant` behave identically to `open`/`mid`. They are metadata for v1 spike-plant. Region labels (`mid`, `site`) are also used by AI for behavior templates and don't affect mechanics.

### 4.3 Range Definitions (hex distance)

- Short: 1–4 hexes
- Medium: 5–10 hexes
- Long: 11+ hexes

### 4.4 Map A: Foundry

**Character:** tight B squeeze, open A site. Asymmetric — B is a constricted corridor approach with hard chokes; A is a wider site with more entry angles. Favors tactical map control. Mid is a contested zone with a central pillar.

**Layout source:** prototyped in `hex_maps_foundry_atoll.html` (foundry function). Translate the grid generation directly into `src/maps/foundry.ts`.

**Key regions** (used by AI as behavior templates):
- `def_spawn`
- `b_site`, `b_plant`, `b_squeeze` (tight choke)
- `a_site`, `a_plant`, `a_connector` (wider entry)
- `mid`, `mid_pillar` (central 2×2 wall block)
- `b_main`, `b_lobby`, `a_main`, `a_lobby` (attacker corridors and staging)
- `atk_spawn`

### 4.5 Map B: Atoll

**Character:** wide B dock with long sniper sightline, tight A labyrinth. Asymmetric — B Main is a long sniper-friendly approach; A site is a constricted labyrinth with multiple internal walls. Favors information-gathering and adaptive play.

**Layout source:** prototyped in `hex_maps_foundry_atoll.html` (atoll function). Translate directly into `src/maps/atoll.ts`.

**Key regions:**
- `def_spawn`
- `b_site` (wide), `b_plant`, `b_dock`
- `a_site` (labyrinth with internal walls), `a_plant`, `a_maze`
- `mid`, `mid_courtyard`
- `b_main` (long sniper lane), `b_lobby`, `a_main`, `a_lobby`
- `atk_spawn`

### 4.6 Map Definition Schema

```typescript
type CellType = 'wall' | 'open' | 'def' | 'atk' | 'site' | 'plant' | 'mid' | 'cover';

type HexCoord = { col: number; row: number };

type MapDefinition = {
  name: 'Foundry' | 'Atoll';
  width: 30;
  height: 40;
  grid: CellType[][];                    // [row][col]
  regions: Record<string, HexCoord[]>;   // named region → hexes
  sites: {
    A: { hexes: HexCoord[]; plantHexes: HexCoord[]; centerHex: HexCoord };
    B: { hexes: HexCoord[]; plantHexes: HexCoord[]; centerHex: HexCoord };
  };
  spawns: {
    defenders: HexCoord[];                // length 3 for v0, will be 5 for v1
    attackers: HexCoord[];
  };
  character: 'open_sightlines' | 'tight_corridors_asymmetric';
};
```

Region metadata is required because AI behavior templates reference regions by name ("attacker rushes B via b_main"). Without regions, the AI has no language for strategy.

---

## 5. Units

### 5.1 Properties

Each unit has:

- **HP**: 3 (max). 4 with Angelic Guardian Aura card.
- **Loadout**: Shotgun / Rifle / Sniper, set per-match by player loadout policy.
- **Role**: Vanguard / Tactician / Warden / Specialist (see section 10).
- **Hero**: Angelic / Techy / Cursed (see section 11). Random at match start in v0.
- **Skill trait**: 1 of 4, random at match start (see section 12.1).
- **Behavioral trait**: 1 of 6, random at match start (see section 12.2).
- **Modifiers**: dynamic state — aggression, clutch eligibility, off-position penalty status, active buffs/debuffs from cards (see section 13).
- **State**: Alive / Dead, current hex, current facing (1 of 6 hex directions).

### 5.2 Movement

- Default: **1 hex per tick**.
- Sniper: 0.5 hex per tick (moves every other tick).
- Run-n-Gun behavioral trait: +0.5 speed.
- Tick = 1 second at 1x playback. Playback speed options: 1x / 2x / 4x.

### 5.3 Loadouts

| Weapon | HR Short | HR Medium | HR Long | Body Dmg | Head Dmg | Fire Rate | Move Speed |
|--------|:--------:|:---------:|:-------:|:--------:|:--------:|:---------:|:----------:|
| Shotgun | 90% | 30% | 5% | 1 | 2 | 1/tick | 1.0 |
| Rifle | 70% | 75% | 55% | 1 | 2 | 1/tick | 1.0 |
| Sniper (stationary) | 30% | 60% | 90% | 2 | 4 | 1/2 ticks | 0.5 |
| Sniper (moving) | 15% | 30% | 45% | 2 | 4 | 1/2 ticks | 0.5 |

**Sniper additional rules:**
- Vision cone narrows to 45° when stationary (defined: did not change hex this tick AND not the first tick leaving a hold). 90° while moving.
- Headshot bonus at long range: +10 percentage points (so 40% HS chance at 11+ hexes instead of 30%).

In v0, loadouts are set per match by the player's "loadout policy" (see section 9). No in-round purchasing.

---

## 6. Vision & Information

### 6.1 Vision Cone

- 90° cone in the direction the unit is currently facing.
- **Infinite distance** along the cone, blocked only by `wall` cells.
- `cover` cells do NOT block vision.
- Default facing = direction of last movement. While holding (stationary by AI choice), facing = direction toward expected threat (set by behavior template) or last movement.
- When an enemy enters the cone, facing snaps to point at the closest visible enemy by hex distance. Tiebreak: lowest unit ID (deterministic).
- When the tracked enemy dies or leaves sight for 3+ consecutive ticks, facing reverts to behavior-default (movement direction or assigned hold direction).
- **Sniper** stationary: 45° cone. Moving: 90°.
- **Eagle Eye** skill trait: +30° to base cone (so 120° normal, 75° stationary sniper).

### 6.2 Occlusion

- Computed via **supercover hex-line tracing**: for each candidate hex in the cone, trace a hex line from the viewer to the target. If any hex along the line is `wall`, the target is hidden. `cover` cells do not block.
- Cone filter (angle test) is applied first; occlusion check is applied to hexes passing the cone test.

### 6.3 Fog of War

- **Team-shared visibility.** A hex is visible to a team if any alive ally has it in their cone.
- Enemy units render only when currently visible to the player's team.
- **Ghost markers:** after losing sight of an enemy, a faded marker persists at last known position for 5 ticks. Cleared immediately if the enemy becomes visible again.

### 6.4 Debug Mode

- Toggleable via keyboard (e.g., `V`). For development and validation only — not exposed in production UI.
- When on: renders cone arc edges for selected unit, hexes currently in cone, hexes currently visible (cone ∩ not-occluded), and trace lines to tracked enemy.

---

## 7. Combat

### 7.1 Engagement Trigger

When an alive unit's cone (post-occlusion) contains an alive enemy unit, the unit transitions to "engaged" state and stops executing its AI behavior path. It fires per loadout rules each tick (or every 2 ticks for sniper).

Disengagement: when the engaged target dies or leaves sight for 3+ ticks AND no other enemy is visible, the unit resumes its AI behavior.

### 7.2 Hit Resolution (nested rolls)

Per fired shot:

1. **Hit roll:** weapon-and-range hit %, modified by:
   - Trait bonuses (Sharp Aim +10pp, First Shot +20pp on first shot of engagement)
   - Behavioral bonuses (Sentinel +25pp stationary, Run-n-Gun +15pp moving, Lurker +20pp adjacent to wall, Entry +20pp first 3 ticks, etc.)
   - Modifier effects (aggression, clutch, off-position — see section 13)
   - Card effects (Spearhead +15pp, Cursed Mark +20pp on target, etc.)
   - Half-wall cover penalty: −20pp if shot crosses cover into target
   - Final hit % clamped to [5%, 95%].
2. If hit, **headshot roll:** 30% base (40% sniper at long range), modified by traits (Headhunter +10pp with rifle, Cursed Mark +10pp on target, Sentinel +20pp stationary, Lurker +10pp adj wall, Clutch +15pp when last alive).
3. Apply damage: body = weapon body damage, head = weapon head damage.
4. If HP drops to ≤0, unit dies. Position remains as a greyed-out marker for the round.

### 7.3 Per-Tick Engagement

Each engaged unit fires once per tick (snipers every 2 ticks). Both units in an engagement fire in the same tick — simultaneous. Order of damage application doesn't matter when both shoot; deaths apply at end of tick.

### 7.4 Buff/Debuff System

Cards apply temporary modifiers (buffs/debuffs) with duration in ticks. Each unit has an active modifiers list. Hit/damage calculations read base stats + trait mods + active buff mods.

Buffs to support:
- HR / HS additive modifiers (per-unit or per-target-pair)
- Max HP modifier (Angelic aura)
- Vision modifier (forced visibility for Techy Scan)
- Behavior overrides (push instead of hold, ignore retreat, etc.)

Duration: most card buffs last one round. Cleared at round end.

---

## 8. Unit AI Behavior

### 8.1 Architecture: Team Strategy → Role/Region → Per-Unit Execution

Three-layer cascade:

**Layer 1 — Team Strategy** (picked once at round start by player or AI).
The strategy is a named behavior template: Execute / Rush / Control (attacker) or Hold / Stack / Pressure (defender). The template encodes per-role region assignments and aggression baseline.

**Layer 2 — Role/Region Assignment.**
Strategy resolves into role-specific targets:
- "Execute" → Vanguard pushes A_main → A_site, Warden holds A_main → A_lobby trade position, Tactician moves to mid_pillar for util setup, etc.
- Each strategy has hardcoded region assignments per role per map.

**Layer 3 — Per-Unit Tactical AI.**
Within their assigned region, each unit makes tick-by-tick decisions:
- Move toward assigned region (A* pathfinding on hex grid)
- Engage on sight (section 7.1)
- Retreat at 1 HP (unless trait overrides: Sentinel, Clutch, Entry)
- Hold position once assigned region reached
- Reposition every N ticks if no enemy seen (avoid being predictable)

Card effects insert *overrides* into Layer 3: e.g., Lurker "Slow Flank" replaces the unit's region target with a perimeter path; Vanguard "Spearhead" makes that unit take point with allies following 2 ticks behind.

### 8.2 Modifier Application

Every AI decision and every hit calculation reads the unit's effective stats: base + trait + role + hero + active modifiers + card buffs. Section 13 details the modifier system.

### 8.3 Behavior Primitives (Pass 4)

Build these as pure functions in `src/game/unit-ai.ts`:

- `moveToward(unit, targetHex, map): NextHex`
- `shouldEngage(unit, visibleEnemies): EngagementDecision`
- `shouldRetreat(unit, threats): RetreatDecision`
- `pickFiringTarget(unit, visibleEnemies): UnitId`
- `holdPosition(unit, facingDir): HoldAction`

Each is overridable by strategy parameters and card buffs.

---

## 9. Manager Agency

The player makes a small number of high-leverage decisions per match, organized in three layers by time horizon.

### 9.1 Layer 1 — Pre-Match (set once)

- **Role assignments.** Player assigns each unit a role from {Vanguard, Tactician, Warden, Specialist}. Each unit has a preferred role; assigning off-preferred-role applies the off-position modifier penalty for the whole match.
- **Loadout policy.** Player picks each unit's loadout (Shotgun / Rifle / Sniper). Fixed for the match.
- **Side selection.** Player chooses attack or defense for the first half. Sides swap at round 3 → 4.

### 9.2 Layer 2 — Per-Round (every round)

- **Strategy pick.** From 3 options for the player's current side (section 14).
- **Card play.** Optionally play 1 card from hand (section 15).

### 9.3 Layer 3 — Reactive (rare, trigger-gated)

- **Timeout** (1 per match, available at match point). On use: replan strategy pick before the next round; card hand carries over.
- **Halftime team talk.** Placeholder in v0 (UI hook present but no mechanical effect). Active in v1+ when morale system lands.

---

## 10. Roles

Four roles for v0. Each role has a preferred playstyle and a unique role card.

| Role | Description | Off-Position Penalty Applies When |
|------|-------------|-----------------------------------|
| **Vanguard** | Entry duelist. Takes first contact, wins opening engagements. | Assigned to a role they're not preferred for. |
| **Tactician** | Utility-heavy initiator. Sets up plays, creates angles for allies. | (same) |
| **Warden** | Defensive anchor. Holds sites, rotates to defend. | (same) |
| **Specialist** | Flex / unique. Adapts to team needs, can mimic other roles. | (same) |

**Each unit has a preferred role** (set in v0 by random assignment at match start, becomes a permanent attribute in v1 rosters). Assigning the unit to its preferred role: no penalty. Assigning to a non-preferred role: −10pp hit rate for the whole match.

Each role contributes 1 card to the team deck. Card names and effects in section 15.

---

## 11. Heroes

Three heroes for v0. Random assignment at match start (becomes permanent player attribute in v1).

| Hero | Tendency | Card Card Effect Theme |
|------|----------|------------------------|
| **Angelic** | Supportive, defensive | Aura buff to nearby allies |
| **Techy** | Supportive, info-gathering | Forced visibility |
| **Cursed** | Info-gathering, aggressive | Single-target debuff |

Each hero contributes 1 card to the team deck. Effects in section 15.

**Important scope clarification:** in v0, heroes are *only* a card source. They do not add abilities to in-round play beyond their card. The "full hero system" (passive abilities, unique mechanics, ultimates) is deferred to v1+.

---

## 12. Traits

Each unit has 2 traits: 1 skill + 1 behavioral. Random at match start.

### 12.1 Skill Traits (1 of 4)

| Trait | Effect |
|-------|--------|
| **Sharp Aim** | +10pp hit rate across all weapons |
| **Headhunter** | +10pp headshot chance with rifle only |
| **Eagle Eye** | Vision cone +30° (120° normal, 75° stationary sniper) |
| **First Shot** | +20pp hit rate on the unit's first shot of any engagement |

### 12.2 Behavioral Traits (1 of 6)

| Trait | Effect |
|-------|--------|
| **Sentinel** | +25pp HR / +20pp HS when stationary for 3+ consecutive ticks. Doesn't retreat at 1 HP — holds. |
| **Run-n-Gun** | +0.5 movement speed; +15pp HR while moving |
| **Lurker** | +20pp HR / +10pp HS when adjacent to any wall hex. At 1 HP, retreats by routing to nearest wall. |
| **Entry** | +20pp HR / +15pp HS during first 3 ticks of any engagement; −10pp HR after. At 1 HP, does NOT retreat — pushes forward. |
| **Trader** | +15pp HR if any ally has fired in the last 3 ticks |
| **Clutch** | +20pp HR / +15pp HS when last alive on team. Does NOT retreat — ignores normal retreat behavior. |

### 12.3 Trait → Card Mapping

Each behavioral trait contributes 1 card to the team deck (named card per trait). See section 15.

---

## 13. Modifiers

Modifiers are dynamic per-unit state that affects performance during a match. They are calculated and applied in the hit/damage pipeline.

### 13.1 Modifiers Active in v0

| Modifier | Mechanic |
|----------|----------|
| **Aggression** | Per-unit rating 0–100. Affects unit's tendency to push vs hold and HR in the first 3 ticks of a round. Effective HR = base + ((aggression - 50) × 0.2) for the first 3 ticks. Set per-role (Vanguard 70, Tactician 50, Warden 35, Specialist 55) and modified by strategy (+10 on Rush/Pressure, −10 on Control/Hold). |
| **Clutch Factor** | Integrated with Clutch behavioral trait. When unit becomes last alive, applies trait bonus (or +10pp/+5pp default if unit doesn't have Clutch trait). |
| **Weapon Handling** | Per-unit rating 0–100 per weapon type. Applied as HR modifier: ((handling - 50) × 0.1) pp. Random per unit in v0; becomes a player attribute in v1. |
| **Off-Position Penalty** | −10pp HR for the whole match if assigned a role outside the unit's preferred role. |

### 13.2 Modifiers Deferred to v1+

Mention in spec, do NOT implement in v0:

- **Utility Impact** — requires utility system (flashbangs, smokes, stuns). v1.
- **Morale Dynamics** — match-state-dependent. v1+. Halftime team talk UI built as placeholder in v0.

### 13.3 Implementation

Modifiers live in a `Modifiers` struct per unit. Effective stats computed each tick as `base + trait + role + hero + active_buffs + modifiers`. All numbers tunable in config.

---

## 14. Strategies

Player picks 1 strategy per round from a 3-option menu specific to current side. AI picks the same way.

### 14.1 Attacker Strategies

| Strategy | Behavior Template |
|----------|-------------------|
| **Execute** | Standard map routes, balanced aggression. Units split: 1 each on A_main, mid, B_main. Engage on contact. |
| **Rush** | Accelerated movement (+10 aggression all units), lower retreat threshold, immediate engagement. Units commit to one site (AI picks A or B based on unit composition). |
| **Control** | Slower paths (−10 aggression all units), prioritize map information. Units take longest available route to assigned region; hold positions before committing to a site. |

### 14.2 Defender Strategies

| Strategy | Behavior Template |
|----------|-------------------|
| **Hold** | Standard defensive distribution: 1 Warden on each site, 1 unit (Tactician or Specialist) holding mid. React to threats. |
| **Stack** | Two units cluster on AI's read of likely attack site (random in v0; AI-predicted in v1), third roams. Stacked site gets +10pp HR (defensive coordination); unstacked site exposed. |
| **Pressure** | Defenders push forward off spawn (+10 aggression). Contest mid and forward positions. Higher risk of being out of position when attackers commit. |

### 14.3 Strategy Implementation

Each strategy is a data structure mapping (role × map) → assigned region, aggression modifier, retreat threshold modifier, and engagement priority.

```typescript
type Strategy = {
  name: string;
  side: 'attacker' | 'defender';
  assignments: Record<Role, { region: string; holdFacing?: HexDir }>;
  aggressionMod: number;
  retreatThresholdMod: number;
};
```

Hand-author 6 strategies × 2 maps = 12 strategy definitions for v0.

---

## 15. Cards

### 15.1 Deck Construction

- Each unit contributes **3 cards** to the team deck: 1 trait card (from their behavioral trait), 1 role card (from their role), 1 hero card (from their hero).
- 3 units × 3 cards = **9-card deck**.
- Both teams have decks built the same way (player's team and AI opponent).

### 15.2 Draw, Play, Shuffle

- **Starting hand:** 3 cards drawn at match start.
- **Per round:** play up to 1 card, draw 1 card. Hand cap: 3.
- **Used cards** shuffle back into the deck after being played (deck never empties).
- Cards persist across halftime and sudden death.

### 15.3 Card Types

| Type | Description | Implementation Cost |
|------|-------------|---------------------|
| **Directive** | Overrides a unit's default behavior for the round | Low — modifies the AI Layer 3 input |
| **Buff** | Applies a temporary stat modifier | Low — adds to modifiers list with duration |
| **Utility** | Creates a world effect (zones, forced visibility, etc.) | Medium — requires new game-state systems |

### 15.4 Full Card Pool (13 unique cards)

**Behavioral trait cards (6):**

| Card | From | Type | Effect |
|------|------|------|--------|
| Anchor Position | Sentinel | Directive | Unit holds spawn-side position all round; doubles trait bonus (+50pp HR / +40pp HS stationary) |
| Reckless Push | Run-n-Gun | Directive | Unit ignores retreat all round; +1 movement speed; +15pp HR moving |
| Slow Flank | Lurker | Directive | Unit takes longest perimeter route to assigned region; +20pp HR adjacent to walls; arrives ~5 ticks later than default but unspotted longer |
| Opening Pick | Entry | Buff | +30pp HR / +15pp HS on first 3 ticks of first engagement; no post-engagement penalty this round |
| Crossfire | Trader | Buff | If any ally fires this round, this unit gets +25pp HR for 5 ticks after; stackable once |
| Last Stand | Clutch | Buff | If this unit becomes last alive: +30pp HR / +20pp HS AND skip next ghost-marker (vanish from enemy intel for 5 ticks) |

**Role cards (4):**

| Card | From | Type | Effect |
|------|------|------|--------|
| Spearhead | Vanguard | Directive | Vanguard takes point on chosen strategy's path; +15pp HR on first engagement; allies follow 2 ticks behind |
| Setup Play | Tactician | Directive | Tactician moves to a chosen hex first; one named ally gets +20pp HR for 5 ticks if engaging from a flank angle (>60° off enemy facing) |
| Hold the Line | Warden | Directive | Warden holds a chosen hex; +20pp HR stationary; allies reaching Warden's position get a 3-tick safe window (no incoming hits land) |
| Adapt | Specialist | Buff | Specialist gains the bonus of any other role's card for the round (player picks; must be a role currently on the team) |

**Hero cards (3):**

| Card | From | Type | Effect |
|------|------|------|--------|
| Guardian Aura | Angelic | Buff | All allies within 5 hexes of this unit get +1 max HP for this round; aura moves with the unit |
| Tactical Scan | Techy | Utility | Reveals all enemy positions for 5 ticks at round start (overrides fog of war) |
| Mark Target | Cursed | Buff | Choose 1 enemy unit; all allied attacks against that unit get +20pp HR / +10pp HS for the round |

### 15.5 Card Targeting

- Cards needing a target (Setup Play, Hold the Line, Adapt, Mark Target) enter a "targeting mode" when played. Player clicks the target hex/unit. Esc cancels.
- Untargeted cards apply immediately on click.

### 15.6 AI Opponent Cards

For v0, the AI plays cards with simple heuristics:

- 70% of rounds, play 1 card; 30% skip.
- Card selection: weighted random from the cards in hand that match the AI's chosen strategy theme (e.g., Rush strategy favors Spearhead, Opening Pick, Reckless Push).
- For targeted cards, AI picks heuristically: Mark Target → enemy with highest current HP; Setup Play → strategy's primary attack region; Hold the Line → strategy's anchor region.

More sophisticated card AI is v1.

---

## 16. AI Opponent (Strategy Selection)

For v0, the AI opponent's per-round strategy and card play uses heuristics:

- **Strategy selection:** weighted random from the 3 options for the AI's side. Weights bias toward strategies that historically won for the AI this match (simple win-rate tracking per strategy).
- **Trait/Role/Hero/Loadout assignment:** AI's units assigned randomly at match start, same pool as player.
- **Card AI:** see 15.6.

This is intentionally not a sophisticated AI for v0. The point of v0 is to validate the simulator, not test against a clever opponent. Smarter AI is a v1+ goal.

---

## 17. Round & Match Structure

- **6 rounds:** 3 attack + 3 defense, side determined by player choice at match start.
- **Half transition:** at round 3 → 4, sides swap. Same units, same roles, same loadouts, same traits, same heroes. Cards persist.
- **First to 4 wins** the match.
- **Sudden death** if 3–3 after 6 rounds: replay full economy, player must win one attack AND one defense round consecutively. If they lose either, AI gets a chance. Continues until one team chains 1-attack + 1-defense.
- **Timeout:** 1 per side, available at match point (own score = 3 AND opponent < 4). On use: replan strategy for next round, card hand carries.
- **Halftime team talk:** placeholder UI screen between rounds 3 and 4. No mechanical effect in v0.

---

## 18. UI Requirements

### 18.1 Match Screen Layout

- **Top bar:** round score (Player vs AI), round number, current half (Atk/Def label), timeout indicator.
- **Center:** hex map with units, fog of war during resolution.
- **Side panel:** hovered/selected unit's details (HP, role, hero, traits, loadout, active modifiers).
- **Bottom controls:** Play/Pause, 1x / 2x / 4x speed, Replay last round.
- **Kill feed:** persistent log at side or bottom.

### 18.2 Planning Phase UI

Shown between rounds. Player sees:

- Current score, round number, half indicator.
- Both teams' rosters with: name (or ID for v0), role, hero, traits, loadout, current HP (in case of sudden death).
- **Off-position warnings** for any unit assigned a non-preferred role.
- Player's hand of cards with source labels ("From: Sentinel trait, Unit D2").
- **Strategy menu:** 3 options for current side, each with name + one-line description.
- **Card source legend** showing which units contributed which cards.
- **Begin Round button:** disabled until strategy is picked. Card play is optional.

### 18.3 Resolution Phase UI

- Fog of war active.
- Units render only when visible to player's team.
- Ghost markers for recently-seen enemies (5-tick fade).
- Shot events: brief line flash from shooter to target.
- Damage popups: "−1" or "−2 HS" floating above hit unit.
- Death: unit greys out and remains as marker.
- Active card effects display (e.g., aura radius for Guardian Aura, Mark Target indicator on marked enemy).

### 18.4 Kill Feed

Persistent log. Format:

```
T:12 — D1 (Rifle) → A2 [body, 1 dmg]
T:14 — D1 (Rifle) → A2 [HEAD, 2 dmg] KILL
T:18 — A3 (Sniper) → D2 [body, 2 dmg] @ long
T:23 — D3 (Shotgun) → A1 [body, 1 dmg] @ short, cover penalty
T:25 — [CARD] Player plays Mark Target on A1
T:27 — D3 (Shotgun) → A1 [HEAD, 2 dmg] KILL  (Mark Target +HS)
```

Cards played logged inline so player can read the round narrative.

### 18.5 Replay

- After each round, Replay button re-runs the same round at chosen speed.
- Deterministic: uses recorded random seed, strategies, cards, and AI decisions.
- Useful for player learning and for debugging.

---

## 19. Validation Criteria for v0

v0 is successful if 5 of these 7 are observably true after 10+ test matches:

1. **Trait differentiation:** two different trait combinations on the same unit (same role, same hero, same loadout) produce visibly different play patterns.
2. **Role differentiation:** Vanguards visibly play differently from Wardens in the same strategy.
3. **Map character:** Foundry and Atoll produce different optimal team compositions and play styles. Snipers thrive on Atoll's B Main long lane more than on Foundry. Tight-corridor traits (Lurker, Entry, Run-n-Gun) shine more on Foundry's B squeeze.
4. **Defender favor:** in neutral matchups across 20+ rounds, defenders win 55–65% of rounds.
5. **Card meaningfulness:** when a card is played, the player can identify its effect in the kill feed or replay, and it visibly changes round outcomes in ≥50% of cases.
6. **Match length:** a full match runs 5–15 minutes of real time at 1x playback.
7. **Causal legibility:** after watching a round, the player can articulate why the team won or lost using the kill feed and replay.

If these hit, the design is validated and the v1 management layer (rosters, training, sponsors, spike-plant, 5v5) can be built on top. If they don't, identify failing criteria and tune before expanding scope.

---

## 20. Out of Scope for v0

Do NOT build:

- 5v5 (v0 is 3v3)
- Spike-plant mechanic (sites and plant zones are metadata only)
- Hero abilities beyond their card (no passive abilities, no ultimates)
- Utility cards beyond what's in the v0 card pool (no flashbangs, smokes, stuns)
- Morale system (placeholder UI only)
- Loadout cards
- Economy / in-round purchasing (no pistol rounds, no save rounds)
- Roster management, signing, training, scouting
- Tournaments, seasons, leagues
- Sponsors, drama, storylines
- 3D rendering, audio
- Mobile / touch controls (keyboard + mouse)
- Save / load
- Multiplayer
- Advanced AI opponent (use simple heuristics)
- Map editor (maps are code-defined)

---

## 21. Engineering Notes

- **Determinism.** Seeded PRNG for all rolls. Same inputs → same outputs. Enables replays and deterministic tests.
- **Config-driven tuning.** Every number in a single `src/game/config.ts`. Expect heavy iteration.
- **Tick simulation pipeline (each tick):**
  1. AI decisions per alive unit (target hex, engage decision)
  2. Movement applied
  3. Vision recomputed per alive unit
  4. Engagement transitions evaluated
  5. Engaged units fire (hit + headshot rolls per nested-roll spec)
  6. Damage applied
  7. State transitions (deaths, retreats, behavior changes)
  8. Buff/debuff durations tick down
  9. Round-end check
- **Event log.** Every decision and state change recorded. Used for kill feed, replay, debugging.
- **Architecture rules:**
  - `src/game/` — pure logic, no DOM/canvas imports. Includes: vision.ts, combat.ts, unit-ai.ts, strategy.ts, cards.ts, modifiers.ts, tick.ts, rng.ts.
  - `src/render/` — canvas rendering.
  - `src/ui/` — HTML overlays, controls, menus.
  - `src/maps/` — map data modules.
  - `src/config.ts` — all tunable values.

---

## 22. Build Plan: 9 Passes

Do not attempt to build all of this in one prompt. Build in 9 incremental passes, validating after each. Order matters: vision logic (Pass 3) is the riskiest piece; AI (Pass 4–6) is the largest; cards (Pass 8) is the most novel.

### Pass 1 — Map Rendering & Static Units (REDO)

**Goal:** render the 30×40 hex grid, load Foundry and Atoll from their definitions, place 3 attackers + 3 defenders at spawn hexes.

**Note:** Foundry and Atoll grids are prototyped in `hex_maps_foundry_atoll.html` in the repo. Extract the `foundry()` and `atoll()` cell-generation functions into `src/maps/foundry.ts` and `src/maps/atoll.ts` as `MapDefinition` exports.

**Deliverables:**
- Hex grid renderer (30×40, axial coords)
- Map loader from `MapDefinition`
- Both maps defined and toggleable
- Units rendered with weapon icons at spawn hexes (loadouts pre-assigned 2 rifles + 1 sniper per team for now)
- UI shell: side panel, top score bar, bottom playback control placeholders

**Validation:** both maps render with all cell types visually distinct. Spawns and sites visible. Hover shows unit details.

### Pass 2 — Tick Loop, Movement Foundation, Playback (REDO from Pass 2 v1; salvage where possible)

**Goal:** tick-based game loop with deterministic stepping; units can be programmatically moved between hexes; playback controls work.

**Deliverables:**
- Tick loop in `src/game/tick.ts` (pure)
- Loop scheduler in `src/game/loop.ts` (timer-aware)
- Movement system: 1 hex per tick base, 0.5 sniper, +0.5 Run-n-Gun
- Playback controls: Play/Pause, 1x/2x/4x
- Phase model: `'planning' | 'resolution'` (no UI for planning yet, just a "Begin" button stub)
- Hex pathfinding (A*) for moving toward a target hex
- Seeded PRNG in `src/game/rng.ts`

**Validation:** programmatically command a unit to walk to a target hex; it pathfinds and arrives correctly. Sniper visibly slower. Playback speed scales correctly.

### Pass 3 — Vision Cones & Fog of War (REDO; salvage vision logic from prior attempt if good)

**Goal:** directional vision with wall occlusion and team-shared fog.

**Deliverables:**
- 90° vision cone per unit, infinite range, blocked by full walls only
- Sniper 45° stationary, 90° moving
- Eagle Eye trait support (+30° cone)
- Supercover hex-line tracing for occlusion
- Team-shared visibility
- Ghost markers for 5 ticks after losing sight
- Cone snap-to-track behavior (closest visible enemy)
- Debug mode (toggle V): renders cones, visible hexes, trace lines

**Validation:** units behind walls hidden; revealed when LoS established. Half-walls do NOT block vision. Ghost markers persist for 5 ticks. Sniper cone visibly narrows when stationary.

### Pass 4 — Per-Unit AI Primitives

**Goal:** units autonomously move, engage on sight, retreat at low HP, hold positions — without any role/trait/card complexity yet.

**Deliverables:**
- `src/game/unit-ai.ts` with primitives: `moveToward`, `shouldEngage`, `shouldRetreat`, `pickFiringTarget`, `holdPosition`
- Each unit has an "assigned region" — moves there, then holds
- On enemy sight, transitions to engaged state, stops path, fires per fire rate
- At 1 HP, retreats to nearest wall (default behavior; trait overrides come in Pass 6)
- Resume path 3 ticks after losing all sight of enemies

**Validation:** drop two units of opposing teams on opposite sides of a map with a region target each. They move, encounter, engage, one dies. Behavior reads as intentional.

### Pass 5 — Combat Resolution & Buff Infrastructure

**Goal:** full hit/damage pipeline + the buff/debuff system that cards (Pass 8) will plug into.

**Deliverables:**
- Hit roll → headshot roll → damage application per nested-roll spec
- Loadout-and-range hit % table
- 30% headshot base, 40% sniper long, conditional on hit
- Sniper 2/4 damage, others 1/2
- Half-wall cover −20pp
- Per-unit Modifiers struct with active buffs list
- Effective stat computation: `base + traits + role + hero + buffs + modifiers`
- Buff duration management (tick down, clear expired)
- Kill feed populated with combat events

**Validation:** combat plays out cleanly. Snipers feel snipey. Shotguns dominate short range, miss at long. Cover noticeably extends duels. Hit/HS rolls observable in kill feed.

### Pass 6 — Traits, Roles, Heroes, Modifiers

**Goal:** all unit attributes integrated into the AI and combat pipelines.

**Deliverables:**
- 4 skill traits implemented (stat modifiers)
- 6 behavioral traits implemented (stat modifiers + behavior overrides for Sentinel, Lurker, Entry, Clutch)
- 4 roles implemented (preferred-role attribute on unit, off-position penalty applied at match start)
- 3 heroes implemented (hero card source — no in-round effect yet, just metadata)
- Modifiers: Aggression, Clutch Factor, Weapon Handling, Off-Position
- Random assignment of trait + role + hero + weapon-handling at match start
- All values configurable in config

**Validation:** same map, same loadouts, different traits → visibly different play. Vanguard units rush; Wardens hold. Off-position penalty observable.

### Pass 7 — Strategy Menu & Planning Phase UI

**Goal:** player can pick a strategy each round; AI does too. No cards yet.

**Deliverables:**
- 12 strategy definitions (3 per side per map × 2 maps × 2 sides = 12 strategy x map combos; some shared across maps OK)
- Planning phase UI: shows both rosters, scores, strategy menu, Begin Round button
- AI opponent picks strategy heuristically per section 16
- Strategy resolves to per-role region assignments per map
- Unit AI consumes strategy parameters at round start
- Halftime placeholder screen between rounds 3 and 4
- Timeout button (functional, becomes available at match point)

**Validation:** play a full match. Different strategies produce visibly different team behavior. Half transition works. Timeout works.

### Pass 8 — Card System

**Goal:** full card system: deck, hand, draw, play, effects, targeting, AI card play.

**Deliverables:**
- Card data layer in JSON/TS config (13 card definitions)
- Deck/hand/discard state per team, with shuffle-back-in mechanic
- Draw 3 starting hand; play up to 1 per round; draw 1; hand cap 3
- Effect handler registry, 13 unique handlers
- Card targeting mode UI (click hex/unit, Esc cancels)
- Card play logged in kill feed
- AI opponent card heuristics per section 15.6
- Hand UI in planning phase with source labels
- Card effects visible in resolution phase (auras, marks, etc.)

**Validation:** every card has a visible effect when played. Playing cards measurably changes round outcomes. AI cards feel meaningful, not random-feeling.

### Pass 9 — Replay, Polish, Validation, Tuning

**Goal:** deterministic replay, kill feed polish, end-of-match screen, tuning pass against validation criteria.

**Deliverables:**
- Deterministic round replay using seeded PRNG + recorded inputs
- Kill feed polished with weapon, range, cover notes, card events, kill flags
- Damage popups in world
- Death markers
- End-of-match screen: final score, MVP (most kills), per-round summary, key card plays
- Validation pass: run 10+ matches, check each of the 7 validation criteria
- Tuning iterations on hit %, damage, trait modifiers, card effects, modifier scales

**Validation:** at least 5 of 7 validation criteria met. Project is v0-complete.

---

## 23. Appendix A: Card Pool Reference

(See section 15.4 for full details. Cards are tracked here for quick reference during deck-building debug.)

| ID | Name | Source | Type | Targeting |
|----|------|--------|------|-----------|
| C01 | Anchor Position | Sentinel | Directive | self (auto) |
| C02 | Reckless Push | Run-n-Gun | Directive | self (auto) |
| C03 | Slow Flank | Lurker | Directive | self (auto) |
| C04 | Opening Pick | Entry | Buff | self (auto) |
| C05 | Crossfire | Trader | Buff | self (auto) |
| C06 | Last Stand | Clutch | Buff | self (auto) |
| C07 | Spearhead | Vanguard | Directive | self (auto) |
| C08 | Setup Play | Tactician | Directive | ally + flank-hex |
| C09 | Hold the Line | Warden | Directive | self + hex |
| C10 | Adapt | Specialist | Buff | role pick |
| C11 | Guardian Aura | Angelic | Buff | self (auto) |
| C12 | Tactical Scan | Techy | Utility | self (auto) |
| C13 | Mark Target | Cursed | Buff | enemy unit |

---

## 24. Appendix B: Map Region Reference

For both Foundry and Atoll, the following region names MUST exist in the `regions` map of the `MapDefinition`. AI strategy assignments reference these names.

**Foundry:**
- `def_spawn`, `b_site`, `b_plant`, `b_squeeze`, `a_site`, `a_plant`, `a_connector`, `mid`, `mid_pillar`, `b_main`, `b_lobby`, `a_main`, `a_lobby`, `atk_spawn`

**Atoll:**
- `def_spawn`, `b_site`, `b_plant`, `b_dock`, `a_site`, `a_plant`, `a_maze`, `mid`, `mid_courtyard`, `b_main`, `b_lobby`, `a_main`, `a_lobby`, `atk_spawn`

Region hex membership is hand-defined in the map files based on the HTML prototype cell positions. Any hex labeled `site` in the HTML belongs to the site region; `plant` hexes belong to both site and plant zones; etc.

---

## End of Spec
