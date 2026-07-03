// Phase 4 — event runtime. Pure: pick a deterministic event for a week slot,
// resolve its subject, and apply its (or a chosen choice's) effects to the season.
// Selection is seeded off (season.seed, slotKey) so the same slot always yields
// the same event/subject — and effects are applied exactly once by the caller
// (apply → advance phase → save), so a mid-event reload re-rolls the same event
// and re-applies nothing.

import type { SeasonState } from '../season.ts';
import type { Attributes, Hero, Role, Unit } from '../types.ts';
import type { AggKey, Effect, PersonalityId, RecordForm, SeasonEvent, Subject } from './types.ts';
import { AMBIENT_EVENTS } from './registry.ts';
import { createRng, type Rng } from '../rng.ts';
import { aggregateVisible } from '../attributes.ts';
import { adjustMorale } from '../morale.ts';
import { ROLE_AGGRESSION } from '../config.ts';

// Change a unit's role (and role-derived aggression) and/or hero. Pure.
function swapUnitLoadout(u: Unit, role?: string, hero?: string): Unit {
  const next: Unit = { ...u };
  if (role) {
    next.role = role as Role;
    next.preferredRole = role as Role;
    next.modifiers = { ...u.modifiers, aggression: ROLE_AGGRESSION[role as Role], baseAggression: ROLE_AGGRESSION[role as Role] };
  }
  if (hero) next.hero = hero as Hero;
  return next;
}

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
  // Grouped events only join the pool once an arc has enabled their group; with no
  // groups enabled the pool == the ungrouped base set, so a fresh season is unchanged.
  const groups = season.enabledEventGroups ?? [];
  const pool = AMBIENT_EVENTS.filter((e) => !e.group || groups.includes(e.group));
  const event = weightedPick(pool, rng);
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

// Transform the subject unit's storyTags (grant/remove/evolve). Other units and a
// null subject pass through unchanged.
function mapSubjectTags(roster: readonly Unit[], subjectId: string | null, fn: (tags: string[]) => string[]): Unit[] {
  if (!subjectId) return roster.map((u) => u);
  return roster.map((u) => (u.id === subjectId ? { ...u, storyTags: fn([...(u.storyTags ?? [])]) } : u));
}

// Apply a list of effects to the season. Pure — returns a new SeasonState. Shared
// by the event runtime and the arc runtime (same Effect vocab). `subjectId` targets
// `self`-scoped attr/morale + all tag ops (the arc's subject / the event's player).
export function applyEffects(season: SeasonState, effects: readonly Effect[], subjectId: string | null): SeasonState {
  let roster = season.playerRoster;
  let leaguePoints = season.leaguePoints;
  let morale = season.morale ?? {};
  let storyFlags = season.storyFlags ?? {};
  let pendingDepartures = season.pendingDepartures ?? [];
  let bonusPlaybookSlots = season.bonusPlaybookSlots ?? 0;
  let enabledEventGroups = season.enabledEventGroups ?? [];
  let obligations = season.obligations ?? [];
  const charOf = (uid: string | null): string | undefined => roster.find((x) => x.id === uid)?.characterId;
  for (const e of effects) {
    switch (e.op) {
      case 'leaguePoints': leaguePoints += e.amount; break;
      case 'morale': morale = adjustMorale(morale, roster, e.scope, subjectId, e.amount); break;
      case 'attr': roster = applyAttr(roster, e.scope, subjectId, e.agg, e.amount); break;
      case 'grantTag': roster = mapSubjectTags(roster, subjectId, (t) => (t.includes(e.tagId) ? t : [...t, e.tagId])); break;
      case 'removeTag': roster = mapSubjectTags(roster, subjectId, (t) => t.filter((x) => x !== e.tagId)); break;
      case 'evolveTag': roster = mapSubjectTags(roster, subjectId, (t) => (t.includes(e.from) ? [...t.filter((x) => x !== e.from), e.to] : t)); break;
      case 'setFlag': storyFlags = { ...storyFlags, [e.flag]: e.value ?? 'true' }; break;
      case 'depart': {
        const cid = charOf(subjectId);
        if (cid) {
          const resolveAtIdx = e.when === 'immediate' ? season.idx : e.when === 'after-next-match' ? season.idx + 1 : 9999;
          pendingDepartures = [...pendingDepartures, { characterId: cid, when: e.when, resolveAtIdx, reason: e.reason }];
        }
        break;
      }
      case 'swapLoadout': roster = roster.map((u) => (u.id === subjectId ? swapUnitLoadout(u, e.role, e.hero) : u)); break;
      case 'grantPlaybookSlots': bonusPlaybookSlots += e.amount; break;
      case 'enableEventGroup': enabledEventGroups = enabledEventGroups.includes(e.groupId) ? enabledEventGroups : [...enabledEventGroups, e.groupId]; break;
      case 'grantDuo': {
        // A mutual bond: the tag + an attribute bump on both the subject and partner.
        const partnerUid = roster.find((u) => u.characterId === e.partner)?.id ?? null;
        roster = mapSubjectTags(roster, subjectId, (t) => (t.includes(e.tagId) ? t : [...t, e.tagId]));
        roster = applyAttr(roster, 'self', subjectId, e.agg, e.amount);
        if (partnerUid) {
          roster = mapSubjectTags(roster, partnerUid, (t) => (t.includes(e.tagId) ? t : [...t, e.tagId]));
          roster = applyAttr(roster, 'self', partnerUid, e.agg, e.amount);
        }
        break;
      }
      case 'obligation': {
        const cid = charOf(subjectId);
        if (cid) obligations = [...obligations, { id: e.id, characterId: cid, require: e.require, onBreak: e.onBreak }];
        break;
      }
    }
  }
  return { ...season, playerRoster: roster, leaguePoints, morale, storyFlags, pendingDepartures, bonusPlaybookSlots, enabledEventGroups, obligations };
}

// Apply an event's effects (or the chosen choice's) to the season. Pure — returns
// a new SeasonState. The caller advances the phase + saves afterward.
export function applyEvent(season: SeasonState, event: SeasonEvent, subjectId: string | null, choiceIdx: number | null): SeasonState {
  const effects: readonly Effect[] = choiceIdx != null && event.choices ? event.choices[choiceIdx].effects : (event.effects ?? []);
  return applyEffects(season, effects, subjectId);
}
