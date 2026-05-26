// Pass E3.2 / F1 — help modal with three tabs (How to play, Glossary, Patch
// notes). Reachable any time via the topbar "?" button; auto-opens on first
// load per browser (dismissal persisted in localStorage). Pre-F1 the body
// was a single long scroll; playtester said it didn't fit without
// scrolling, so the content is now paginated.
//
// The modal uses showModal under the hood; Esc closes the modal (modal.ts
// listens for it once open).

import { showModal, dismissModal } from './modal.ts';

const HELP_SEEN_KEY = 'tfps:v0:help-seen';

// Track the currently-active tab so reopening from inside the tab buttons
// re-renders without flicker. Reset to 'play' each time the modal opens.
type Tab = 'play' | 'glossary' | 'patch';
let activeTab: Tab = 'play';

export function showHelpModal(): void {
  activeTab = 'play';
  open();
}

function open(): void {
  showModal('How to play', renderBody(activeTab), [
    {
      label: 'Got it',
      primary: true,
      onClick: () => {
        try { localStorage.setItem(HELP_SEEN_KEY, '1'); } catch { /* ignore quota */ }
      },
    },
  ]);
  wireTabs();
}

// Auto-open on first session in this browser. Called once from main.ts after
// the initial render. Safe to call repeatedly — only fires when the flag is
// unset.
export function maybeShowFirstLoadHelp(): void {
  let seen = false;
  try { seen = localStorage.getItem(HELP_SEEN_KEY) === '1'; } catch { seen = false; }
  if (!seen) showHelpModal();
}

function wireTabs(): void {
  document.querySelectorAll<HTMLButtonElement>('.help-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = btn.getAttribute('data-tab') as Tab | null;
      if (!t) return;
      activeTab = t;
      // Re-open with the new tab. showModal dismisses the previous one + sets
      // up a fresh Esc listener, so this is the cheapest way to switch.
      dismissModal();
      open();
    });
  });
}

function renderBody(tab: Tab): string {
  const tabs: ReadonlyArray<{ key: Tab; label: string }> = [
    { key: 'play',     label: 'How to play' },
    { key: 'glossary', label: 'Glossary' },
    { key: 'patch',    label: 'Patch notes' },
  ];
  const tabBar = tabs.map((t) =>
    `<button class="help-tab${t.key === tab ? ' active' : ''}" data-tab="${t.key}">${t.label}</button>`,
  ).join('');
  const content =
    tab === 'play'     ? HOW_TO_PLAY :
    tab === 'glossary' ? GLOSSARY :
                         PATCH_NOTES;
  return `
    <div class="help-modal">
      <div class="help-tabs">${tabBar}</div>
      <div class="help-tab-body">${content}</div>
    </div>
  `;
}

// --- How to play -----------------------------------------------------------

const HOW_TO_PLAY = `
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
      <li><kbd>Esc</kbd> — close this modal, cancel an active card-target
        session, or deselect a unit.</li>
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
`;

// --- Glossary --------------------------------------------------------------

const GLOSSARY = `
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
      <li><strong>Sniper (S)</strong> — same speed as other units. If it
        moved within the last 2 ticks its HR drops sharply (moving table).
        Stationary: 30 / 60 / 80 %; moving: 15 / 30 / 45 %. Vision cone
        narrows when stationary (45° → 22.5°).</li>
      <li><strong>Shotgun (G)</strong> — point-blank lethal.
        80 / 30 / 5 %. Prefers tight corners and cover; avoids long
        sightlines.</li>
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
`;

// --- Patch notes -----------------------------------------------------------
// Newest at the top. Keep entries terse — one bullet per change. The file is
// hand-curated rather than auto-generated so we can explain WHY changes
// happened, not just what.

const PATCH_NOTES = `
  <section>
    <h3>v0.5.1 — playtester fixes</h3>
    <ul>
      <li>Attributes panel no longer stays pinned after clicking empty
        space (click outside any unit to deselect).</li>
      <li>Dragging a unit in planning now shows the unit following the
        cursor (not just a teleport on release).</li>
      <li>Help / glossary modal paginated into three tabs; <kbd>Esc</kbd>
        now closes the modal.</li>
      <li>Top-bar score &amp; round are larger and centered (FPS style).</li>
      <li>Sniper change: same movement speed as other units; HR drops to
        the moving table for 2 ticks after each step. Stand still to shoot.</li>
      <li>Shotgun AI biases toward tight cover + short sightlines; no
        longer tries to duel a sniper at mid.</li>
      <li>Three more attributes wired into the sim: <strong>Headshot</strong>
        (HS roll), <strong>Reflexes</strong> (first-shot scaling),
        <strong>Positioning</strong> (cover-hold quality).</li>
      <li>Map IQ collapsed into one attribute (was per-map foundry/atoll).</li>
    </ul>
  </section>
  <section>
    <h3>v0.5 — initial playtest build</h3>
    <ul>
      <li>Help modal with in-app tutorial &amp; glossary; auto-opens once
        per browser.</li>
      <li>Three-column layout: strategy + cards left, canvas center, roster
        / unit info right. Kill feed moved to top-left of the canvas.</li>
      <li>Player units can be dragged within their spawn zone during
        planning.</li>
      <li><strong>Randomize Units</strong> mode (top bar): seeded random
        loadouts + attributes in [40, 60]. Seed shown + editable in the
        right panel so you can reproduce a matchup.</li>
    </ul>
  </section>
  <section>
    <h3>v0.4 — card system</h3>
    <ul>
      <li>13 cards across traits / roles / heroes; per-team deck (9 cards,
        hand of 3, discard + draw each round).</li>
      <li>Card visuals during resolution (aura rings, mark crosshairs,
        anchors). Enemy effects only render once your team has vision of
        the relevant unit / hex.</li>
      <li>Strategy variants A / B for Stack / Execute / Rush — the player
        picks the site explicitly.</li>
    </ul>
  </section>
  <section>
    <h3>v0.3 — attributes + scoreboards</h3>
    <ul>
      <li>Per-unit 14-attribute schema (Aim, weapon-handling × 3, Awareness,
        Clutch wired into sim; others displayed but inert).</li>
      <li>Round-end &amp; match-end modals with K/D/A, ACS, KAST%, MVP
        marker, per-round ACS sparklines.</li>
    </ul>
  </section>
  <section>
    <h3>v0.2 — match flow</h3>
    <ul>
      <li>Strategies (Hold / Stack / Pressure on defense; Execute / Rush /
        Control on attack). AI opponent picks weighted by recent wins.</li>
      <li>6-round match, halftime side swap at round 3, first to 4 wins.</li>
      <li>Spike plant / defuse + 20-tick detonation timer.</li>
    </ul>
  </section>
  <section>
    <h3>v0.1 — simulation foundation</h3>
    <ul>
      <li>30×40 pointy-top hex grid, two maps (Foundry, Atoll).</li>
      <li>Tick-based sim, vision cones with fog of war + ghost markers,
        per-unit AI primitives, deterministic seeded RNG.</li>
      <li>Combat pipeline: weapon × range hit table, headshot rolls, cover
        penalty, traits / role / modifier seam.</li>
    </ul>
  </section>
`;
