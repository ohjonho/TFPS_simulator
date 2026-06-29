// Formats the combat event log into spec §18.4-style Action Log lines.
// Pure string building; mounted by the Action Log overlay.
//
// H3.4 — cardPlay / safeWindowBlock event formatters removed (card system
// deleted). strategyPick lines no longer include card sub-text.

import type { GameEvent, GameState, Weapon } from '../game/types.ts';

const WEAPON_NAME: Record<Weapon, string> = {
  shotgun: 'Shotgun',
  rifle: 'Rifle',
  sniper: 'Sniper',
};

// One line per resolved shot, e.g.
//   T:12 — D1 (Rifle) → A2 [HEAD, 2 dmg] @ short, cover · KILL
//   T:8 — A3 (Sniper) → D2 [miss] @ long
export function actionLogLines(state: GameState, max = 14): string[] {
  // Tick+target keys that ended in a death, to flag KILL on the lethal shot.
  const deaths = new Set<string>();
  for (const e of state.events) {
    if (e.type === 'death') deaths.add(`${e.tick}:${e.target}`);
  }

  const lines: string[] = [];
  for (const e of state.events) {
    if (e.type === 'shot') {
      lines.push(formatShot(e, deaths));
    } else if (e.type === 'strategyPick') {
      lines.push(formatStrategyPick(e));
    } else if (e.type === 'plant') {
      lines.push(`T:${e.tick} — ★ ${e.unit} planted the spike @ ${e.site}`);
    } else if (e.type === 'defuse') {
      lines.push(`T:${e.tick} — ✓ ${e.unit} DEFUSED the spike`);
    } else if (e.type === 'detonate') {
      lines.push(`T:${e.tick} — 💥 SPIKE DETONATED @ ${e.site}`);
    }
  }
  return lines.slice(-max);
}

function formatStrategyPick(e: Extract<GameEvent, { type: 'strategyPick' }>): string {
  const oppTeam = e.playerTeam === 'defenders' ? 'attackers' : 'defenders';
  const youLabel = e.playerTeam === 'defenders' ? 'D' : 'A';
  const oppLabel = oppTeam === 'defenders' ? 'D' : 'A';
  return `── R${e.round} — ${youLabel}: ${e.playerStrategy ?? '—'} | ${oppLabel}: ${e.aiStrategy ?? '—'}`;
}

function formatShot(e: Extract<GameEvent, { type: 'shot' }>, deaths: Set<string>): string {
  const weapon = WEAPON_NAME[e.weapon];
  const head = `T:${e.tick} — ${e.shooter} (${weapon}) → ${e.target}`;
  if (!e.hit) return `${head} [miss] @ ${e.range}`;
  const hitTag = e.headshot ? `HEAD, ${e.damage} dmg` : `body, ${e.damage} dmg`;
  const cover = e.cover ? ', cover' : '';
  const kill = deaths.has(`${e.tick}:${e.target}`) ? ' · KILL' : '';
  return `${head} [${hitTag}] @ ${e.range}${cover}${kill}`;
}
