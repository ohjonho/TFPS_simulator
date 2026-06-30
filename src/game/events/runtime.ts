// Phase 4 — event runtime. Pure: pick a deterministic event for a week slot,
// resolve its subject, and apply its (or a chosen choice's) effects to the season.
// Selection is seeded off (season.seed, slotKey) so the same slot always yields
// the same event/subject — and effects are applied exactly once by the caller
// (apply → advance phase → save), so a mid-event reload re-rolls the same event
// and re-applies nothing.

import type { SeasonState } from '../season.ts';
import type { Attributes, Unit } from '../types.ts';
import type { AggKey, Effect, PersonalityId, RecordForm, SeasonEvent, Subject } from './types.ts';
import { AMBIENT_EVENTS } from './registry.ts';
import { createRng, type Rng } from '../rng.ts';
import { aggregateVisible } from '../attributes.ts';
import { adjustMorale } from '../morale.ts';

// Which hidden subs feed each visible aggregate (bumping all of them raises the
// aggregate by the same amount, since the aggregate weights sum to 1).
const AGG_SUBS: Record<AggKey, (keyof Attributes)[]> = {
  mechanics: ['aim', 'headshot', 'reflexes', 'weaponAffinity'],
  gameSense: ['vision', 'mapIQ'],
  discipline: ['tenacity'],
  improvisation: ['composure', 'adaptability'],
  leadership: ['comms'],
};

const clamp100 = (n: number): number => Math.max(0, Math.min(100, n));

// FNV-1a hash of the slot key → a stable per-slot salt for the seed.
function hashSlot(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function weightedPick(events: readonly SeasonEvent[], rng: Rng): SeasonEvent {
  const total = events.reduce((s, e) => s + (e.weight ?? 1), 0);
  let r = rng.next() * total;
  for (const e of events) {
    r -= e.weight ?? 1;
    if (r < 0) return e;
  }
  return events[events.length - 1];
}

function resolveSubject(season: SeasonState, sel: Subject, rng: Rng): string | null {
  const roster = season.playerRoster;
  if (roster.length === 0) return null;
  if (sel === 'random') return rng.pick(roster).id;
  const aggOf = (u: Unit, k: AggKey): number => (aggregateVisible(u.attributes) as unknown as Record<string, number>)[k];
  if ('lowest' in sel) return [...roster].sort((a, b) => aggOf(a, sel.lowest) - aggOf(b, sel.lowest))[0].id;
  return [...roster].sort((a, b) => aggOf(b, sel.highest) - aggOf(a, sel.highest))[0].id;
}

// The event + subject for a slot. `slotKey` must be stable per season position
// (e.g. `pre-3` / `post-3`) so resume re-rolls identically.
export function rollEvent(season: SeasonState, slotKey: string): { event: SeasonEvent; subjectId: string | null } {
  const rng = createRng((season.seed ^ hashSlot(slotKey)) >>> 0);
  const event = weightedPick(AMBIENT_EVENTS, rng);
  const subjectId = event.subject ? resolveSubject(season, event.subject, rng) : null;
  return { event, subjectId };
}

// The team's current form, from its W/L record so far. A clear lead/deficit reads
// as strong/struggling; anything close reads as even. Drives the `record` aside.
export function recordForm(results: readonly ('W' | 'L')[]): RecordForm {
  const w = results.reduce((n, r) => n + (r === 'W' ? 1 : 0), 0);
  const diff = w - (results.length - w);
  if (diff >= 2) return 'strong';
  if (diff <= -2) return 'struggling';
  return 'even';
}

// Pure: the extra flavour sentences to append under an event's body — a
// personality aside (when the event has a subject who carries one) and a form
// aside — in that order. Each may still contain {player}; the screen fills it.
export function eventFlavor(event: SeasonEvent, subject: Unit | null, results: readonly ('W' | 'L')[]): string[] {
  const out: string[] = [];
  const p = subject?.personality as PersonalityId | null | undefined;
  if (event.persona && p && event.persona[p]) out.push(event.persona[p]!);
  if (event.record) {
    const line = event.record[recordForm(results)];
    if (line) out.push(line);
  }
  return out;
}

function applyAttr(roster: readonly Unit[], scope: 'team' | 'self', subjectId: string | null, agg: AggKey, amount: number): Unit[] {
  const subs = AGG_SUBS[agg];
  return roster.map((u) => {
    if (scope === 'self' && u.id !== subjectId) return u;
    const a = { ...u.attributes } as unknown as Record<string, number>;
    for (const s of subs) a[s] = clamp100(a[s] + amount);
    return { ...u, attributes: a as unknown as Attributes };
  });
}

// Apply a list of effects to the season. Pure — returns a new SeasonState. Shared
// by the event runtime and other systems (e.g. the off-week focus) that trade in
// the same Effect vocab. `subjectId` targets `self`-scoped attr/morale effects.
export function applyEffects(season: SeasonState, effects: readonly Effect[], subjectId: string | null): SeasonState {
  let roster = season.playerRoster;
  let leaguePoints = season.leaguePoints;
  let morale = season.morale ?? {};
  for (const e of effects) {
    if (e.op === 'leaguePoints') leaguePoints += e.amount;
    else if (e.op === 'morale') morale = adjustMorale(morale, roster, e.scope, subjectId, e.amount);
    else roster = applyAttr(roster, e.scope, subjectId, e.agg, e.amount);
  }
  return { ...season, playerRoster: roster, leaguePoints, morale };
}

// Apply an event's effects (or the chosen choice's) to the season. Pure — returns
// a new SeasonState. The caller advances the phase + saves afterward.
export function applyEvent(season: SeasonState, event: SeasonEvent, subjectId: string | null, choiceIdx: number | null): SeasonState {
  const effects: readonly Effect[] = choiceIdx != null && event.choices ? event.choices[choiceIdx].effects : (event.effects ?? []);
  return applyEffects(season, effects, subjectId);
}
