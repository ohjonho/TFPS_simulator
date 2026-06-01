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
      <li><strong>Pick a strategy</strong> (left panel). Baseline 6: Hold /
        Stack / Pressure (defender), Execute / Rush / Control (attacker).
        Your roster's traits unlock <strong>variant strategies</strong>
        — e.g. a Sentinel on the team adds "Anchor Hold", a Lurker adds
        "Patient Flank", a Leader adds "Coordinated Lockdown". Variants
        have higher ceilings but demand more from your roster's
        Discipline.</li>
      <li><strong>For multi-site strategies</strong> (Stack / Execute / Rush)
        pick site <strong>A</strong> or <strong>B</strong> in the sub-row
        that appears.</li>
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
      <li>Watch the round play out tick by tick. Kill feed (bottom-left)
        shows every shot, hit, plant / defuse / detonate, and the
        round-start strategy summary for both teams.</li>
      <li>Bottom bar: Play / Pause, speed 1× / 2× / 4×, Replay (re-runs the
        round from the same starting state — identical outcome).</li>
      <li>Hero passive abilities fire automatically — Tactical Scan
        (Techy) reveals enemies at round start; Guardian Aura (Angelic)
        is always on; Mark Target (Cursed) triggers the first time the
        unit spots an enemy.</li>
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
      <li><kbd>Esc</kbd> — close this modal or deselect a unit.</li>
    </ul>
  </section>
  <section>
    <h3>Modes</h3>
    <ul>
      <li><strong>Draft</strong> (default): pool of 8 random units (≥2 of
        each weapon); you and the AI snake-pick 3 each (P-A-A-P-P-A). The
        leftover 2 are discarded. Drafted units carry random attributes
        (40–60) + 3 random traits each. The seed appears in the right
        panel; same seed reproduces the same pool + AI picks.</li>
      <li><strong>Standard</strong> (debug toggle): fixed 2 rifles + 1
        sniper per team, all attributes at 50. The validation baseline —
        removes attribute / trait RNG so you can see strategy effects
        cleanly.</li>
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
    <h3>Attributes (5 visible / 10 hidden)</h3>
    <p>Each unit has 5 visible attributes shown as the primary stat card,
      backed by 10 hidden sub-attributes that combat math actually reads.
      Open the "Details (sub-attributes)" disclosure on the attributes
      panel to see them.</p>
    <ul class="glossary">
      <li><strong>Mechanics</strong> — shooting skill. Subs: Aim, Headshot,
        Reflexes, Weapon Affinity.</li>
      <li><strong>Game Sense</strong> — what they perceive. Subs: Vision
        (cone width + tracking), Map IQ (cover-seek quality).</li>
      <li><strong>Discipline</strong> — adherence to assigned directives.
        Sub: Tenacity (drives the per-tick directive compliance roll —
        high-Tenacity units stay on plan; low-Tenacity drop into the
        fallback behavior tree more often, especially on demanding
        strategies and under fire).</li>
      <li><strong>Improvisation</strong> — off-plan quality + stress.
        Subs: Composure (last-alive HR scaling), Adaptability
        <em>(generated; v1 fallback-tree quality hook)</em>.</li>
      <li><strong>Leadership</strong> — buff aura magnitude. Sub: Comms
        <em>(generated; v1 hero aura scaling hook)</em>.</li>
    </ul>
  </section>
  <section>
    <h3>Traits — 23 total, 3 per unit</h3>
    <p>Every unit rolls one Skill + one Behavioral + one Personality trait.
      Each trait gives sub-attribute bonuses (visible in the panel) AND
      may carry an <code>unlocks</code> list that adds extra strategies
      to your team's strategy menu. Skill traits are pure stat; every
      behavioral + personality trait unlocks one variant strategy when
      a unit on your team carries it. Hover any trait chip for the full
      description and unlocks. Trait tier (starter / earned / event) is
      shown in the tooltip — v1 progression uses it to gate scout /
      XP-earned / event-triggered acquisition.</p>
    <h4>Skill (7)</h4>
    <ul class="glossary">
      <li><strong>Sharp Aim</strong> — +10 HR on every shot. +15 Aim.</li>
      <li><strong>Headhunter</strong> — +10 HS with rifles. +15 Headshot.</li>
      <li><strong>Eagle Eye</strong> — +30° wider cone. +10 Vision.</li>
      <li><strong>First Shot</strong> — +20 HR on first shot of an
        engagement (Reflexes scales magnitude).</li>
      <li><strong>Spray Down</strong> — +15 HR after the first 3 engagement
        ticks (sustained fire). Opposite of First Shot.</li>
      <li><strong>Deadeye</strong> — +15 HR at long range.</li>
      <li><strong>Close Quarters</strong> — +15 HR at short range.</li>
    </ul>
    <h4>Behavioral (8)</h4>
    <ul class="glossary">
      <li><strong>Sentinel</strong> — +25 HR / +20 HS stationary 3+ ticks.
        No retreat.</li>
      <li><strong>Run-n-Gun</strong> — +0.5 speed, +15 HR moving.</li>
      <li><strong>Lurker</strong> — +20 HR / +10 HS wall-adjacent.
        Retreats to wall.</li>
      <li><strong>Entry</strong> — +20/+15 first 3 engagement ticks,
        then −10 HR. No retreat.</li>
      <li><strong>Trader</strong> — +15 HR when ally fired last 3 ticks.</li>
      <li><strong>Clutch</strong> — +20/+15 last alive (Composure scales).
        No retreat.</li>
      <li><strong>Roamer</strong> — mobile defender; rotates between
        angles. +Reflexes +MapIQ −Tenacity.</li>
      <li><strong>Hot Head</strong> — engages on sight; ignores hold
        orders. +Aim −Tenacity.</li>
    </ul>
    <h4>Personality (8)</h4>
    <ul class="glossary">
      <li><strong>Big Brain</strong> — reads enemy rotations. +MapIQ
        +Tenacity +Adaptability.</li>
      <li><strong>Ego</strong> — high-Aim freelancer. +Aim −Tenacity
        (won't follow plan).</li>
      <li><strong>Composed</strong> — steady under pressure. +15 Composure.</li>
      <li><strong>Leader</strong> — buffs allies. +20 Comms +Tenacity.</li>
      <li><strong>Lone Wolf</strong> — solo plays. +Aim −Comms.</li>
      <li><strong>Paranoid</strong> — over-rotates, sees ghosts.
        +Vision +Reflexes −Tenacity.</li>
      <li><strong>Patient</strong> — +15 HR after tick 30. Rewards long
        rounds.</li>
      <li><strong>Old Pro</strong> — veteran feel; +5 to Aim, Composure,
        MapIQ, Tenacity. v1 "earned via match XP".</li>
    </ul>
  </section>
  <section>
    <h3>Heroes / Origins — passive abilities</h3>
    <p>One hero per unit; each grants one always-on ability. No
      decision surface — heroes do their thing automatically.</p>
    <ul class="glossary">
      <li><strong>Angelic</strong> — Guardian Aura: allies within 5 hex
        of this unit get +1 max HP for the round, always on.</li>
      <li><strong>Techy</strong> — Tactical Scan: reveals all enemy
        positions to your team for 3 ticks at round start.</li>
      <li><strong>Cursed</strong> — Mark Target: the first enemy this
        unit spots each round is auto-marked all round — allies get
        +20 HR / +10 HS vs the mark, plus 5 ticks of vision past LoS.</li>
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
    <h3>v0.12.0 — two new 5v5 maps</h3>
    <ul>
      <li><strong>Foundryv2 + Atoll_v2</strong> are selectable from the map
        toggle — ground-up redesigns of the old one-dimensional layouts, built on
        the richer region vocabulary (site entries/anchors/off-angles, near/far
        lane splits, a real mid choke, and rotational connectors). Foundryv2
        plays close to balanced; Atoll_v2 is still attacker-leaning and a work in
        progress (no cover placed yet). The originals remain for comparison.</li>
      <li><strong>Canyon defenders spawn smarter.</strong> On Canyon, defenders
        now start on the spot in their (large) spawn zone closest to where their
        strategy sends them, instead of a fixed corner — closing the approach to
        their hold. Noticeably steadies the defense on Canyon's dense layout.</li>
    </ul>
  </section>
  <section>
    <h3>v0.11.0 — units hold smarter angles</h3>
    <ul>
      <li><strong>Threat-aware positioning.</strong> When a unit settles to hold,
        it no longer just tucks behind the nearest wall facing spawn — it now
        scans nearby hexes and picks the one that's safest from where enemies
        could be shooting from (long sightlines + last-known positions) while
        still keeping eyes on the angle it's supposed to watch. Smarter players
        (higher Map IQ) scan wider for a better spot. Net effect: defenders hold
        less-exposed angles and stacked players spread to distinct cover instead
        of clumping on one tile.</li>
      <li><strong>Canyon gets its own playbook.</strong> Canyon no longer borrows
        Foundry's strategies — it now has native plays built on its specific
        geometry (site entries, defender anchors + off-angles, near/far lane
        splits, and the central mid choke). Each strategy reads differently on
        Canyon now instead of all playing the same.</li>
    </ul>
  </section>
  <section>
    <h3>v0.10.0 — 5v5: full squads</h3>
    <ul>
      <li><strong>Teams are now five per side.</strong> Each roster fields
        four riflers + one sniper (drafts pick 5 from a 14-unit pool). Every
        strategy has been re-authored to deploy all five — no more two units
        freelancing with no job.</li>
      <li><strong>Deeper playbooks.</strong> Attacking executes now send three
        riflers onto the plant with a lane-watcher and a mid sniper; rushes
        flood four bodies down one lane. Defensively, Hold anchors two players
        per site, Stack clusters three with a mid + off-site watcher, and
        Pressure pushes four into mid. The trait-unlocked strategies scaled the
        same way (e.g. Coordinated Lockdown stacks all five on one site).</li>
      <li><strong>Ace = full wipe.</strong> The end-of-round multikill bonus now
        triggers on wiping the whole enemy team (5 kills at 5v5), not a
        hard-coded 3.</li>
    </ul>
  </section>
  <section>
    <h3>v0.9.0 — smarter unit AI: pick your fights</h3>
    <ul>
      <li><strong>Odds-based engagements.</strong> Units no longer shoot at
        anything they see. They weigh the duel — their hit chance at that
        range versus the enemy's back at them, plus cover and any active
        mark — and commit only when it's worth it, otherwise they hold cover
        instead of feeding. <strong>Personality sets the risk appetite:</strong>
        an Ego or Hot Head peeks the sniper anyway; a Composed, Patient, or
        Sentinel unit waits for a cleaner angle.</li>
      <li><strong>Respecting unseen angles.</strong> Units read map danger —
        long sightlines and the last-known spots of enemies the team has
        seen — and stop strolling blind into lanes they haven't cleared.</li>
      <li><strong>Playing the clock and the spike.</strong> Attackers stop
        holding for picks and commit to a site as the timer runs down (they
        lose on timeout); after a plant the roles flip — defenders push to
        retake while attackers hold the angle on the spike. Teams also press
        a man-advantage and play safer when a player down.</li>
      <li>Fixed a stale browser-tab title (it read &ldquo;Pass 1&rdquo;).</li>
    </ul>
  </section>
  <section>
    <h3>v0.8.2 — clean v0 package</h3>
    <ul>
      <li>Full spec rewrite (<code>docs/spec.md</code>) describing what
        actually shipped — match flow, maps, units, attributes, traits,
        vision, combat, AI directives + compliance, plant mechanic,
        draft mode, determinism + event log + stats pipeline, UI
        surfaces, code map, config cheat sheet.</li>
      <li>New <code>README.md</code> with project intro, getting-started,
        what's modeled vs not, and dev-tool overview.</li>
      <li><code>CLAUDE.md</code> refreshed to a v0-complete coding
        contract.</li>
      <li>Module headers across the most-visited game files
        (main / tick / combat / directives / strategies / match / state /
        loop / attributes / vision) replaced with intent-first
        descriptions instead of pass-tag changelogs.</li>
    </ul>
  </section>
  <section>
    <h3>v0.8.1 — planning UI polish</h3>
    <ul>
      <li><strong>Attribute panel consistency.</strong> Discipline
        promoted to a v0-active visible attribute (Tenacity is wired
        via the compliance roll). H3-badged inert subs (Adaptability,
        Comms) now actually grey out in the Details panel — a CSS
        specificity bug was making them render at full brightness.</li>
      <li><strong>Full weapon names</strong> in the draft pool cards
        (Sniper / Rifle / Shotgun) — the single-letter glyph forced
        memorization across 8 unknown units.</li>
      <li><strong>Role + Hero chips with hover tooltips</strong>
        across the planning roster, draft pool cards, and resolution
        unit info. Hero is now visible during planning (previously
        only in the resolution unit-info DL).</li>
    </ul>
  </section>
  <section>
    <h3>v0.8 — H3: roster-driven strategies + card system collapse</h3>
    <ul>
      <li><strong>15 strategies on the menu</strong> (was 6). Baseline 6
        (Hold / Stack / Pressure / Execute / Rush / Control) plus 9
        trait-unlocked variants for defense and 6 for attack. The menu
        is filtered to your roster — a strategy appears only when a
        unit on your team carries a trait that unlocks it. A Sentinel
        adds "Anchor Hold"; a Lurker adds "Patient Flank"; a Leader
        adds "Coordinated Lockdown"; a Lone Wolf adds "Scatter Push";
        and so on.</li>
      <li><strong>Per-tick directive compliance roll.</strong> Each tick
        a unit's directive applies, it rolls
        <code>50 + 0.5×Tenacity_delta + 0.3×Composure_delta
        − threshold − situational_pressure</code> (clamp [5, 95]). On
        failure the unit drops into the fallback behavior tree. High-
        Tenacity rosters stay on plan; low-Tenacity rosters break
        under fire — especially on demanding strategies (Anchor Hold,
        Patient Flank, Coordinated Lockdown all raise the threshold
        above the baseline 50).</li>
      <li><strong>Card system removed end-to-end.</strong> Deck / hand /
        discard, the targeting UI, all 13 card definitions, and the
        per-card visual layer have all been retired. The strategy menu
        + traits + heroes now own the manager-agency surface that
        cards used to share. The few card behaviors worth keeping
        migrated:
        <ul>
          <li>Tactical Scan, Guardian Aura, Mark Target became
            <strong>hero passive abilities</strong>.</li>
          <li>Reckless Push / Anchor Position / Slow Flank / Spearhead
            / Crossfire became <strong>strategy synergies</strong>
            inside their relevant variants.</li>
        </ul>
      </li>
      <li><strong>Draft is now the default mode.</strong> Standard
        becomes the debug toggle for sim work (removes attribute /
        trait RNG so you can read strategy effects cleanly).</li>
      <li><strong>Validation harness.</strong> <code>__sim.runValidation</code>
        runs the 6×6 strategy matrix + a high-vs-low-Tenacity
        compliance test + the determinism check in ~30s and prints a
        console summary.</li>
      <li><strong>Round-resolution fix.</strong> Plant-then-elim cases
        (attackers plant the spike but also wipe defenders, or vice
        versa) now resolve correctly via the plant timer instead of
        stalling.</li>
    </ul>
  </section>
  <section>
    <h3>v0.7 — H1 + H2: attributes + traits redesign</h3>
    <ul>
      <li><strong>14 attributes → 5 visible / 10 hidden.</strong> The panel
        shows Mechanics / Game Sense / Discipline / Improvisation /
        Leadership; the 10 sub-attributes that combat actually reads are
        in a "Details" disclosure below. No more spreadsheet sim.</li>
      <li>Cut inert + duplicative slots: sprayControl, confidence,
        per-weapon handling × 3 (collapsed to one Weapon Affinity sub
        that reads against the equipped weapon), positioning, teamwork +
        communication. Trait combat hooks unchanged.</li>
      <li><strong>3 traits per unit</strong> (was 2): Skill + Behavioral +
        new <strong>Personality</strong> category. Total pool: 23 traits
        across the three categories.</li>
      <li>New skill traits: Spray Down, Deadeye, Close Quarters. New
        behavioral: Roamer, Hot Head. New personality: Big Brain, Ego,
        Composed, Leader, Lone Wolf, Paranoid, Patient, Old Pro.</li>
      <li>Every trait now carries an <code>unlocks</code> list of
        strategy ids. H3 turns these into actual strategy menu entries
        ("Anchor Hold" unlocked by Sentinel, "Scatter Push" unlocked by
        Lone Wolf, etc.). Roster composition will drive tactical
        identity.</li>
      <li>Trait tier metadata (<em>starter</em> / <em>earned</em> /
        <em>event</em>) added — v1 progression hook for "freshly scouted
        units roll starters only; earned + event come via training and
        in-match triggers."</li>
      <li>Mode toggle renamed: <strong>Randomize → Draft</strong>. Draft
        is the same generator under the hood but adds the pre-match
        snake-pick UI.</li>
      <li>Hover any trait chip to see its description, sub-attribute
        bonuses, and forward-data strategy unlocks.</li>
    </ul>
  </section>
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
      <li>Per-unit attribute schema introduced (later redesigned in v0.7
        to 5 visible / 10 hidden).</li>
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
