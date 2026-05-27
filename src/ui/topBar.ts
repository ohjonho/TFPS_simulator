// Top bar: map name + match score + round + player's current half (ATK/DEF) +
// phase/tick indicator + flow buttons (Begin Round / Back to Planning) +
// optional Timeout button (match-point only) + fog POV toggle.

import type { GameState, MatchMode, Team } from '../game/types.ts';
import { DEFUSE_TICKS, DETONATION_TICKS, MATCH_WIN_SCORE, PLANT_TICKS } from '../game/config.ts';
import { strategyById } from '../game/strategies.ts';
// H3.4 — cardData.ts removed; card-targeting tooltip hint dropped along with it.

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
  // H3.4 — cardTargetingPending / pickedCardDefId removed (card system deleted).
  // Pass E m5 — Standard / Randomize Units toggle. Switching rebuilds the
  // match (preserving seed by default, see main.ts).
  onSetMode: (mode: MatchMode) => void;
  // Pass E3.2 — "?" button opens the help / glossary modal.
  onOpenHelp: () => void;
};

export function renderTopBar(host: HTMLElement, state: GameState, cb: TopBarCallbacks): void {
  host.innerHTML = '';

  // Pass E3.2 — "?" help button anchored at the far left so a new player
  // can find the tutorial + glossary immediately. Auto-opens once per
  // browser on first load; opens any time on click.
  const helpBtn = document.createElement('button');
  helpBtn.textContent = '?';
  helpBtn.title = 'How to play + glossary';
  helpBtn.className = 'btn-help';
  helpBtn.addEventListener('click', cb.onOpenHelp);
  host.appendChild(helpBtn);

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

  // Pass E m5 / Pass G — Standard / Draft mode toggle. Standard = fixed 2r+1s
  // + flat-50 attributes (today's default). Draft = generate an 8-unit pool
  // and player/AI snake-pick 3 each before the match begins.
  const modeGroup = document.createElement('div');
  modeGroup.className = 'mode-toggle';
  for (const m of ['standard', 'draft'] as const) {
    const b = document.createElement('button');
    b.textContent = m === 'standard' ? 'Standard' : 'Draft';
    if (state.matchMode === m) b.classList.add('selected');
    b.title = m === 'standard'
      ? 'Debug — fixed 2 rifles + 1 sniper, flat-50 attributes. Use to test combat math without RNG variance.'
      : 'Pool of 8 random units — you and the AI snake-pick 3 each (P-A-A-P-P-A). Default for normal play.';
    b.addEventListener('click', () => cb.onSetMode(m));
    modeGroup.appendChild(b);
  }

  // F1 — score / round / half / phase grouped into a centered "match-info"
  // block with bigger font (FPS-style scoreboard). Sandwiched between two
  // flex:1 spacers below so it stays horizontally centered regardless of
  // the chrome on either side.
  const playerScore = state.scores[state.playerTeam];
  const oppTeam: Team = state.playerTeam === 'defenders' ? 'attackers' : 'defenders';
  const oppScore = state.scores[oppTeam];

  const matchInfo = document.createElement('div');
  matchInfo.className = 'match-info';

  const score = document.createElement('span');
  score.className = 'score';
  score.textContent = `${playerScore} – ${oppScore}`;

  const round = document.createElement('span');
  round.className = 'round-label';
  round.textContent = `R${state.round}`;

  const playerSide = state.teamSide[state.playerTeam];
  const half = document.createElement('span');
  half.className = 'half-label';
  half.textContent = playerSide === 'defender' ? 'DEF' : 'ATK';

  const phase = document.createElement('span');
  phase.className = 'phase-label';
  phase.textContent =
    state.phase === 'planning' ? 'Planning' : `tick ${state.tick}`;

  matchInfo.append(score, round, half, phase);

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

  const leftSpacer = document.createElement('div');
  leftSpacer.className = 'spacer';
  const spacer = document.createElement('div');
  spacer.className = 'spacer';
  host.append(mapName, modeGroup, leftSpacer, matchInfo, plantLabel, spacer);

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
  // Pass E3 — shortened label to "Enemies" to free up top-bar width on
  // narrower screens; tooltip retains the full description.
  const seBtn = document.createElement('button');
  seBtn.textContent = cb.showEnemiesPlanning ? 'Enemies ●' : 'Enemies ○';
  seBtn.title = 'Toggle whether enemy units are visible during planning (dev aid).';
  if (cb.showEnemiesPlanning) seBtn.classList.add('selected');
  seBtn.addEventListener('click', cb.onToggleShowEnemies);
  host.appendChild(seBtn);

  // Pass D — region-name overlay toggle. Faded region labels at each region
  // centroid so the player can map "A site"/"mid"/"b_main" to actual hexes.
  // Mirrors the `R` keybinding.
  const rBtn = document.createElement('button');
  rBtn.textContent = cb.showRegionLabels ? 'Regions ●' : 'Regions ○';
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

  // Pass G — during the pre-match draft, show a small "Drafting…" label in
  // place of the Begin Round / Back to Planning buttons. The draft panel
  // owns the Confirm action.
  if (state.phase === 'draft') {
    const status = document.createElement('span');
    status.className = 'phase-label';
    status.textContent = 'Drafting…';
    host.appendChild(status);
  } else if (state.phase === 'planning') {
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
    // H3.4 — card-targeting gating removed.
    begin.disabled = disabled;
    if (hint) begin.title = hint;
    begin.addEventListener('click', cb.onBeginRound);
    host.appendChild(begin);
  } else if (state.phase === 'resolution') {
    const back = document.createElement('button');
    back.textContent = 'Back to Planning';
    back.addEventListener('click', cb.onBackToPlanning);
    host.appendChild(back);
  }
}
