# Player Attribute System — Design Document

**Status:** Design phase. Not yet integrated into the main spec or codebase.

**Relationship to main spec:** This document is a self-contained design for the attribute and performance-stats systems. Once locked, the relevant sections will be merged into the main v0 spec, and existing sections (Modifiers, Traits, Combat) will be updated to reference attributes. Until then, the main spec describes the working pre-attributes system.

**Scope:** Full 14-attribute system documented. Only the v0 subset (5 attributes + performance stats) is implemented first.

---

## 1. Motivation

Currently, unit performance in the sim is determined by:

- A randomly-assigned skill trait (Sharp Aim, Headhunter, Eagle Eye, First Shot)
- A randomly-assigned behavioral trait (Sentinel, Run-n-Gun, etc.)
- A role (Vanguard, Tactician, Warden, Specialist)
- A hero (Angelic, Techy, Cursed)
- Flat modifiers (Aggression, Clutch Factor, Weapon Handling, Off-Position)

This is the right structure for the v0 simulator but is too coarse for a real management game. Two units with the same trait/role/hero combination behave identically. Real esports managers think in terms of player attributes — Aim, Awareness, Composure, Map IQ — that distinguish players from each other even when they fit the same role profile.

Attributes add per-unit differentiation that:
- Makes scouting meaningful (every player has a unique profile)
- Makes training meaningful (improve specific attributes)
- Makes role assignment meaningful (does this player's profile fit the role?)
- Drives the in-sim behavior in a fine-grained way that aligns with how esports analysts think

This document specifies the attribute system, how it integrates with existing systems, what's implemented in v0, and what's deferred.

---

## 2. Conceptual Framework

The system distinguishes two things:

**Attributes** are *underlying ability ratings*. They drive what units do in the sim. Stable per player; in v0 they're generated fresh per match, in v1+ they persist across matches and can change through training.

**Performance Stats** are *outcome measurements*. They are computed FROM matches. They describe what a unit did, not what they're capable of. The manager evaluates whether attributes are paying off by looking at performance stats.

This mirrors how real esports works: VLR.gg/rib.gg show performance stats (ACS, K/D, KAST), but professional scouts also evaluate underlying attributes (aim consistency, decision-making under pressure, communication quality) that aren't directly visible in match stats.

Football Manager is the canonical reference for this two-layer structure.

---

## 3. Attribute Catalog

All attributes are rated **0–100**, with **50 as the average baseline**. Modifiers use the formula `(rating − 50) × multiplier`, so a rating of 50 produces no effect, higher values produce positive effects, and lower values produce negative effects.

Attributes are grouped into four categories.

### 3.1 Mechanical (combat execution)

| # | Attribute | What it controls | v0? |
|---|-----------|------------------|-----|
| M1 | **Aim** | Base hit-rate modifier across all weapons. Formula: `(aim − 50) × 0.2` percentage points added to HR. | ✅ v0 |
| M2 | **Headshot** | Base headshot-chance modifier. Formula: `(headshot − 50) × 0.15` pp added to HS chance, conditional on hit. | v1 |
| M3 | **Reflexes** | Magnitude of the First-Shot trait bonus when present. Without First Shot trait, contributes a smaller flat bonus on the first shot of an engagement: `(reflexes − 50) × 0.1` pp. Also affects how quickly a unit's cone snaps to a newly-spotted enemy (high reflexes = 1 tick, low = 2 ticks). | v1 |
| M4 | **Spray Control** | Sustained-fire HR retention. Past tick 5 of a continuous engagement, HR decays unless mitigated by Spray Control. v0 doesn't model sustained engagements; this is a placeholder for v1's expanded combat model. | v1+ |
| M5 | **Rifle Handling** | Per-weapon HR modifier when using a rifle. Formula: `(handling − 50) × 0.1` pp added to HR. | ✅ v0 |
| M6 | **Shotgun Handling** | Same formula, applies only when using shotgun. | ✅ v0 |
| M7 | **Sniper Handling** | Same formula, applies only when using sniper. | ✅ v0 |

**Note on weapon handling:** the main spec's existing "Weapon Handling" modifier is replaced by these three sub-ratings. A unit with high rifle handling and low sniper handling will perform differently depending on their loadout.

### 3.2 Game Sense (decision-making and map understanding)

| # | Attribute | What it controls | v0? |
|---|-----------|------------------|-----|
| G1 | **Awareness** | Vision cone modifier (`(awareness − 50) × 0.4` degrees added to cone width, capped to ±20°). Also: ghost-marker persistence is extended by 1 tick if awareness > 70, reduced by 1 tick if < 30. | ✅ v0 |
| G2 | **Positioning** | Quality of held positions when the AI selects where to anchor. A unit with high Positioning preferentially picks hexes that are: adjacent to walls (better cover), have wider vision arcs toward likely threats, are less exposed to multiple enemy angles. Low Positioning picks more random or exposed hexes. | v1 |
| G3 | **Map IQ (Foundry)** | Per-map familiarity. Reduces the off-position penalty on this map. Formula: off-position penalty becomes `−10pp × (1 − (mapIQ − 50) / 100)`, so high Map IQ on this map nearly negates off-position; low Map IQ amplifies it. | v1 |
| G4 | **Map IQ (Atoll)** | Same, for Atoll. | v1 |

### 3.3 Mental (under pressure)

| # | Attribute | What it controls | v0? |
|---|-----------|------------------|-----|
| N1 | **Clutch** | Magnitude of the Clutch behavioral trait bonus when present. Without the trait, contributes a smaller default bonus when unit is last alive: `(clutch − 50) × 0.15` pp HR. | ✅ v0 |
| N2 | **Composure** | Penalty mitigation. After dying in the previous round, a unit takes a flat −5pp HR for the first 3 ticks of the next round; high Composure reduces this, low Composure amplifies it. Formula: `effective penalty = −5pp × (1 − (composure − 50) / 100)`. | v1 |
| N3 | **Confidence** | Aggression baseline modifier. The Aggression modifier from strategy/role is scaled by Confidence: `effective aggression = role_aggression × (1 + (confidence − 50) / 100)`. High confidence = pushes harder; low confidence = holds more. | v1 |

### 3.4 Team (synergy and role play)

| # | Attribute | What it controls | v0? |
|---|-----------|------------------|-----|
| T1 | **Teamwork** | Trader-trait bonus magnitude when present, plus a small default Trader-like bonus when adjacent to an ally and an ally has fired recently. Formula: `(teamwork − 50) × 0.1` pp HR when ally has fired in last 3 ticks. | v1 |
| T2 | **Discipline** | Likelihood of following assigned strategy region vs deviating. Low Discipline = unit may peel off path to engage opportunistic targets or take "interesting" routes; high Discipline = sticks to assignment rigidly. Affects path adherence in `unit-ai.ts`. | v1 |
| T3 | **Communication** | Adjacent-ally vision sharing bonus. By default, allies share vision team-wide. With Communication, allies within 5 hexes of this unit get a +20° cone bonus, modulated by communication rating: `bonus = 20° × ((communication − 50) / 50)`. | v1 |

### 3.5 Attribute summary

14 attributes total. In v0, the following 5 are implemented:

- **Aim** (M1)
- **Rifle Handling** (M5)
- **Shotgun Handling** (M6)
- **Sniper Handling** (M7)
- **Awareness** (G1)
- **Clutch** (N1)

(That's 6 not 5 — the original "5 attributes + performance stats" plan counted Weapon Handling as one item; splitting into three sub-ratings is closer to the design intent and trivial to implement together.)

---

## 4. Generation

### 4.1 v0: Fresh per match

At match start, each unit's attributes are randomly generated:

- Default distribution: uniform in **[30, 70]** for testing predictability.
- For variety in testing, optionally use a **truncated normal distribution** centered at 50 with standard deviation 12, clamped to [10, 90]. This produces occasional outliers (a 75-Aim sniper, a 28-Awareness rookie) which is more interesting than uniform.
- All 14 attributes are generated even though only 6 are used by the sim in v0. The unused ones are displayed in the unit panel as "v1 preview" — gives the player a sense of the full system that's coming.

### 4.2 v1: Persistent rosters

Attributes become permanent player attributes. Training and aging change them over time. Scouting reveals partial information (e.g., "Aim: 65–75 estimated"). This is out of scope for the attribute design doc — handled in the v1 roster design doc.

### 4.3 Role-attribute affinities (for v1 generation; informational in v0)

Each role has a preferred attribute profile. In v1, generated players will be biased toward their role's profile. In v0, this is informational only — used for the off-position penalty calculation and displayed in UI.

| Role | High Affinity | Medium | Low |
|------|--------------|--------|-----|
| **Vanguard** | Aim, Reflexes, Confidence | Spray Control, Composure | Discipline, Positioning |
| **Tactician** | Map IQ, Teamwork, Communication | Awareness, Discipline | Aim, Reflexes |
| **Warden** | Positioning, Awareness, Composure | Aim, Discipline | Reflexes, Confidence |
| **Specialist** | balanced (no extreme highs or lows) | all moderate | (none specifically) |

A unit's "role fit" = average of their high-affinity attributes for that role. Used in v1 for the off-position penalty calculation: high fit reduces penalty, low fit increases it. In v0, off-position penalty stays flat at −10pp (existing spec behavior).

---

## 5. Performance Statistics

After (and during) a match, the sim records performance stats per unit. Computed from the event log; no separate state needed.

### 5.1 v0 Implementation

| Stat | Definition | Computed From |
|------|------------|---------------|
| **ACS** | Average Combat Score. Composite of kills, assists, multi-kills, damage. Formula in 5.2 below. | Kill events, damage events |
| **K/D/A** | Kills, Deaths, Assists. Per match. | Kill events, with assist credit per 5.3 |
| **KAST%** | Percentage of rounds in which the unit had a Kill, Assist, Survival, or Trade. | Round-by-round event aggregation |
| **ADR** | Average Damage per Round. Total damage dealt / rounds played. | Damage events |
| **HS%** | Headshot percentage. Headshot kills / total kills. | Kill events with headshot flag |

### 5.2 ACS Formula (mirroring VLR.gg's published formula)

VLR's published ACS formula:

```
ACS = round_total / rounds_played

where round_total per round =
    (kills × 200)
  + (assists × 50)
  + (multikill_bonus)
  + (damage × 1)
  + (planted_or_defused_bonus, v1 only)

multikill_bonus:
  2K = 0
  3K = 100
  4K = 400
  5K (ace) = 1000
```

In v0, no plant/defuse bonus (no spike mechanic yet). For 3v3, multikill thresholds are scaled down: 2K = 0, 3K = 400 (since 3 kills out of 3 enemies = ace in 3v3). Adjust during Pass A5 tuning.

### 5.3 Assist Crediting Rules

An assist is credited to a unit if:
- That unit damaged the enemy within the last 5 ticks before the enemy's death, AND
- That unit did not deal the killing blow.

Maximum 2 assists per kill (the 2 most recent damagers).

### 5.4 KAST% Definition

For each round, a unit's KAST flag is set if any of:
- **K** = Got at least 1 kill in the round
- **A** = Got at least 1 assist in the round
- **S** = Survived to round end (alive when round ends)
- **T** = Got "traded" — was killed within 5 ticks of an ally killing that same enemy that killed them

KAST% = (rounds with flag set) / (rounds played) × 100.

### 5.5 Performance Stat Display

**Per-round panel** (shown on round-end screen):
- Each player's K/D/A for the round
- ACS contribution this round
- Damage dealt
- Notable events (multi-kills, clutch wins, first kills)

**Per-match panel** (shown on match-end screen):
- Full scoreboard: ACS, K, D, A, KAST%, ADR, HS%
- Sorted by ACS descending
- MVP indicator (highest ACS on winning team)
- Per-round line graph of ACS contribution

**Unit hover panel during planning phase** (existing UI):
- Add an "Attributes" section showing all 14 attributes with bars
- Add a "Performance" section showing cumulative match stats so far

### 5.6 Stats Deferred to v1

These are mentioned for completeness; not in v0:

- **First Kills / First Deaths** — requires identifying "first contact" per round. Easy to add but not in v0 subset.
- **Clutch win rate** — requires labeling 1vX scenarios in the event log.
- **Per-agent (hero) splits** — needs aggregation across matches.
- **Per-map splits** — needs aggregation across matches.
- **Per-side splits** — round-level aggregation.
- **Multi-kill counts** — easy to add; not in v0 subset for simplicity.
- **Aim duel win %** — requires tagging "duel" events in the event log.
- **Plant/defuse impact** — requires spike-plant mechanic.

---

## 6. Integration With Existing Systems

This is the section where attribute design meets the working v0 code. Each existing system needs explicit changes.

### 6.1 Combat (section 7 of main spec)

**Current hit roll:**
```
hr = base_weapon_range_hr
   + skill_trait_bonus
   + behavioral_trait_bonus
   + modifiers (aggression, clutch, off-position, weapon-handling)
   + card_buffs
   + cover_penalty
```

**New hit roll (v0):**
```
hr = base_weapon_range_hr
   + (aim − 50) × 0.2                    ← NEW
   + (weapon_handling_for_loadout − 50) × 0.1   ← REPLACES flat weapon handling modifier
   + skill_trait_bonus
   + behavioral_trait_bonus
   + modifiers (aggression, clutch_attribute-derived, off-position)
   + card_buffs
   + cover_penalty
```

**New headshot roll (v0):**
- Headshot chance unchanged in v0 (Headshot attribute is v1).
- Default 30% / 40% sniper-long behavior preserved.

**Clutch modifier change:**
- Currently a flat number. Now: when unit is last alive AND has Clutch trait, bonus is `trait_bonus + (clutch_attribute − 50) × 0.15` pp HR. When unit is last alive WITHOUT Clutch trait, bonus is `(clutch_attribute − 50) × 0.15` pp HR only (smaller without the trait).

### 6.2 Vision (section 6 of main spec)

**Current vision cone:**
```
cone_width = 90° (or 45° sniper stationary)
            + (Eagle Eye trait: +30°)
```

**New vision cone (v0):**
```
cone_width = 90° (or 45° sniper stationary)
           + (Eagle Eye trait: +30°)
           + (awareness − 50) × 0.4°    ← NEW, capped to ±20°
```

**Ghost markers:**
- Default 5 ticks. With Awareness > 70: 6 ticks. With Awareness < 30: 4 ticks. Otherwise 5.

### 6.3 Modifiers (section 13 of main spec)

The existing flat modifiers either get replaced or modulated:

| Existing Modifier | New Behavior |
|-------------------|--------------|
| Aggression | Unchanged in v0 (Confidence attribute that would modulate it is v1) |
| Clutch Factor | Replaced by Clutch attribute as in 6.1 |
| Weapon Handling | Replaced by 3 sub-attributes (Rifle/Shotgun/Sniper Handling) |
| Off-Position Penalty | Unchanged in v0 (Map IQ that would modulate it is v1) |

### 6.4 Unit Data Structure

The existing `Unit` type gains an `attributes: Attributes` field:

```typescript
type Attributes = {
  // Mechanical
  aim: number;              // v0
  headshot: number;         // v1 (generated but unused)
  reflexes: number;         // v1
  sprayControl: number;     // v1
  rifleHandling: number;    // v0
  shotgunHandling: number;  // v0
  sniperHandling: number;   // v0

  // Game Sense
  awareness: number;        // v0
  positioning: number;      // v1
  mapIQ: {                  // v1
    foundry: number;
    atoll: number;
  };

  // Mental
  clutch: number;           // v0
  composure: number;        // v1
  confidence: number;       // v1

  // Team
  teamwork: number;         // v1
  discipline: number;       // v1
  communication: number;    // v1
};
```

All 14 are generated even though only 6 are used in v0 sim math. Unused attributes are stored, displayed, and ready for v1 activation.

### 6.5 Event Log

The existing event log already tracks shots, hits, damage, kills. To support performance stats:

- Add `damageDealtBy` and `damageDealtTo` tracking per unit per round (likely already there).
- Add `roundIndex` to each event (for KAST aggregation).
- Add `wasFirstContact` flag on engagement-start events (for v1 First Kills/Deaths stats; not used in v0).
- Add `traded` tracking: when a kill happens, check if the killer was killed within 5 ticks afterward by an ally of the original victim. Tag both the original victim and the eventual killer.

### 6.6 UI Changes

- **Unit panel:** new Attributes section with 14 bars. v0-active attributes highlighted; v1 attributes greyed but visible.
- **Round-end screen:** add per-round stats table (K/D/A, ACS contribution, damage).
- **Match-end screen:** new screen showing full scoreboard sorted by ACS, MVP marker, per-round ACS graph per player.
- **Planning-phase unit hover:** existing details + cumulative match-so-far stats.

### 6.7 Config

New section in `src/game/config.ts`:

```typescript
ATTRIBUTES = {
  generation: {
    distribution: 'normal',  // 'uniform' | 'normal'
    mean: 50,
    stdDev: 12,
    min: 10,
    max: 90,
  },
  formulas: {
    aim: { multiplier: 0.2 },                    // pp per (rating−50)
    weaponHandling: { multiplier: 0.1 },
    awareness: { coneMultiplier: 0.4, coneCap: 20 },  // degrees
    clutch: { withTraitMultiplier: 0.15, withoutTraitMultiplier: 0.15 },
  },
  performanceStats: {
    acs: {
      killValue: 200,
      assistValue: 50,
      multikill3K: 400,  // adjusted for 3v3
      damageMultiplier: 1,
    },
    assistWindowTicks: 5,
    tradeWindowTicks: 5,
  },
}
```

All numbers tunable, expected to iterate during Pass A6.

---

## 7. Build Plan: 6 Passes

Sequence for implementing the v0 attribute subset and performance stats. Each pass is one Claude Code session, one commit, one validation. Do not skip passes.

### Pass A1 — Data structure, generation, UI display

**Goal:** attributes exist as data on units, are visible in UI, but do NOT affect sim math yet.

**Deliverables:**
- `Attributes` type in `src/game/types.ts` (or wherever types live)
- Attribute generation in `src/game/attributes.ts` (random per match, configurable distribution)
- All units have `unit.attributes` populated at match start
- Unit panel shows all 14 attributes as bars; v0-active ones labeled, v1 ones greyed with "v1" label
- Config section added

**Validation:**
- Generate a match. Hover each unit. All 14 attributes visible with reasonable values (30–70 default).
- No combat behavior change — match plays out exactly as before. This is the critical check; if anything in the sim has changed, something was wired up incorrectly.

### Pass A2 — Aim integration

**Goal:** integrate Aim into combat math. Existing tuning preserved.

**Deliverables:**
- `effectiveHitRate()` in combat reads `aim` attribute and applies `(aim − 50) × 0.2` pp
- The existing flat Aim source (if any) is removed or noted as redundant
- Validate that with `aim = 50` for all units, combat behaves IDENTICALLY to pre-attribute behavior

**Validation:**
- Run 5 matches with all `aim = 50` forced. Outcome distributions should match pre-A2 baseline (within randomness).
- Run 5 matches with normal generation. Verify that high-Aim units (75+) noticeably outperform low-Aim units (25–) in K/D.

### Pass A3 — Weapon Handling sub-ratings

**Goal:** replace flat Weapon Handling modifier with three per-weapon sub-ratings.

**Deliverables:**
- `rifleHandling`, `shotgunHandling`, `sniperHandling` integrated
- `effectiveHitRate()` reads the sub-rating matching the unit's current loadout
- The existing flat Weapon Handling modifier is removed

**Validation:**
- Force a unit's rifle handling to 80 and shotgun handling to 20. Equip them with rifle → strong performance. Re-equip with shotgun → noticeably weaker. Confirms per-weapon differentiation works.

### Pass A4 — Awareness and Clutch

**Goal:** integrate Awareness (vision cone modifier + ghost-marker adjustment) and Clutch (last-alive bonus magnitude).

**Deliverables:**
- Vision cone width reads Awareness, formula applied with cap
- Ghost marker persistence adjusted for very high / very low Awareness
- Clutch attribute integrated into both trait-bonus magnitude and default-without-trait bonus

**Validation:**
- Toggle debug vision mode. A high-Awareness unit (85) visibly has a wider cone than a low-Awareness one (15).
- Force a 1v3 situation. High-Clutch unit performs noticeably better than low-Clutch with same other stats.

### Pass A5 — Performance stats infrastructure

**Goal:** compute and display ACS, K/D/A, KAST%, ADR, HS% per unit per match.

**Deliverables:**
- Event log additions (round index, trade tracking)
- Stat computation module: `src/game/stats.ts` (pure functions)
- Per-round panel: K/D/A, ACS contribution, damage, notable events
- Per-match panel: full scoreboard, MVP marker, ACS line graph
- Unit hover: cumulative match-so-far stats

**Validation:**
- Play a full 6-round match. Match-end screen shows scoreboard with sensible values.
- Verify KAST% calculation against hand-traced expected values for at least 2 units.
- Verify ACS formula matches VLR's published formula on a sample round.

### Pass A6 — Tuning pass

**Goal:** play matches, observe whether the attribute system produces meaningful differentiation, tune.

**Deliverables:**
- Run 10+ matches with attribute logging enabled
- Verify that units with extreme attributes (90 vs 10 in the same stat) produce visibly different outcomes
- Adjust formula multipliers in config if effects are too weak or too strong
- Validate against attribute-relevant criteria: do high-Aim units actually have higher K/D averages? Do high-Awareness units die less often?

**Validation:**
- Statistical sanity: across 10 matches, average ACS correlates with average Aim attribute (high-Aim units have meaningfully higher ACS).
- Subjective: watching matches, can you "feel" the difference between high-attribute and low-attribute units? If not, formulas may need stronger multipliers.

---

## 8. Open Design Questions

These are decisions deferred to implementation or v1. Listed here so they don't get lost.

1. **Attribute distribution shape for v0.** Recommended: truncated normal centered at 50, sd 12. Could also use uniform [30, 70] for predictability. Decision can wait until Pass A1 generation code is written; both are 1-line changes.

2. **Attribute visibility in UI for v1 attributes.** Showing all 14 in v0 with v1 ones greyed gives a preview but might be cluttered. Alternative: show only v0-active 6 in v0, add the rest in v1. I lean toward showing all to telegraph the depth of the system to early playtesters.

3. **MVP definition for the match-end screen.** Currently: highest ACS on winning team. Could also be: highest ACS overall, or "most impactful" by some other metric. ACS-on-winning-team matches VLR convention; staying there for credibility.

4. **Tuning targets for Pass A6.** What's the desired magnitude of attribute effect? Suggested: a unit with Aim 90 should outperform a unit with Aim 10 by approximately +8pp HR (which is `(90 − 50) × 0.2` − `(10 − 50) × 0.2`). If this feels too small or too large in playtest, adjust the multiplier.

5. **v1 prep: training mechanics.** Out of scope for this doc but flagged: attribute increases from training will need rules (e.g., max +1 per training cycle, decreasing returns at high ratings, age-based decline). Don't design here; document the question for the v1 roster design doc.

---

## 9. Migration Notes

For your reference when prompting Claude Code through the build passes:

- **No existing code should break.** Pass A1 introduces attributes as inert data. Subsequent passes replace flat-number sources with attribute-derived sources one at a time. After each pass, the existing test matches should still produce reasonable outcomes.
- **The flat "Weapon Handling" modifier in the main spec (section 13.1) is the only existing modifier that gets fully replaced.** Aggression, Clutch Factor, and Off-Position Penalty stay flat in v0 — their attribute-driven versions (Confidence, full Clutch integration, Map IQ) are v1.
- **The Sharp Aim trait still exists and stacks with Aim attribute.** A unit with Sharp Aim AND high Aim attribute is a sharpshooter. This is intentional — traits are categorical bonuses, attributes are continuous ratings, and stacking them is fine.
- **The Eagle Eye trait still exists and stacks with Awareness attribute.** Same rationale.

---

## 10. After v0: v1 Activation

When v1 work begins, activate the remaining 9 attributes in roughly this order:

1. **Headshot, Reflexes** — straightforward combat additions.
2. **Confidence, Composure** — round-level mental modifiers; needs morale system or works standalone.
3. **Discipline** — modifies AI path adherence; needs care to not break existing strategy behavior.
4. **Positioning** — requires AI hold-position selection to evaluate hex quality; meaningful refactor of `holdPosition()`.
5. **Teamwork, Communication** — team-synergy effects; nice-to-have, layer in after the rest works.
6. **Map IQ** — per-map; tied to off-position penalty modulation.
7. **Spray Control** — only relevant if v1's combat model adds sustained engagements.

Each is its own pass. Treat this list as the v1 attribute work order, not a single pass.

---

## End of Design Document
