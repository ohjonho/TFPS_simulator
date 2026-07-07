// Single-slot season autosave (Part 6 meta-loop). The season now spans many
// sittings (8 weeks of training / events / matches), so progress lives in
// localStorage and resumes from the main menu's "Continue". Snapshot model:
// SeasonState is plain JSON-serializable data, so JSON.stringify round-trips
// it as-is — robust to balance/logic changes (unlike a seed+replay model,
// which would diverge whenever the sim changes). Versioned with discard-on-
// mismatch (no migrations yet — fine while the meta-loop is in active dev).
// localStorage lives in ui/ (game/ stays DOM/browser-free).

import type { SeasonState } from '../game/season.ts';

const SAVE_KEY = 'tfps-season-save';
// v2 adds SeasonState.authoringUnlocked (Part 6 playbook gating); a v1 save would
// default it falsy and wrongly re-lock a season already past week 2, so discard.
// v3 added SeasonState.money (v1 economy); v4 replaces it with leaguePoints (the
// economy redesign — LP in-season, money end-season-only), so v3 saves discard.
// v5 added the round-robin standings (derived — no field, but a v4 save predates
// the league framing); v6 adds SeasonState.playoffs (R2d bracket); v7 adds
// SeasonState.morale (Phase 4) — a v6 save lacks it, so discard. v8 adds
// SeasonState.storyFlags (opening-cutscene hooks). v9 adds SeasonState.roundScores
// (per-match round tallies for standings round-differential) — a v8 save lacks it.
// v10 adds SeasonState.arcs (Phase 3 story-arc runtime) — a v9 save has none.
const SAVE_VERSION = 10;

// Best-effort write; called on every phase advance. Storage failures (quota,
// privacy mode) are swallowed — a missing autosave shouldn't break play.
export function saveSeason(season: SeasonState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ v: SAVE_VERSION, season }));
  } catch { /* storage unavailable / quota — autosave is best-effort */ }
}

// Load + validate. Returns null on: no save, parse error, version mismatch, or
// a shape that doesn't look like a season (defends against a hand-edited or
// truncated blob).
export function loadSeason(): SeasonState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: number; season?: SeasonState };
    if (parsed.v !== SAVE_VERSION || !parsed.season) return null;
    const s = parsed.season;
    if (!Array.isArray(s.playerRoster) || !Array.isArray(s.schedule) || typeof s.idx !== 'number' || typeof s.phase !== 'string') {
      return null;
    }
    return s;
  } catch { return null; }
}

export function clearSavedSeason(): void {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

export function hasSavedSeason(): boolean {
  return loadSeason() !== null;
}
