// Live per-unit stats column, shown in the side gutters during the match
// (resolution phase). Left gutter = your team, right gutter = enemy team.
// Re-rendered every tick by rerenderChrome, so HP / status update live.
//
// The detailed hover unit-info (old resolution side panel) is superseded by
// these persistent rows — they surface each unit's HP + AI state for ALL ten
// units at a glance, which the hover-only panel couldn't.

import type { GameState, Team } from '../game/types.ts';
import { UNIT_DEFAULTS } from '../game/config.ts';
import { roleChip } from './unitMetaChip.ts';

// Human-readable + color-coded AI state for a unit row.
function statusLabel(mode: string): { text: string; cls: string } {
  switch (mode) {
    case 'engaged':    return { text: 'in fight', cls: 'engaged' };
    case 'retreating': return { text: 'falling back', cls: 'retreat' };
    case 'moving':     return { text: 'moving', cls: 'moving' };
    case 'holding':    return { text: 'holding', cls: 'holding' };
    default:           return { text: mode || '—', cls: 'holding' };
  }
}

// HP-bar fill class by remaining fraction (green → amber → red).
function hpClass(frac: number): string {
  if (frac > 0.6) return 'hp-ok';
  if (frac > 0.3) return 'hp-mid';
  return 'hp-low';
}

// Live stats for one team. `label` is the column heading ("Your Team" /
// "Enemy"); the side tag (DEF/ATK) + alive count are appended.
export function liveTeamStatsHtml(state: GameState, team: Team, label: string): string {
  const units = state.units.filter((u) => u.team === team);
  const side = state.teamSide[team] === 'defender' ? 'DEF' : 'ATK';
  const alive = units.filter((u) => u.state === 'alive').length;
  const rows = units.map((u) => {
    const dead = u.state === 'dead';
    const frac = Math.max(0, u.hp) / UNIT_DEFAULTS.maxHp;
    const pct = Math.round(frac * 100);
    const ai = state.ai[u.id];
    const status = dead ? { text: 'DEAD', cls: 'dead' } : statusLabel(ai?.mode ?? '—');
    return `
      <li class="lu${dead ? ' lu-dead' : ''}" data-roster-unit="${u.id}">
        <div class="lu-top">
          <strong>${u.name || u.id}</strong>
          <span class="lu-id">${u.id}</span>
          <span class="lu-weapon">${u.weapon}</span>
          <span class="lu-status ${status.cls}">${status.text}</span>
        </div>
        <div class="lu-hpbar" title="HP ${Math.max(0, u.hp)}/${UNIT_DEFAULTS.maxHp}">
          <div class="lu-hpfill ${hpClass(frac)}" style="width:${pct}%"></div>
          <span class="lu-hptext">${Math.max(0, u.hp)}</span>
        </div>
        <div class="lu-meta">${roleChip(u.role)}</div>
      </li>`;
  }).join('');
  return `
    <div class="live-roster">
      <h3>${label} <span class="lr-side">${side}</span> <span class="lr-alive">${alive}/${units.length} alive</span></h3>
      <ul>${rows}</ul>
    </div>`;
}
