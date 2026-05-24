// Formats the combat event log into spec §18.4-style kill-feed lines.
// Pure string building; mounted by the side panel. Pass 9 polishes styling.

import type { GameEvent, GameState, Weapon } from '../game/types.ts';

const WEAPON_NAME: Record<Weapon, string> = {
  shotgun: 'Shotgun',
  rifle: 'Rifle',
  sniper: 'Sniper',
};

// One line per resolved shot, e.g.
//   T:12 — D1 (Rifle) → A2 [HEAD, 2 dmg] @ short, cover · KILL
//   T:8 — A3 (Sniper) → D2 [miss] @ long
export function killFeedLines(state: GameState, max = 14): string[] {
  // Tick+target keys that ended in a death, to flag KILL on the lethal shot.
  const deaths = new Set<string>();
  for (const e of state.events) {
    if (e.type === 'death') deaths.add(`${e.tick}:${e.target}`);
  }

  const lines: string[] = [];
  for (const e of state.events) {
    if (e.type !== 'shot') continue;
    lines.push(formatShot(e, deaths));
  }
  return lines.slice(-max);
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
