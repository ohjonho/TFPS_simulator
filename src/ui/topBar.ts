// Top bar: map name + match score + round + player's current half (ATK/DEF) +
// phase/tick indicator + flow buttons (Begin Round / Back to Planning) +
// optional Timeout button (match-point only) + fog POV toggle.

import type { GameState, Team } from '../game/types.ts';
import { DEFUSE_TICKS, DETONATION_TICKS, MATCH_WIN_SCORE, PLANT_TICKS } from '../game/config.ts';
import { strategyById } from '../game/strategies.ts';
import { cardById } from '../game/cardData.ts';

export type TopBarCallbacks = {
  onBeginRound: () => void;
  onBackToPlanning: () => void;
  onSetPlayerTeam: (team: Team) => void;
  onTimeout: () => void;
  onToggleShowEnemies: () => void;
  showEnemiesPlanning: boolean;
  onSetMap: (name: 'Foundry' | 'Atoll') => void;
  // Pass D — region-name overlay toggle (mirrors `R` keybind).
  onToggleRegionLabels: () => void;
  showRegionLabels: boolean;
  // Pass D — true when the player has picked a card requiring a target but
  // not yet committed one. Begin Round is disabled.
  cardTargetingPending: boolean;
  // The picked card's def id (for the disabled-button tooltip), or null.
  pickedCardDefId: string | null;
};

export function renderTopBar(host: HTMLElement, state: GameState, cb: TopBarCallbacks): void {
  host.innerHTML = '';

  // Map toggle (Foundry / Atoll). Switching starts a new match on that map.
  const mapName = document.createElement('div');
  mapName.className = 'map-name';
  for (const m of ['Foundry', 'Atoll'] as const) {
    const b = document.createElement('button');
    b.textContent = m;
    if (state.map.name === m) b.classList.add('selected');
    b.title = 'Switch map (starts a new match).';
    b.addEventListener('click', () => cb.onSetMap(m));
    mapName.appendChild(b);
  }

  const playerScore = state.scores[state.playerTeam];
  const oppTeam: Team = state.playerTeam === 'defenders' ? 'attackers' : 'defenders';
  const oppScore = state.scores[oppTeam];
  const score = document.createElement('span');
  score.className = 'score';
  score.textContent = `${playerScore} – ${oppScore}`;

  const round = document.createElement('span');
  round.className = 'round-label';
  round.textContent = `Round ${state.round}`;

  const playerSide = state.teamSide[state.playerTeam];
  const half = document.createElement('span');
  half.className = 'half-label';
  half.textContent = playerSide === 'defender' ? 'DEF' : 'ATK';

  const phase = document.createElement('span');
  phase.className = 'phase-label';
  phase.textContent =
    state.phase === 'planning' ? 'Planning' : `Resolution — tick ${state.tick}`;

  // Pass B — spike status indicator. Only visible during resolution + when
  // either a plant is in progress, the spike is down, or a defuse is in
  // progress. Stays out of the way otherwise.
  const plantLabel = document.createElement('span');
  plantLabel.className = 'plant-label';
  const p = state.plant;
  if (state.phase === 'resolution') {
    if (p.planted) {
      const elapsed = state.tick - p.planted.plantedAtTick;
      const remaining = Math.max(0, DETONATION_TICKS - elapsed);
      plantLabel.classList.add('plant-down');
      plantLabel.textContent = p.defusing
        ? `SPIKE @ ${p.planted.site} — DEFUSING (${state.tick - p.defusing.startedAtTick}/${DEFUSE_TICKS})`
        : `SPIKE @ ${p.planted.site} — ${remaining}t to detonate`;
    } else if (p.planting) {
      plantLabel.classList.add('planting');
      plantLabel.textContent = `Planting @ ${p.planting.site} (${state.tick - p.planting.startedAtTick}/${PLANT_TICKS})`;
    }
  }

  const spacer = document.createElement('div');
  spacer.className = 'spacer';
  host.append(mapName, score, round, half, phase, plantLabel, spacer);

  // Fog perspective toggle.
  const fogGroup = document.createElement('div');
  fogGroup.className = 'fog-group';
  const fogLabel = document.createElement('span');
  fogLabel.className = 'fog-label';
  fogLabel.textContent = 'Fog:';
  fogGroup.appendChild(fogLabel);
  for (const team of ['defenders', 'attackers'] as const) {
    const btn = document.createElement('button');
    btn.textContent = team === 'defenders' ? 'D' : 'A';
    if (state.playerTeam === team) btn.classList.add('selected');
    btn.addEventListener('click', () => cb.onSetPlayerTeam(team));
    fogGroup.appendChild(btn);
  }
  host.appendChild(fogGroup);

  // "Show enemies" dev toggle (default on while building). Off → planning phase
  // also gets fog of war for the player team.
  const seBtn = document.createElement('button');
  seBtn.textContent = cb.showEnemiesPlanning ? 'Show enemies: on' : 'Show enemies: off';
  seBtn.title = 'Toggle whether enemy units are visible during planning (dev aid).';
  if (cb.showEnemiesPlanning) seBtn.classList.add('selected');
  seBtn.addEventListener('click', cb.onToggleShowEnemies);
  host.appendChild(seBtn);

  // Pass D — region-name overlay toggle. Faded region labels at each region
  // centroid so the player can map "A site"/"mid"/"b_main" to actual hexes.
  // Mirrors the `R` keybinding.
  const rBtn = document.createElement('button');
  rBtn.textContent = cb.showRegionLabels ? 'Regions: on' : 'Regions: off';
  rBtn.title = 'Toggle region-name overlay (press R).';
  if (cb.showRegionLabels) rBtn.classList.add('selected');
  rBtn.addEventListener('click', cb.onToggleRegionLabels);
  host.appendChild(rBtn);

  // Timeout button (spec §9.3, §17): available when the player team is at match
  // point — own score = MATCH_WIN_SCORE − 1 (=3) and opponent < MATCH_WIN_SCORE.
  const atMatchPoint =
    playerScore === MATCH_WIN_SCORE - 1 &&
    oppScore < MATCH_WIN_SCORE &&
    !state.timeoutUsed[state.playerTeam];
  if (state.phase === 'planning' && atMatchPoint) {
    const tBtn = document.createElement('button');
    tBtn.textContent = 'Timeout';
    tBtn.title = 'Replan strategy before the next round (1 per match).';
    tBtn.addEventListener('click', cb.onTimeout);
    host.appendChild(tBtn);
  }

  if (state.phase === 'planning') {
    const begin = document.createElement('button');
    begin.className = 'btn-primary';
    begin.textContent = 'Begin Round';
    // Pass C — disable Begin Round if the picked strategy has multiple
    // variants and the player hasn't chosen A/B yet.
    let disabled = !state.playerStrategy;
    let hint = '';
    if (state.playerStrategy) {
      const strat = strategyById(state.playerStrategy, state.teamSide[state.playerTeam], state.map);
      if (strat && strat.variants.length > 1 && state.playerVariantChoice === null) {
        disabled = true;
        hint = 'Pick A or B';
      }
    }
    // Pass D — disable Begin Round when the player picked a hex/role-targeted
    // card but hasn't committed a target. The card-targeting handler clears
    // `cardTargetingPending` once the click commits.
    if (!disabled && cb.cardTargetingPending) {
      disabled = true;
      const def = cb.pickedCardDefId ? cardById(cb.pickedCardDefId) : null;
      hint = def?.targeting === 'role'
        ? `Pick a role for ${def.name}`
        : def
          ? `Click a hex for ${def.name}`
          : 'Pick a target for your card';
    }
    begin.disabled = disabled;
    if (hint) begin.title = hint;
    begin.addEventListener('click', cb.onBeginRound);
    host.appendChild(begin);
  } else {
    const back = document.createElement('button');
    back.textContent = 'Back to Planning';
    back.addEventListener('click', cb.onBackToPlanning);
    host.appendChild(back);
  }
}
