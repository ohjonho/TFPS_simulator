// Pass E3.2 — help modal: short How-to-play walkthrough + Glossary of every
// role / skill / behavioral trait / hero / weapon / term that appears in the
// UI. Reachable any time via the topbar "?" button; auto-opens on first load
// per browser (dismissal persisted in localStorage under HELP_SEEN_KEY).
//
// Pure HTML; mounted via showModal so the existing modal chrome (overlay,
// close button) is reused. No new state on GameState.

import { showModal } from './modal.ts';

const HELP_SEEN_KEY = 'tfps:v0:help-seen';

export function showHelpModal(): void {
  showModal('How to play', HELP_BODY, [
    {
      label: 'Got it',
      primary: true,
      onClick: () => {
        try { localStorage.setItem(HELP_SEEN_KEY, '1'); } catch { /* ignore quota */ }
      },
    },
  ]);
}

// Auto-open on first session in this browser. Called once from main.ts after
// the initial render. Safe to call repeatedly — only fires when the flag is
// unset.
export function maybeShowFirstLoadHelp(): void {
  let seen = false;
  try { seen = localStorage.getItem(HELP_SEEN_KEY) === '1'; } catch { seen = false; }
  if (!seen) showHelpModal();
}

// Mostly hand-authored content — keep it short and skim-friendly. Each
// glossary row is one line: term + a sentence of what it does. Numbers
// in parentheses are the actual config values (e.g. +10 HR) so the
// glossary doubles as a quick reference.
const HELP_BODY = `
<div class="help-modal">
  <section>
    <h3>The match</h3>
    <ul>
      <li><strong>First to 4 round wins</strong> takes the match. Halftime sides
        swap after round 3, so each team plays both attack and defense.</li>
      <li>Each round runs in two phases: <strong>Planning</strong> (you pick a
        strategy + optional card), then <strong>Resolution</strong> (the round
        plays out automatically — no in-round controls).</li>
    </ul>
  </section>

  <section>
    <h3>Planning phase</h3>
    <ol>
      <li><strong>Pick a strategy</strong> (left panel). Defender: Hold / Stack /
        Pressure. Attacker: Execute / Rush / Control. For Stack / Execute / Rush
        you also pick site <strong>A</strong> or <strong>B</strong>.</li>
      <li><strong>(Optional) play a card</strong> from your hand of 3 below the
        strategy menu. Some cards need a target (you'll click a hex on the map
        or pick a role from a modal).</li>
      <li><strong>(Optional) drag your units</strong> on the map to reposition
        within your spawn zone. Useful when a specific loadout (e.g. a sniper)
        wants a particular angle.</li>
      <li>Click <strong>Begin Round</strong> in the top bar. The dashed routes
        you see during planning are previews of what your units will do.</li>
    </ol>
  </section>

  <section>
    <h3>Resolution phase</h3>
    <ul>
      <li>Watch the round play out tick by tick. Kill feed (top-left) shows
        every shot, hit, plant / defuse / detonate, and card play.</li>
      <li>Bottom bar: Play / Pause, speed 1× / 2× / 4×, Replay (re-runs the
        round from the same starting state).</li>
      <li>Cards in play this round appear in the left panel with their
        remaining duration.</li>
    </ul>
  </section>

  <section>
    <h3>Spike plant / defuse</h3>
    <ul>
      <li>Attackers stand on a plant hex for 2 ticks (with no defender on
        that site's plant zone) to <strong>plant the spike</strong>.</li>
      <li>Once planted, attackers win if the spike <strong>detonates</strong>
        20 ticks later. Defenders can <strong>defuse</strong> by holding the
        site for 4 ticks.</li>
      <li>If neither team is eliminated and there's no plant, the round
        ends on the 60-tick timer — defender side wins.</li>
    </ul>
  </section>

  <section>
    <h3>Quick keys</h3>
    <ul>
      <li><kbd>V</kbd> — toggle the vision-cone debug overlay (every unit's
        cone + visible hexes rendered).</li>
      <li><kbd>R</kbd> — toggle the region-name overlay (helps you map
        "A site" / "mid" / "b_main" to actual hexes).</li>
      <li><kbd>Esc</kbd> — cancel an active card-target session or unit
        selection.</li>
    </ul>
  </section>

  <section>
    <h3>Modes</h3>
    <ul>
      <li><strong>Standard</strong>: fixed 2 rifles + 1 sniper per team,
        all attributes at 50. The validation default.</li>
      <li><strong>Randomize</strong>: seeded random loadouts (one rifle
        per team minimum) + attributes uniformly in [40, 60]. The seed
        appears in the right panel; the same seed reproduces the same
        matchup, so you can share interesting ones with friends.</li>
    </ul>
  </section>

  <h2 class="help-section-title">Glossary</h2>

  <section>
    <h3>Roles</h3>
    <ul class="glossary">
      <li><strong>Vanguard</strong> — high aggression (70). Takes first
        contact, pushes the lead.</li>
      <li><strong>Tactician</strong> — balanced aggression (50). Holds
        angles, supports trades.</li>
      <li><strong>Warden</strong> — low aggression (35). Anchors sites,
        rotates last.</li>
      <li><strong>Specialist</strong> — flex (55). The wildcard; Adapt
        card lets them mimic another role for the round.</li>
    </ul>
  </section>

  <section>
    <h3>Skill traits</h3>
    <ul class="glossary">
      <li><strong>Sharp Aim</strong> — +10 HR on every shot.</li>
      <li><strong>Headhunter</strong> — +10 headshot chance with rifles.</li>
      <li><strong>Eagle Eye</strong> — +30° wider vision cone.</li>
      <li><strong>First Shot</strong> — +20 HR on the first shot of an
        engagement (resets when the engagement ends).</li>
    </ul>
  </section>

  <section>
    <h3>Behavioral traits</h3>
    <ul class="glossary">
      <li><strong>Sentinel</strong> — +25 HR / +20 HS once stationary 3+
        ticks. Doesn't retreat at 1 HP.</li>
      <li><strong>Run-n-Gun</strong> — +0.5 movement speed; +15 HR while
        moving.</li>
      <li><strong>Lurker</strong> — +20 HR / +10 HS when adjacent to a wall.
        Retreats to a wall hex at 1 HP.</li>
      <li><strong>Entry</strong> — +20 HR / +15 HS for the first 3 ticks of
        engagement, then −10 HR after. Doesn't retreat at 1 HP.</li>
      <li><strong>Trader</strong> — +15 HR when an ally fired within the
        last 3 ticks.</li>
      <li><strong>Clutch</strong> — +20 HR / +15 HS while last alive on the
        team. Doesn't retreat.</li>
    </ul>
  </section>

  <section>
    <h3>Heroes (card source)</h3>
    <ul class="glossary">
      <li><strong>Angelic</strong> — contributes the Guardian Aura card
        (+1 max HP to allies within 5 hex).</li>
      <li><strong>Techy</strong> — contributes Tactical Scan (reveals all
        enemies at round start for 3 ticks).</li>
      <li><strong>Cursed</strong> — contributes Mark Target (marks the
        first enemy this unit spots; allies get +20 HR / +10 HS vs that
        target, plus 5 ticks of LoS-bypass reveal).</li>
    </ul>
  </section>

  <section>
    <h3>Weapons</h3>
    <ul class="glossary">
      <li><strong>Rifle (R)</strong> — balanced; good at mid-range.
        70 / 75 / 55 % short / medium / long.</li>
      <li><strong>Sniper (S)</strong> — 0.5 hex/tick movement.
        Stationary: 30 / 60 / 80 %; moving: 15 / 30 / 45 %.
        Vision cone narrows when stationary (45° → 22.5°).</li>
      <li><strong>Shotgun (G)</strong> — point-blank lethal.
        80 / 30 / 5 %.</li>
    </ul>
  </section>

  <section>
    <h3>Terms</h3>
    <ul class="glossary">
      <li><strong>HR</strong> — hit rate (% to hit).
        <strong>HS</strong> — headshot chance.
        <strong>pp</strong> — percentage points (additive).</li>
      <li><strong>Tick</strong> — one simulation step (~1 s at 1×).</li>
      <li><strong>Cover</strong> — half-walls; reduce incoming hit % by 20.
        Cover does NOT block vision, only damage.</li>
      <li><strong>Fog of war</strong> — each team sees only hexes their
        live units can see (per-unit vision cones, blocked by full walls).</li>
      <li><strong>Cone snap</strong> — when an enemy enters a unit's cone,
        the cone re-centers on that enemy for 3 ticks of LoS loss.</li>
      <li><strong>Ghost marker</strong> — fading mark left at the last-seen
        position of an enemy that just left LoS (5 ticks).</li>
    </ul>
  </section>
</div>
`;
