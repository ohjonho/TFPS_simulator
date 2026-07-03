// Arc runtime (Phase 3, 3c) — PURE. Given a SeasonState + the current slot, it
// finds which arc beats are ready, resolves a chosen beat's effects (incl. a
// deterministic weighted roll), and advances/holds/neglects the arc. All rolls run
// on the SEASON rng stream (never the match RNG); tag grants flow into the roster's
// storyTags → the match build (via the Phase-1 hooks) deterministically. No UI here
// — the collision-choice screen + week-loop wiring + MatchSummary capture are 3d/3e.

import type { SeasonState } from '../season.ts';
import type { Unit } from '../types.ts';
import type { Arc, ArcBeat, ArcChoice, ArcRuntime, RollOutcome, RollSpec } from './arcTypes.ts';
import type { Effect } from '../events/types.ts';
import { ARCS } from './arcs.ts';
import { characterById } from './characters.ts';
import { applyEffects } from '../events/runtime.ts';
import { createRng } from '../rng.ts';
import { aggregateVisible } from '../attributes.ts';

const SLOTS_PER_WEEK = 2; // pre + post

// Monotonic global slot index for minGapSlots ("skip a day"): pre even, post odd.
function slotNumber(idx: number, slot: 'pre-match' | 'post-match'): number {
  return idx * SLOTS_PER_WEEK + (slot === 'post-match' ? 1 : 0);
}

// What the just-played match produced, for post-match `onMatchEvent` triggers.
// Computed from the event log by the week loop (3d); the runtime only consumes it.
export interface MatchSummary {
  lastAliveUnitIds: string[];   // player-team units that were last alive in ≥1 round
  negativeKdUnitIds: string[];  // player-team units ending the match on a negative K/D
}

export interface SlotContext {
  slot: 'pre-match' | 'post-match';
  idx: number;                  // matches played so far
  week: number;                 // current week (1-based)
  wins: number;                 // season wins so far
  matchSummary?: MatchSummary | null;
}

// One runtime entry per drafted unit whose authored character has a REGISTERED arc
// (Moony / imissu in Phase 3). Others are inert until their arcs land.
export function initArcs(roster: readonly Unit[]): ArcRuntime[] {
  const out: ArcRuntime[] = [];
  for (const u of roster) {
    if (!u.characterId) continue;
    const def = characterById(u.characterId);
    if (!def) continue;
    const arc = ARCS[def.arcId];
    if (!arc) continue;
    out.push({ arcId: arc.id, characterId: arc.characterId, stage: 0, heldCount: 0, status: 'unstarted' });
  }
  return out;
}

// The roster unit that is an arc's subject (matched by authored characterId).
function subjectUnitId(roster: readonly Unit[], characterId: string): string | null {
  return roster.find((u) => u.characterId === characterId)?.id ?? null;
}

const CLOSED: ReadonlySet<ArcRuntime['status']> = new Set<ArcRuntime['status']>(['resolved', 'frozen', 'neglected', 'departed']);

function beatEligible(season: SeasonState, rt: ArcRuntime, beat: ArcBeat, ctx: SlotContext): boolean {
  const t = beat.trigger;
  if (t.slot !== 'either' && t.slot !== ctx.slot) return false;
  if (t.onWeek !== undefined && ctx.week < t.onWeek) return false;
  if (t.onNthWin !== undefined && ctx.wins < t.onNthWin) return false;
  if (t.requiresFlag && !(season.storyFlags ?? {})[t.requiresFlag]) return false;
  if (t.requiresWinning && ctx.wins * 2 <= ctx.idx) return false; // wins > losses
  if (t.onMatchEvent) {
    if (ctx.slot !== 'post-match' || !ctx.matchSummary) return false;
    const uid = subjectUnitId(season.playerRoster, rt.characterId);
    if (!uid) return false;
    const list = t.onMatchEvent === 'last-alive-round' ? ctx.matchSummary.lastAliveUnitIds : ctx.matchSummary.negativeKdUnitIds;
    if (!list.includes(uid)) return false;
  }
  if (t.minGapSlots !== undefined && rt.lastAdvancedSlot !== undefined) {
    if (slotNumber(ctx.idx, ctx.slot) - rt.lastAdvancedSlot < t.minGapSlots) return false;
  }
  return true;
}

// The arc beats whose trigger fires in this slot (each = an arc + its current beat).
// The scarcity engine (3e) decides which one the player engages when ≥2 are ready.
export function readyBeats(season: SeasonState, ctx: SlotContext): { arcId: string; beat: ArcBeat }[] {
  const out: { arcId: string; beat: ArcBeat }[] = [];
  for (const rt of season.arcs ?? []) {
    if (CLOSED.has(rt.status)) continue;
    const arc = ARCS[rt.arcId];
    if (!arc || rt.stage >= arc.beats.length) continue;
    const beat = arc.beats[rt.stage];
    if (beatEligible(season, rt, beat, ctx)) out.push({ arcId: rt.arcId, beat });
  }
  return out;
}

// --- Rolls -----------------------------------------------------------------
// Weight points shifted onto outcomes[0] per point of the weighting unit's
// aggregate over 50 (e.g. a Leadership-70 mentor moves +20 toward the good outcome).
const ROLL_SHIFT_PER_PT = 1.0;

function fnv(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function aggOf(u: Unit, agg: 'leadership' | 'improvisation'): number {
  return (aggregateVisible(u.attributes) as unknown as Record<string, number>)[agg] ?? 50;
}

function weightUnit(roster: readonly Unit[], subjectCharId: string, of: 'best-teammate' | 'subject', agg: 'leadership' | 'improvisation'): Unit | null {
  const subjId = subjectUnitId(roster, subjectCharId);
  if (of === 'subject') return roster.find((u) => u.id === subjId) ?? null;
  const mates = roster.filter((u) => u.id !== subjId);
  if (mates.length === 0) return null;
  return mates.reduce((best, u) => (aggOf(u, agg) > aggOf(best, agg) ? u : best));
}

// Deterministic weighted outcome, seeded off (season.seed, arcId, beatId), shifted
// toward outcomes[0] by the chosen unit's aggregate. Reproducible on reload. Pure.
export function resolveRoll(season: SeasonState, arcId: string, beatId: string, roll: RollSpec): RollOutcome {
  if (roll.outcomes.length === 1) return roll.outcomes[0];
  const weights = roll.baseWeights.slice();
  if (roll.weightBy) {
    const u = weightUnit(season.playerRoster, ARCS[arcId].characterId, roll.weightBy.of, roll.weightBy.agg);
    const shift = u ? (aggOf(u, roll.weightBy.agg) - 50) * ROLL_SHIFT_PER_PT : 0;
    weights[0] = Math.max(1, weights[0] + shift);
    weights[weights.length - 1] = Math.max(1, weights[weights.length - 1] - shift);
  }
  const total = weights.reduce((a, b) => a + b, 0);
  const rng = createRng((season.seed ^ fnv(arcId + ':' + beatId)) >>> 0);
  let r = rng.next() * total;
  for (let i = 0; i < roll.outcomes.length; i++) {
    r -= weights[i];
    if (r < 0) return roll.outcomes[i];
  }
  return roll.outcomes[roll.outcomes.length - 1];
}

// --- Advancing / holding ---------------------------------------------------
function updateRt(arcs: readonly ArcRuntime[], arcId: string, patch: Partial<ArcRuntime>): ArcRuntime[] {
  return arcs.map((rt) => (rt.arcId === arcId ? { ...rt, ...patch } : rt));
}

// Resolve the currently-ready beat of an arc: apply its unconditional effects + the
// chosen choice's (or its roll's) effects, then advance / goto / freeze. Pure —
// returns a new SeasonState. `choiceIdx` null ⇒ a no-choice beat.
export function advanceArc(season: SeasonState, arcId: string, choiceIdx: number | null, ctx: SlotContext): { season: SeasonState; effects: Effect[]; outcomeId?: string } {
  const arc: Arc | undefined = ARCS[arcId];
  const rt = (season.arcs ?? []).find((r) => r.arcId === arcId);
  if (!arc || !rt || rt.stage >= arc.beats.length) return { season, effects: [] };
  const beat = arc.beats[rt.stage];
  const subjId = subjectUnitId(season.playerRoster, arc.characterId);

  const choice: ArcChoice | null = choiceIdx != null && beat.choices ? beat.choices[choiceIdx] : null;
  const roll = choice?.roll ?? beat.roll;
  const effects = [...(beat.effects ?? []), ...(choice?.effects ?? [])];
  let resolvedOutcome = rt.resolvedOutcome;
  if (roll) {
    const outcome = resolveRoll(season, arcId, beat.id, roll);
    effects.push(...outcome.effects);
    resolvedOutcome = outcome.id;
  }

  let next = applyEffects(season, effects, subjId);

  const freeze = choice?.freezesArc ?? false;
  let stage = rt.stage + 1;
  if (choice?.goto) {
    const gi = arc.beats.findIndex((b) => b.id === choice.goto);
    if (gi >= 0) stage = gi;
  }
  const closed = stage >= arc.beats.length;
  const status: ArcRuntime['status'] = freeze ? 'frozen' : closed ? 'resolved' : 'active';
  next = {
    ...next,
    arcs: updateRt(next.arcs, arcId, {
      stage: freeze ? rt.stage : stage,
      heldCount: 0,
      status,
      lastAdvancedSlot: slotNumber(ctx.idx, ctx.slot),
      resolvedOutcome,
    }),
  };
  return { season: next, effects, outcomeId: resolvedOutcome };
}

// Sam holds a ready beat (the player engaged a different arc this slot). After
// maxHolds (default 2) it auto-resolves down its onNeglect path (absent ⇒ the arc
// just stalls — neutral, per the neglect law). Pure.
export function holdBeat(season: SeasonState, arcId: string): SeasonState {
  const arc = ARCS[arcId];
  const rt = (season.arcs ?? []).find((r) => r.arcId === arcId);
  if (!arc || !rt || rt.stage >= arc.beats.length) return season;
  const beat = arc.beats[rt.stage];
  const held = rt.heldCount + 1;
  if (held <= (beat.maxHolds ?? 2)) {
    return { ...season, arcs: updateRt(season.arcs, arcId, { heldCount: held }) };
  }
  const subjId = subjectUnitId(season.playerRoster, arc.characterId);
  const base = beat.onNeglect ? applyEffects(season, beat.onNeglect, subjId) : season;
  return { ...base, arcs: updateRt(base.arcs, arcId, { status: 'neglected', heldCount: 0 }) };
}
