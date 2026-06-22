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

// `tab` opens straight to a section (the menu's "Patch notes" / "Guidebook"
// entries use this). Guarded so passing the function directly as a click handler
// — where the arg is a MouseEvent — still resolves to a valid tab.
export function showHelpModal(tab?: Tab): void {
  activeTab = tab === 'glossary' || tab === 'patch' || tab === 'play' ? tab : 'play';
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
      <li><strong>Pick a strategy</strong> (left panel). Every roster sees the
        same menu: the six basics (Hold / Stack / Pressure on defense, Execute /
        Rush / Control on attack) plus the advanced reads (Mind Games, Coordinated
        Lockdown, Rotate, and Mid Control on the large map). Check the
        <strong>Scout</strong> above the menu for the enemy's read first — the pick
        is a read, not a gamble. (In Season the advanced plays unlock over the first
        few matches.)</li>
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
        30 ticks later. Defenders can <strong>defuse</strong> by holding the
        site for 3 ticks. A planting/defusing unit is locked — it can't move or
        shoot while the timer runs.</li>
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
      <li><strong>Season</strong> (campaign): the headline mode — a story intro,
        a build-your-squad draft (pick 5 from a pool of 8), then a gauntlet of
        matches toward a goal, carrying one roster the whole way. Strategies unlock
        as you go. See "The campaign" in the Glossary.</li>
      <li><strong>Draft</strong>: a single match — you and the AI snake-pick 5
        players each from a 14-unit pool (≥2 of each weapon). Drafted units carry
        random attributes (40–60) + two tactical traits and a personality. The seed
        in the right panel reproduces the same pool + AI picks.</li>
      <li><strong>Standard</strong> (testing): fixed four rifles + one sniper per
        team, all attributes at 50 — removes attribute / trait RNG so you can read
        strategy effects cleanly.</li>
    </ul>
  </section>
`;

// --- Glossary --------------------------------------------------------------

const GLOSSARY = `
  <section>
    <h3>The campaign (Season)</h3>
    <p>You manage a team across a season of matches against generated opponents,
      carrying one drafted roster the whole way. Win enough to clear the goal and
      you take the prize — and save the shop. A few things ramp up as you go:</p>
    <ul class="glossary">
      <li><strong>Build-your-squad draft</strong> — pick 5 players from a pool of
        8. No co-drafting opponent; rivals are their own teams.</li>
      <li><strong>A teaching first match</strong> — your opening opponent is
        telegraphed (Rushes on attack, even Hold on defense) so you can practise
        reading and countering safely.</li>
      <li><strong>Strategies unlock</strong> — match 1 is the six basics; match 2
        adds Mind Games; match 3 opens everything. The opponent ramps up with you.</li>
    </ul>
  </section>
  <section>
    <h3>Reading the opponent</h3>
    <p>The pick is meant to be a <em>read</em>, not a coin flip. The
      <strong>Scout</strong> (above the strategy menu) reads the enemy's recent
      picks this match into a lean — "leans Stack" — plus a one-line tell and a
      counter hint. The read can't lie: it reflects the picks they actually made.</p>
    <ul class="glossary">
      <li>The first round of a match shows no read yet — the Scout builds one as
        their picks accumulate. (Sides swap at halftime, so the read resets.)</li>
      <li>Counters are mostly <strong>soft</strong> — a correct read tilts the
        round in your favour, it doesn't decide it, so any pick can still win.
        A few advanced plays carry sharper, riskier edges.</li>
      <li>The round <strong>recap</strong> tells you the matchup, how it was
        decided, and whether the Scout's read held — so you learn the counters
        and sharpen your own read.</li>
    </ul>
  </section>
  <section>
    <h3>Strategies — attack</h3>
    <ul class="glossary">
      <li><strong>Execute</strong> — controlled split: three rifles breach one
        site through its entry while a lane-watcher and mid sniper cover the
        flanks. Safer than Rush against mid/flank picks.</li>
      <li><strong>Rush</strong> — all-in flood of one site, sniper trailing for
        cleanup. Fast and head-down, no mid presence.</li>
      <li><strong>Control</strong> — slow read: probe both lanes, then commit all
        four to whichever site is held by fewer defenders; mid sniper picks. Punishes
        a lopsided defense.</li>
      <li><strong>Mind Games</strong> <em>(advanced)</em> — fake one site, then
        swing to the other where the real plant goes. Punishes defenders who
        over-rotate to the fake.</li>
    </ul>
  </section>
  <section>
    <h3>Strategies — defense</h3>
    <ul class="glossary">
      <li><strong>Hold</strong> — even split: an anchor on each site, a flank
        watcher, and a mid sniper. No site bias; rotate through the connectors.</li>
      <li><strong>Stack</strong> — cluster one site (anchor + off-angle crossfire)
        with a mid watcher and one eye on the off-site for rotates.</li>
      <li><strong>Pressure</strong> — push mid off spawn and contest the choke;
        sniper holds the long lane. (Not offered on the large Foundry IV.)</li>
      <li><strong>Mid Control</strong> — hold the center, collapse on contact:
        three garrison the rotation hub, one tripwire anchors each site, and the
        hub floods whichever site is hit. Built for large maps. (Foundry IV.)</li>
      <li><strong>Mind Games</strong> <em>(advanced)</em> — show one site, hold the
        other; the ambush springs when the quiet site is hit. Punishes attacker
        over-commits.</li>
      <li><strong>Coordinated Lockdown</strong> <em>(advanced)</em> — all five stack
        one site for overlapping crossfire. Wins it outright, concedes the other —
        high variance.</li>
      <li><strong>Rotate</strong> <em>(advanced)</em> — mobile defense: hold an
        angle, then swap sites in pairs on a teammate's contact. Strong against slow
        or split attacks, weak to fast direct hits.</li>
    </ul>
  </section>
  <section>
    <h3>Roles</h3>
    <p>Role sets a unit's base aggression and shapes where it sets up and how it
      picks fights — and it adapts to the side being played.</p>
    <ul class="glossary">
      <li><strong>Vanguard</strong> (aggression 70) — pushes first, takes the entry
        duel, leads contact.</li>
      <li><strong>Tactician</strong> (50) — mid-range setup, supports flanks, plays
        for trades.</li>
      <li><strong>Warden</strong> (35) — patient anchor, holds angles from cover,
        rotates late; two Wardens on a site fan into a crossfire.</li>
      <li><strong>Specialist</strong> (55) — flex slot, adapts to the picked
        strategy.</li>
    </ul>
  </section>
  <section>
    <h3>Attributes (5 visible / 10 hidden)</h3>
    <p>Each unit shows 5 visible attributes on its stat card, backed by 10 hidden
      sub-attributes that the combat math actually reads. Open "Details
      (sub-attributes)" on the attributes panel to see them.</p>
    <ul class="glossary">
      <li><strong>Mechanics</strong> — shooting skill. Subs: Aim, Headshot,
        Reflexes, Weapon Affinity.</li>
      <li><strong>Game Sense</strong> — perception. Subs: Vision (cone width +
        tracking), Map IQ (how wide it scans for a good hold).</li>
      <li><strong>Discipline</strong> — sticking to the plan. Sub: Tenacity (drives
        the per-tick compliance roll — high-Tenacity units stay on plan, low-Tenacity
        break off, especially on demanding strategies and under fire).</li>
      <li><strong>Improvisation</strong> — off-plan quality under stress. Subs:
        Composure (last-alive HR scaling), Adaptability.</li>
      <li><strong>Leadership</strong> — team coordination. Sub: Comms (scales the
        trade bonus when a teammate has just fired).</li>
    </ul>
  </section>
  <section>
    <h3>Traits — 2 tactical + 1 personality per unit</h3>
    <p>Every unit draws two distinct <strong>tactical traits</strong> from one pool
      plus a single <strong>personality</strong>. Each gives small sub-attribute
      bonuses; tactical traits also carry a combat or behaviour hook. Hover any chip
      for the full description.</p>
    <h4>Tactical (8)</h4>
    <ul class="glossary">
      <li><strong>Aggressor</strong> — lower bar to take a duel, never retreats,
        hunts before defusing. Strong on attack; over-extends on defense.</li>
      <li><strong>Anchor</strong> — holds an angle; patient, and deadlier once it
        has settled a few ticks. Never retreats.</li>
      <li><strong>Freelancer</strong> — high ceiling, uncoachable: frequently breaks
        the plan to play its own game.</li>
      <li><strong>Disciplined</strong> — executes the called strategy reliably under
        pressure.</li>
      <li><strong>Flanker</strong> — perimeter routes, unseen until it fires, +HR
        hugging walls.</li>
      <li><strong>Trader</strong> — sharper right after a teammate fires (scales
        with Leadership).</li>
      <li><strong>Marksman</strong> — a flat aim edge on every shot. The prized
        find.</li>
      <li><strong>Clutch</strong> — surges as the last one standing (scales with
        Composure).</li>
    </ul>
    <h4>Personality (4)</h4>
    <p>Extroversion × task/people. For now a small in-match stat nudge; the real
      weight (locker-room chemistry, sponsors) arrives with the management layer.</p>
    <ul class="glossary">
      <li><strong>Firebrand</strong> — extrovert, task-driven; vocal competitor who
        plays for the highlight.</li>
      <li><strong>Catalyst</strong> — extrovert, people-first; rallies the team and
        keeps everyone talking.</li>
      <li><strong>Analyst</strong> — introvert, task-driven; quiet, methodical,
        studies the game.</li>
      <li><strong>Stabilizer</strong> — introvert, people-first; low-ego glue that
        steadies the room.</li>
    </ul>
  </section>
  <section>
    <h3>Heroes — passive + signature active</h3>
    <p>One hero per unit. Each keeps a weak always-on passive and an active that
      arms at round start and fires once, the moment its condition is met.</p>
    <ul class="glossary">
      <li><strong>Angelic</strong> — Field Medic: the first time an ally in sight is
        hurt but survives, the Angelic steps to them, heals a big chunk, and buffs
        their aim. A pure support.</li>
      <li><strong>Techy</strong> — Recon (slightly wider cone) + Tactical Scan: held
        until first contact, then briefly reveals enemies around the nearer site.</li>
      <li><strong>Cursed</strong> — Hunter (small aim edge) + Hunter's Mark: the
        first enemy spotted takes +HR/+HS from your team until it's damaged or the
        hunt times out.</li>
      <li><strong>Bulwark</strong> — Anchor (a little extra max HP) + Fortify: the
        first time it's hit, it and nearby allies harden up for a few ticks. The
        defensive wall.</li>
    </ul>
  </section>
  <section>
    <h3>Weapons</h3>
    <ul class="glossary">
      <li><strong>Rifle (R)</strong> — balanced; good at mid-range.
        70 / 75 / 55 % short / medium / long.</li>
      <li><strong>Sniper (S)</strong> — same move speed as everyone, but if it moved
        within the last 2 ticks its HR drops to the moving table. Stationary
        30 / 60 / 80 %; moving 15 / 30 / 45 %. Cone narrows when set (45° → 22.5°).
        Stand still to shoot.</li>
      <li><strong>Shotgun (G)</strong> — point-blank lethal. 80 / 30 / 5 %. Prefers
        tight corners and cover; avoids long sightlines.</li>
    </ul>
  </section>
  <section>
    <h3>Match flow &amp; the spike</h3>
    <ul class="glossary">
      <li><strong>First to 4 round wins</strong> takes the match (6 rounds). Sides
        swap at <strong>halftime</strong> after round 3, so each team plays both
        attack and defense.</li>
      <li><strong>Plant:</strong> an attacker stands on a plant hex for 2 ticks
        (no defender on that site's plant zone). Planting/defusing locks the unit —
        it can't move or shoot while the timer runs.</li>
      <li><strong>Detonate / defuse:</strong> once planted, the spike detonates 30
        ticks later (attackers win) unless defenders hold the site for 3 ticks to
        defuse.</li>
      <li><strong>Timer:</strong> with no elimination and no plant, the round ends
        on the 60-tick timer — the defender side wins.</li>
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
    <h3>v0.74.0 — Playbook legibility: who's who, and why</h3>
    <ul>
      <li><strong>Units read as players, not loadouts.</strong> In the Playbook editor
        each unit now shows its handle initials (same as in-match) instead of R/S/G, with
        a colour legend for the weapon. A new “Your units” strip lists each player's role,
        weapon, Game Sense, and exactly what route they're cleared to run.</li>
      <li><strong>Game Sense gates the playbook</strong> (it used to read Discipline). How
        complex a play you can draw — and how many you can keep — now scales with your
        squad's tactical smarts; how faithfully they then run it under fire is still
        Discipline. Train Game Sense to widen what you can author.</li>
      <li><strong>Clearer attributes.</strong> The sub-attribute details now group under
        their parent (Mechanics / Game Sense / Discipline / Improvisation / Leadership) and
        show each one's weight, so it's obvious what rolls into what.</li>
    </ul>
  </section>
  <section>
    <h3>v0.73.0 — Playbook gating: earn your authoring</h3>
    <ul>
      <li><strong>Authoring unlocks in week 2.</strong> From day one you can adapt the
        basics, but drawing a play from scratch (the blank canvas) stays locked until a
        guided tutorial in week 2 — framed around countering your scouted opponent.</li>
      <li><strong>Squad discipline limits your playbook.</strong> How many set plays you
        can keep scales with your roster's Discipline — a rookie squad maintains one and
        masters it; a disciplined one keeps several.</li>
      <li><strong>Routes are gated per unit.</strong> An undisciplined unit holds its
        position only; more disciplined units can run one stop, then several, and the
        steadiest can run full routes with lurks (wait + watch at each stop). Train
        Discipline to widen what your squad can pull off.</li>
    </ul>
  </section>
  <section>
    <h3>v0.72.0 — Season weeks: training days, events &amp; autosave</h3>
    <ul>
      <li><strong>The season runs in weeks.</strong> Each week now flows training day →
        pre-match event → match → post-match event, across an 8-week season with a
        mid-season break at the halfway point. (Training and events are placeholders for
        now — the structure is in; the content lands next.)</li>
      <li><strong>Events alternate with intent.</strong> Most weeks build to a scripted
        beat with a result-reactive aftermath; the rest roll a random locker-room moment —
        but never two random weeks in a row, and never three scripted ones, so the rhythm
        stays varied.</li>
      <li><strong>Autosave + Continue.</strong> A season now spans many sittings, so progress
        saves automatically after each step. Pick up where you left off from <em>Continue</em>
        on the main menu.</li>
    </ul>
  </section>
  <section>
    <h3>v0.71.0 — Playbook: smarter routes (waypoints that wait + watch)</h3>
    <ul>
      <li><strong>Sequential waypoints.</strong> In Route mode each click drops the next
        waypoint in order, so a unit's flank reads left-to-right the way you draw it.</li>
      <li><strong>Hold &amp; watch at a waypoint.</strong> Each waypoint can carry a <em>wait</em>
        (ticks to hold there) and its own <em>watch</em> angle — so you can author real lurks and
        baits: creep to a spot, watch a lane, hold a beat, then swing. As ever, discipline decides
        how faithfully a unit runs it, and contact still pulls it into the fight.</li>
    </ul>
  </section>
  <section>
    <h3>v0.70.0 — Playbook: see paths, coverage, and dead ends</h3>
    <ul>
      <li><strong>Paths from spawn.</strong> Each unit's route from its spawn to its hold (through
        any waypoints you drew) is now drawn on the map, so you can see how the play actually
        unfolds — and a hold you can't reach gets a red ring.</li>
      <li><strong>Vision overlay.</strong> Toggle <em>👁 Vision</em> to shade everything your
        placed units can collectively see, given where they hold and what they watch. Dark gaps
        are blind spots — an instant read on whether your angles cover the map.</li>
    </ul>
  </section>
  <section>
    <h3>v0.69.0 — Playbook: your real squad + editable plays</h3>
    <ul>
      <li><strong>Your actual loadout.</strong> The units you place are now your real squad —
        including shotguns — instead of an assumed 4 rifles + 1 sniper, so a play is built for
        the team that runs it (rifle R, sniper S, shotgun G).</li>
      <li><strong>Edit saved plays.</strong> Hit <em>Edit</em> on any saved play to load it back
        onto the map, rearrange it, and update it in place — no more delete-and-redo.</li>
    </ul>
  </section>
  <section>
    <h3>v0.68.0 — Playbook: author plays on the map</h3>
    <ul>
      <li><strong>The Playbook is now visual.</strong> Instead of picking regions from menus,
        you author on the actual map: drag your five units onto the hexes they should hold
        (<em>Move</em>), aim each one's view cone (<em>Watch</em>), and sketch a flank/lurk path
        for them to take (<em>Route</em>). The old abstract editor is gone.</li>
      <li><strong>Routes are run on discipline.</strong> A drawn route is a plan, not a rail —
        a disciplined unit executes the flank faithfully, while a low-discipline one breaks off
        and takes the direct line. So discipline (and who you put on a trick play) matters, and
        units still react to contact instead of marching blindly. The coach reviews your map
        plays just like any other.</li>
    </ul>
  </section>
  <section>
    <h3>v0.67.0 — Playbook: build a play from scratch</h3>
    <ul>
      <li><strong>Author from a blank slate.</strong> The Playbook now has a <em>＋ Blank slate</em>
        option alongside the basics to adapt: start with five empty positions, set each one's
        region, and add directives (hold an angle, commit a site, trade for an ally, peek &
        retreat, read &amp; commit…) to compose a play entirely your own. The assistant coach
        reviews it the same way, so a from-scratch play still gets a viability read.</li>
    </ul>
  </section>
  <section>
    <h3>v0.66.0 — rivals get smarter as the season goes on</h3>
    <ul>
      <li><strong>Early opponents play dumber.</strong> Your first opponents don't reliably
        commit to their reads and barely counter your signature plays — room to learn the
        ropes. Their tactical sharpness ramps up match by match, so by the back end of the
        season they're committing their reads and punishing a one-note Playbook. (Raw skill
        still comes from their roster; this is purely how well they use their brains.)</li>
    </ul>
  </section>
  <section>
    <h3>v0.65.0 — match prep reads the rival's signature</h3>
    <ul>
      <li><strong>Prep scouting names their signature.</strong> When a rival is known for a
        signature play, the match-prep scouting report now names it and tells you what to
        counter it with — the same read the in-match Scout gives — instead of a raw label. The
        Win Outlook stays a team-strength estimate; the matchup is yours to read round by round.</li>
    </ul>
  </section>
  <section>
    <h3>v0.64.0 — rival teams have signature plays</h3>
    <ul>
      <li><strong>Scout the enemy's playbook.</strong> From your third match on, some opponents
        are known for a signature play of their own — a custom look they lean on. The Scout
        names it, tells you what it does, and points out its softest matchup so you can counter
        it, just like reading any other tendency.</li>
    </ul>
  </section>
  <section>
    <h3>v0.63.0 — opponents adapt to your signature play</h3>
    <ul>
      <li><strong>The AI reads your Playbook.</strong> Lean on a custom play across a match and
        the opponent starts tilting its picks toward whatever counters it — the same matchup
        the assistant coach measured. It's a soft adjustment, not a hard counter: your play
        still wins its good matchups, but spamming one signature gets punished, so mixing your
        looks matters. Only kicks in once you've authored and deployed a play.</li>
    </ul>
  </section>
  <section>
    <h3>v0.62.0 — Playbook: the assistant coach reviews your plays</h3>
    <ul>
      <li><strong>Save a play, get a read.</strong> When you save a play in the Playbook, an
        assistant coach quietly scrims it in the background and comes back with a verdict —
        is it viable, or a trap? — plus its character (what it beats, what beats it) and one
        tip to shore up its softest matchup. Saving stays instant; the read lands a few
        seconds later.</li>
      <li>The coach gives you a <em>feel</em>, not a spreadsheet — no win-percentage table, on
        purpose. Strategy is still a read: you decide when to deploy your play, the coach just
        tells you what it's good and bad against.</li>
    </ul>
  </section>
  <section>
    <h3>v0.61.0 — Playbook: adapt &amp; save your own plays</h3>
    <ul>
      <li><strong>Author a play.</strong> Between matches, hit <em>📋 Playbook</em> on the
        match-prep screen to clone any basic strategy and make it yours: retarget each slot's
        region and switch its directives on or off, give it a name, and save. Your plays carry
        through the season and show up in the round-by-round strategy menu alongside the
        built-ins.</li>
      <li>Saved plays run through the same engine as everything else, so a custom play behaves
        exactly as authored — no special-casing. (A measured matchup readout for your plays is
        coming next.)</li>
    </ul>
  </section>
  <section>
    <h3>v0.60.0 — watch the site you're taking</h3>
    <ul>
      <li><strong>Attackers face their objective.</strong> An attacker that had reached its
        site with no enemy in sight used to point its view cone back toward the enemy spawn —
        across the map, away from the site it had just pushed into. Now, with no read on the
        enemy, it watches the depth of the site it's attacking (where defenders hold), so it's
        looking at the angle it actually has to clear instead of the wrong way.</li>
    </ul>
  </section>
  <section>
    <h3>v0.59.0 — get shot, fight back</h3>
    <ul>
      <li><strong>Units react to taking fire.</strong> A unit shot from outside its view
        (e.g. a defender caught by a lurker mid-rotation) used to just keep walking, because
        it only ever fights enemies already in its cone and a bullet left no memory. Now being
        shot makes it stop and turn to face the shooter for a beat, so it actually spots the
        threat and trades instead of strolling to its death. Skipped for units already in a
        fight or committed to a site rush (a push shouldn't stall on every stray round).</li>
    </ul>
  </section>
  <section>
    <h3>v0.58.0 — units stop staring at walls</h3>
    <ul>
      <li><strong>Wall-aware facing.</strong> A unit settling on or moving to a position used to
        snap its view cone to the nearest hex direction with no terrain check, so ~1 in 4
        ended up pointing straight at an adjacent wall — seeing nothing. Now it picks the
        direction nearest its intended watch angle that actually sees open ground, so cones
        point down lanes instead of into walls (wall-facing 25% → ~0%).</li>
      <li><strong>Look where the enemy is.</strong> A unit with no specific angle to hold no
        longer defaults to staring at the centre of the enemy spawn; it watches the nearest
        spot its team last knew an enemy to be, so cones point at the actual threat instead of
        a fixed compass direction.</li>
      <li>Side effect of cleaner sightlines: the pushing side spots defenders a touch sooner, so
        attacks are slightly stronger across the board (~a few percent) — on the tighter maps
        this nudges the attack/defense split toward 50/50.</li>
    </ul>
  </section>
  <section>
    <h3>v0.57.0 — defenders hold smarter angles (Canyon)</h3>
    <ul>
      <li><strong>Defenders now set up on a real angle, not the middle of their zone.</strong>
        On Canyon, each defender's hold spot is now chosen for cover + a clean line of sight to
        the lane it's meant to watch, instead of the geometric centre of its region. Measured:
        defenders holding from cover went 85% → 98%, and the share that can actually see their
        assigned angle more than doubled (31% → 68%) — the fix for "they hold bad angles."
        Round outcomes are unchanged (balance-neutral); they just look like they know where to
        stand.</li>
    </ul>
  </section>
  <section>
    <h3>v0.56.0 — Back buttons + enemy paths stay hidden</h3>
    <ul>
      <li><strong>Back buttons</strong> on the campaign flow (intro, welcome, dashboard,
        Match Prep) — step back to the previous screen instead of the Menu button dumping
        you all the way to the main menu.</li>
      <li><strong>Enemy movement paths no longer show during the match.</strong> The yellow
        route trails are now your team's only — an opponent's planned path is future intent
        that fog should hide. (The dev "Enemies" toggle still reveals them.)</li>
    </ul>
  </section>
  <section>
    <h3>v0.55.0 — pre-season dashboard + a Match Prep screen</h3>
    <ul>
      <li><strong>New: a pre-season dashboard</strong> after the team talk — spend a tiny
        budget on a club upgrade or two (new rigs, an assistant coach, a bootcamp, a team
        lounge — each a small season-long boost), and review your squad before kickoff.</li>
      <li><strong>New: a Match Prep screen before every match.</strong> A head-to-head
        scouting report (your rating vs theirs, plus their scouted attack/defense leans) and
        three calls: <em>how to play</em> (cautious / standard / aggressive), your <em>in-game
        leader</em>, and a <em>pre-match team talk</em>. A <strong>Win Outlook %</strong>
        recalculates as you toggle each one, so you can see the trade-offs before you commit.
        It's a projection — the match is still played out round by round.</li>
    </ul>
  </section>
  <section>
    <h3>v0.54.0 — read the card on the draft, then set the tone</h3>
    <ul>
      <li><strong>"How to read a player card" is now built into the draft screen</strong>
        — a collapsible legend right above the pool (weapon, role vs hero, traits,
        attributes) instead of a pop-up that interrupts you.</li>
      <li><strong>New: a post-draft team talk.</strong> With your squad picked, you give
        your first message to the room and choose the club's early identity — <em>We
        hunt</em> (push harder), <em>Trust the plan</em> (more disciplined), or <em>Stay
        cool</em> (steadier in the clutch). It's a small, season-long lean on your whole
        roster.</li>
    </ul>
  </section>
  <section>
    <h3>v0.53.0 — a proper welcome + a rifle-first draft</h3>
    <ul>
      <li><strong>The campaign now opens on a welcome briefing</strong> after the intro —
        a one-page "how the game works" (read the opponent → counter → win the season), a
        few coaching tips, and your first steps — before you draft.</li>
      <li><strong>The draft pool is rifle-weighted.</strong> It used to roll sniper-heavy
        and leave you short of riflers; now you can always build a proper four-rifle,
        one-sniper squad.</li>
    </ul>
  </section>
  <section>
    <h3>v0.52.0 — scout the opponent before you pick</h3>
    <ul>
      <li><strong>Each campaign opponent is now a named team with a scoutable
        tendency.</strong> The Scout reads it from the very first round — "Crimson
        Vanguards lean Rush A" — with the tell and the counter, so your pick is a real
        read, not a blind gamble. Opponents lean their favoured strategy about two
        rounds in three, and when they run it they commit to their preferred site about
        six times in seven — so the site read actually pays off instead of being a coin
        flip. (The tutorial opponent's "Rush A" is now reliable, too.)</li>
    </ul>
  </section>
  <section>
    <h3>v0.51.0 — your players have names</h3>
    <ul>
      <li><strong>Every player now has a handle</strong> (Comet, Razor, Bolt …) shown on
        the draft card, the roster, and the unit panel — your squad reads as a team, not
        a set of slots. On the map, units are tagged with their handle's initials.</li>
      <li><strong>In the campaign, the enemy team is hidden during planning</strong> — you
        read them through the Scout, not by seeing their setup. (The "Enemies" toggle and
        the V overlay still reveal them.)</li>
      <li><strong>Units now sit where their plan puts them.</strong> When a strategy
        repositions your defenders (on the smart-spawn maps), they move there the moment
        you pick it — so the preview paths start from the players instead of trailing back
        to the spawn corner.</li>
    </ul>
  </section>
  <section>
    <h3>v0.50.0 — defenders move to the fight, not the corner</h3>
    <ul>
      <li><strong>Defenders collapsing or rotating onto a contested site now head to
        the near edge of it — the spot closest to them — instead of all funnelling to
        the site's far-corner centre.</strong> Before, a called rotation sent every
        defender sprinting across the map to the same hex: it looked chaotic and
        arrived late. Now they take the short path to their side of the site and
        spread out naturally, so retakes read clearly and land on time. Most visible
        on the tight maps (Canyon); the large-map defense (Foundry IV) keeps its
        existing smart-retake positioning.</li>
    </ul>
  </section>
  <section>
    <h3>v0.49.0 — campaign polish</h3>
    <ul>
      <li><strong>The campaign now runs on Canyon.</strong> Its tight, winding layout
        keeps unit movement legible — short rotations, forced contact — instead of the
        long cross-map wandering that made the larger maps frustrating to watch.</li>
      <li><strong>Units are labelled by id on the map</strong> (D1, A2 …) instead of a
        weapon letter, so you can tell who's where at a glance. Weapon, role and the
        rest are in the side panels and on hover.</li>
      <li><strong>The map picker is hidden during a season</strong> (it runs on one
        fixed map) and <strong>tutorial tips moved to the top of the screen</strong>,
        in the natural eye-line.</li>
      <li><strong>New draft tutorial: "How to read a player card."</strong> The first
        campaign draft opens an explainer that walks through every element of a recruit
        — weapon, role vs hero, traits, and attributes — with a live example card.
        Reopen it any time from the draft header.</li>
    </ul>
  </section>
  <section>
    <h3>v0.48.0 — the campaign opens</h3>
    <ul>
      <li><strong>Season is now a campaign.</strong> It opens on a short story — your
        local LAN café is about to close, so you pitch its owner on managing a team to
        win the circuit prize and save the shop — then a build-your-squad draft: pick 5
        players from a pool of 8, no co-drafting opponent.</li>
      <li><strong>The first match teaches the read.</strong> Your opening opponent is
        telegraphed — it Rushes one site head-on while attacking and sits in an even
        Hold while defending — so you can practise reading and countering before the
        real field arrives.</li>
      <li><strong>Strategies unlock as you go.</strong> Match 1 is the six basics
        (Execute / Rush / Control · Hold / Stack / Pressure); match 2 adds Mind Games
        (the fake-and-swing read, both sides); match 3 opens everything. The opponent
        ramps up in step with you.</li>
      <li><strong>New: an in-game Guidebook.</strong> Open it from the main menu or the
        "?" button any time — match flow, strategies, roles, traits, heroes, weapons,
        and how reading the opponent works, organised by topic. Light tooltips point the
        way during your first match.</li>
    </ul>
  </section>
  <section>
    <h3>v0.47.0 — main menu + Season mode</h3>
    <ul>
      <li><strong>The game now opens on a main menu</strong> — choose Season, Draft, or
        Standard, or open Settings (map + seed) and Patch notes. A "Menu" button in the top
        bar returns there any time.</li>
      <li><strong>New: Season</strong> — draft a roster once, then run a gauntlet of matches
        against generated opponents on Foundry II, carrying your squad the whole way. Win 4
        of 6 to make it. The pre-round Scout reads each opponent; opponent personalities and
        a between-match development choice are coming next.</li>
    </ul>
  </section>
  <section>
    <h3>v0.46.0 — the recap closes the read loop</h3>
    <ul>
      <li><strong>The round recap now tells you whether the Scout's read held</strong> —
        "The Scout called it: they stuck with Stack", or "They mixed it up: the Scout's
        lean was Stack, but they ran Rush." It closes the loop between your pre-round read
        and the result, so you learn how reliable your reads are.</li>
    </ul>
  </section>
  <section>
    <h3>v0.45.0 — Foundry IV is the default Foundry map</h3>
    <ul>
      <li><strong>The map picker now offers Foundry IV in place of Foundry II</strong>,
        and the game opens on it. Foundry IV is the large, diagonal layout the recent
        defense work (Mid Control, smart retakes) was built and balanced for. Foundry II
        is still in the build but no longer in the picker.</li>
    </ul>
  </section>
  <section>
    <h3>v0.44.0 — the round recap now tells you WHY</h3>
    <ul>
      <li><strong>The round-end screen opens with the matchup and how it was
        decided</strong> — e.g. "You played Stack (defender) vs their Rush (attacker)",
        then "Spike defused — defenders saved the round", then "Fighting centered on
        A site". A win or loss now reads as a lesson, not a dice roll — and it trains
        your own read for the next round (pairs with the pre-round Scout).</li>
    </ul>
  </section>
  <section>
    <h3>v0.43.0 — Scout report: read the enemy before you pick</h3>
    <ul>
      <li><strong>A Scout panel now sits above the strategy menu</strong> and reads the
        enemy's tendencies this match — e.g. "Stack — strongly favors, 67% of recent
        picks" — with a one-line tell and a counter hint, so your pre-round pick is a
        read instead of a coin flip. The first round of a match shows no read yet; the
        Scout builds one as the enemy's picks accumulate.</li>
      <li>The read can't lie — it reflects the picks the enemy actually made, not a
        scripted hint.</li>
      <li>Your first match opens with a short explainer of how reading works (no read
        yet); after you've seen a real read, it's just the enemy report from then on.</li>
    </ul>
  </section>
  <section>
    <h3>v0.42.0 — teams keep a running read of where you are</h3>
    <ul>
      <li><strong>Each team now maintains a live mental map of where its unseen
        enemies probably are</strong> — sightings persist and fade instead of being
        forgotten in seconds, and clearing an area now actually means something
        ("we can see A is empty, so they're at B"). This is the foundation for
        smarter reads across the game.</li>
      <li><strong>Control uses it:</strong> its site call now comes from that running
        read, so it commits more often and more sensibly — and showing it a lopsided
        defense reliably routes it at the lighter site.</li>
      <li><strong>Mind Games' ambush now springs properly:</strong> the show-site
        defenders collapse when the QUIET site gets hit, not only when they're
        contacted themselves. Before, an attacker that ignored the fake was met
        4-v-2 while the fakers idled at the empty site.</li>
    </ul>
  </section>
  <section>
    <h3>v0.41.0 — Foundry IV defenders set up smart retakes</h3>
    <ul>
      <li><strong>On Foundry IV, defenders converging on an attacked site now spread
        into covered positions with a line on the attackers' approach</strong> —
        instead of everyone piling onto the same center spot and getting traded out.
        Watch a retake: the collapse now sets up a crossfire across the site. Foundry
        IV only — its sites are big enough that positioning inside them matters; on
        the tighter maps the old direct convergence is still the right call (meeting
        the rush head-on beats taking a safe angle).</li>
    </ul>
  </section>
  <section>
    <h3>v0.40.0 — Control reads the defense</h3>
    <ul>
      <li><strong>The Control attack now probes both lanes, then commits its push to
        whichever site is held by fewer defenders</strong> — instead of passively
        holding mid. It punishes a lopsided defense (over-stack one site and Control
        takes the other). An even hold gives it nothing to read, so it stays a measured,
        info-first attack.</li>
    </ul>
  </section>
  <section>
    <h3>v0.39.0 — live unit stats on both sides during the match</h3>
    <ul>
      <li><strong>The match view now shows both teams' units in the side columns —
        your team on the left, the enemy on the right.</strong> Each unit has a live
        HP bar (green → amber → red), its current state (holding / moving / in fight /
        falling back / DEAD), weapon and role, plus a per-team alive count. Updates
        every tick, so you can read the round at a glance instead of hovering units
        one at a time. Hovering a unit still shows its full detail below the enemy column.</li>
    </ul>
  </section>
  <section>
    <h3>v0.38.0 — Foundry IV gets a defense built for its size</h3>
    <ul>
      <li><strong>New defender strategy on Foundry IV — Mid Control:</strong> three
        players garrison the central rotation hub while one anchors each site; whichever
        site gets hit, the hub floods it from short range. It's the dedicated answer to
        slow, methodical attacks (Control) on the big map, where an even split can't
        reinforce across the long A↔B rotation in time.</li>
      <li><strong>Pressure is no longer offered on Foundry IV.</strong> Pushing mid off
        spawn abandons too much ground on a map this large — there's no way back to a
        site once it's committed, so it lost nearly every round there. Pressure stays a
        solid pick on the smaller maps; Mid Control takes its place in Foundry IV's menu.</li>
    </ul>
  </section>
  <section>
    <h3>v0.37.0 — Rotate defense actually rotates now</h3>
    <ul>
      <li><strong>Rotate was badly broken — its defenders never actually rotated and
        bled out crossing the map, leaving sites undefended (attackers planted nearly
        every round).</strong> Fixed: they now hold their angle and swap sites as a
        pair when a teammate makes contact — a real mobile defense. It's gone from
        nearly unwinnable to a genuine pick (strong on the tight maps; still weak to
        fast direct hits, as intended).</li>
    </ul>
  </section>
  <section>
    <h3>v0.36.0 — Execute / Mind Games attackers peel for flankers</h3>
    <ul>
      <li><strong>On the Execute and Mind Games attacks, committed pushers now
        break off to deal with a defender flanking them from the mid choke or the
        near lane, instead of tunnelling straight to the plant.</strong> Rush is
        unchanged — it stays all-in and head-down. That sharpens the difference
        between the attacks: Execute trades a little plant speed for safety against
        mid/flank picks; Rush floods regardless.</li>
    </ul>
  </section>
  <section>
    <h3>v0.35.0 — point-blank awareness (no more walking past enemies)</h3>
    <ul>
      <li><strong>Units now sense an enemy within a couple of hexes even when
        facing away.</strong> Before, perception was strictly the vision cone, so
        two opponents could walk right past each other if their cones didn't happen
        to cross. A short-range proximity sense closes that blind spot — anyone who
        gets close (with line of sight) is noticed and can be engaged.</li>
    </ul>
  </section>
  <section>
    <h3>v0.34.0 — units turn to face who's shooting them</h3>
    <ul>
      <li><strong>A unit shot from outside its vision cone now turns to face the
        shooter — even when the shot misses.</strong> Before, a unit only reacted
        once it actually took damage, so it could be peppered with near-misses from
        the flank or behind and keep staring the wrong way. Now any incoming fire
        snaps the target around to look at its attacker, so it can spot them and
        return fire on the next tick.</li>
    </ul>
  </section>
  <section>
    <h3>v0.33.0 — lever rebalance (no single hero or trait swings a match)</h3>
    <ul>
      <li><strong>Hero and trait power levels were tuned down so that picking one
        is a meaningful identity choice, not a match-decider.</strong> Two heroes
        were over-tuned: <strong>Bulwark</strong>'s Fortify is weaker and shorter
        (it was strong enough to drag rounds into stalemate), and
        <strong>Angelic</strong>'s heal now restores a big chunk of health instead
        of a full heal (the full reset over-sustained pushes). On the trait side,
        the biggest mechanical edges were trimmed — <strong>Marksman</strong>,
        <strong>Flanker</strong>, and <strong>Aggressor</strong>'s combat bonuses
        are smaller. Every hero and trait now lands within a tight band, so the
        draft adds flavor and counterplay without handing anyone a free round.</li>
    </ul>
  </section>
  <section>
    <h3>v0.32.0 — Canyon reshaped (defendable B site)</h3>
    <ul>
      <li><strong>Canyon's layout was reworked, mainly to fix the B site.</strong>
        The old B was a one-way corner pocket: once attackers planted there,
        defenders had a single exposed approach and essentially never retook it.
        The site and its entry points were reshaped (with clearer choke / entry /
        main lanes) so a B retake is now winnable from more than one angle. Net
        effect: Canyon goes from heavily attacker-sided to a fair fight on both
        sites.</li>
    </ul>
  </section>
  <section>
    <h3>v0.31.0 — hero abilities reworked + a new defender hero</h3>
    <ul>
      <li><strong>The three hero actives were retuned to feel like real roles, and a
        fourth hero joins.</strong> <strong>Angelic</strong> is now a true medic:
        the first time a teammate in sight is hurt but survives, the Angelic rushes
        a step to them, heals them to full, and buffs their aim for a few ticks
        (replaces the old aura + rally). <strong>Techy</strong>'s Tactical Scan is
        now targeted — instead of revealing the whole map, it briefly reveals
        enemies lurking around the nearer bomb site, held until first contact.
        <strong>Cursed</strong>'s mark is now a hunt: it reveals the first enemy
        spotted and gives your team +HR/+HS against it until you damage it or the
        hunt times out (no more round-long wallhack). New hero
        <strong>Bulwark</strong> — a defensive anchor: a little extra max HP, and
        the first time it's hit, it and nearby allies harden up so enemies hit them
        less for a few ticks. Numbers are provisional and will be tuned with the
        broader balance pass.</li>
    </ul>
  </section>
  <section>
    <h3>v0.30.0 — heroes now have a signature move</h3>
    <ul>
      <li><strong>Heroes used to be flat, always-on passives. Now each one keeps a
        weaker passive AND gains a once-per-round active that fires automatically
        the moment a tactical condition is met.</strong> The active is where the
        hero earns its pick — it triggers at the right beat instead of doing the
        same thing every tick. <strong>Angelic</strong> — Guardian aura shrinks
        to 3 hex (passive); <strong>Rally</strong> fires on your team’s first
        death, steeling nearby allies to commit fights they’d otherwise flinch
        from (and hit harder) for a few ticks — it blunts the snowball after first
        blood. <strong>Techy</strong> — slightly wider vision cone (passive);
        <strong>Tactical Scan</strong> is now <em>held</em> until your team makes
        first contact, then reveals every enemy briefly so you commit with full
        info, instead of being wasted at spawn. <strong>Cursed</strong> — a small
        flat aim edge (passive); <strong>Mark Target</strong> is unchanged (the
        first enemy your team spots is marked all round). Exact numbers are
        provisional and will be tuned alongside roles and traits.</li>
    </ul>
  </section>
  <section>
    <h3>v0.29.0 — trait roster overhaul (tactical traits + personality)</h3>
    <ul>
      <li><strong>The old three-pool trait system (skill / behavioral /
        personality) is gone. Every unit now draws two distinct
        <em>tactical traits</em> from one pool, plus a single
        <em>personality</em>.</strong> The old pools were a third dead and full
        of near-duplicates; this collapses them into eight clean, distinct
        levers that each span attack and defense play.
        <strong>Tactical traits:</strong> <strong>Aggressor</strong> (picks
        fights, never retreats, hunts after the plant),
        <strong>Anchor</strong> (holds position, deadly while set),
        <strong>Freelancer</strong> (goes off-plan for the solo play),
        <strong>Disciplined</strong> (executes the called strategy),
        <strong>Flanker</strong> (perimeter routes, lurks until it fires),
        <strong>Trader</strong> (sharper right after an ally shoots),
        <strong>Marksman</strong> (a flat aim edge — the prized one),
        <strong>Clutch</strong> (rises when last alive).</li>
      <li><strong>Personalities</strong> — <strong>Firebrand</strong>,
        <strong>Catalyst</strong>, <strong>Analyst</strong>,
        <strong>Stabilizer</strong> (extroversion × task/people) — give only a
        small in-match stat nudge for now. Their real weight arrives with the
        team-management layer (locker-room chemistry, sponsors, quests).</li>
    </ul>
  </section>
  <section>
    <h3>v0.28.0 — one strategy menu for every roster</h3>
    <ul>
      <li><strong>Strategies are no longer locked behind specific traits — every
        team picks from the same consolidated menu.</strong> The old system
        expanded your menu based on which traits your units happened to roll, and
        most of those unlocks were near-duplicate "hold deeper" / "rush variant"
        plays. We trimmed those and kept the genuinely distinct ones. Defenders:
        Hold, Stack, Pressure, <strong>Mind Games</strong> (show one site, swing
        the other), <strong>Coordinated Lockdown</strong> (stack all five on one
        site), <strong>Rotate</strong> (rotating mobile defense). Attackers:
        Execute, Rush, Control, <strong>Mind Games</strong>. Earning new strategies
        will return later through the management/progression layer rather than
        trait luck.</li>
    </ul>
  </section>
  <section>
    <h3>v0.27.0 — roles now play differently (positioning + posture)</h3>
    <ul>
      <li><strong>A unit's role used to be just an aggression number, so a Warden
        and a Vanguard holding the same spot played identically. Now role shapes
        WHERE a unit sets up and HOW it fights — and it adapts to the side you're
        on.</strong> <strong>Vanguard</strong> sets up forward and takes the entry
        duel on attack, and peeks aggressively for info on defense.
        <strong>Warden</strong> anchors deep in a crossfire on defense (two Wardens
        on a site fan apart so an attacker is caught from two angles) and plays
        disciplined support on attack — never dead weight. <strong>Tactician</strong>
        and <strong>Specialist</strong> stay flexible. Stacking the same role still
        works — you just get a lopsided setup (e.g. no frontline) — and units never
        pile onto the same spot. This is the foundation for the trait and hero
        reworks coming next; the exact numbers are still being tuned.</li>
    </ul>
  </section>
  <section>
    <h3>v0.26.0 — Hot Head and Ego now play differently</h3>
    <ul>
      <li><strong>Ego and Hot Head used to be the exact same trait under two
        names — now they're distinct.</strong> Both simply lowered a unit's bar
        for picking fights. Now <strong>Hot Head</strong> stays the on-sight
        aggressor (peeks and takes duels readily), while <strong>Ego</strong> is
        the high-ceiling <em>freelancer</em> — it ignores the team plan more
        often, breaking off its assigned hold or angle to do its own thing. On
        defense that freelancing tends to backfire (an Ego player abandons a good
        angle and gets caught out), matching the "talented but uncoachable"
        archetype. The overall <em>magnitude</em> of aggressive traits is still
        being tuned and will land in the upcoming trait/role/hero rebalance.</li>
    </ul>
  </section>
  <section>
    <h3>v0.25.0 — skill wins fights, it no longer picks them</h3>
    <ul>
      <li><strong>A unit's aim and skill traits no longer secretly make it take
        more fights — only win the ones it takes.</strong> The AI decided whether
        to commit to a duel from a unit's full combat power, so a high-aim or
        skill-trait player saw better odds and peeked far more often. On maps
        where a defender should hold their angle, that over-peeking backfired —
        so a "+aim" trait could swing a map's win rate wildly, flip sign between
        maps, and even make a side <em>worse</em>, with no consistent value. Now
        the commit decision reads mostly the tactical matchup (weapon, range,
        cover, numbers) while skill still decides who <em>wins</em> the fight, so
        traits behave far more predictably. Skill counts at half-weight in the
        decision — going fully neutral over-corrected and made the AI ignore
        genuinely strong opponents. Groundwork for rebalancing roles, heroes, and
        traits next.</li>
    </ul>
  </section>
  <section>
    <h3>v0.24.0 — Atoll II rebuilt</h3>
    <ul>
      <li><strong>Atoll II is a real map now.</strong> It replaces the old
        placeholder skeleton with a full layout: two corner sites, each with a
        deep anchor and an off-angle for crossfire and <em>two</em> watched
        entries (one from the main lane, one from the flank), a central mid spine
        and courtyard, and cover spread through the lanes. Defenders set up closer
        together so they can actually rotate between sites in time. It lifts the
        defense from ~31% to ~38% round win rate — still the toughest map for
        defenders, with more to come.</li>
    </ul>
  </section>
  <section>
    <h3>v0.23.0 — longer fuse (30 ticks)</h3>
    <ul>
      <li><strong>The spike now takes 30 ticks to detonate (up from 25).</strong>
        Even with defenders collapsing onto the contested site, cross-map retakes
        kept arriving right as the spike went off — there wasn't enough time after
        a plant to rotate in and defuse. A longer fuse fixes that and is closer to
        real tactical shooters, where the post-plant window is several times a
        rotation. It lifts the defense on every map; we keep the timer identical
        across all maps for consistency, and will rebalance individual maps by
        other means if one ends up too defender-friendly.</li>
    </ul>
  </section>
  <section>
    <h3>v0.22.0 — defenders collapse onto the site under attack</h3>
    <ul>
      <li><strong>When defenders read which site the attackers are committing to,
        the off-site defenders now rotate in to meet them.</strong> The old
        defense set up across both sites and mid and then mostly stayed put — so
        the attackers, who pick one site and hit it together, kept arriving a
        man up while three defenders sat alive on the other side of the map. Now,
        once the defense collectively sees enough attackers piling onto a site,
        the players not holding it converge to defend or retake it — while one
        watcher stays back on the quiet site so a fake-and-switch can't stroll in
        for a free plant. It's a big step toward fixing defenders being
        chronically outnumbered at the bombsite — they still arrive a little
        short, but far less than before.</li>
    </ul>
  </section>
  <section>
    <h3>v0.21.0 — longer fuse, more time to retake</h3>
    <ul>
      <li><strong>The spike now takes longer to detonate (25 ticks, up from 20).</strong>
        Defenders were too attacker-favored on every map — and the root cause is
        positional: attackers concentrate on one site while defenders have to
        cover the whole map, so the defense keeps arriving at the bombsite a step
        late. A longer fuse gives the defense more time to rotate in and retake.
        It's a partial fix (more is coming for how defenders rotate and hold), but
        on its own it measurably swings rounds back toward the defense — most of
        all on Canyon, where retakes were landing right as the spike went off.</li>
    </ul>
  </section>
  <section>
    <h3>v0.20.0 — a cornered aggressive defender fights before defusing</h3>
    <ul>
      <li><strong>When an aggressive or Ego defender is the last one alive, it
        clears the attacker before committing to the spike.</strong> Since a
        defuser can't shoot (v0.19.0), a hot-headed defender alone in a 1v1 retake
        used to just die on the hex. Now — with no teammate left to trade for it,
        and only if there's still time to win the duel and then defuse — it hunts
        the attacker down first and defuses once the area is clear. With teammates
        still up, the coordinated retake runs as before; calmer, disciplined
        defenders go straight for the defuse; and when the detonation clock gets
        tight, everyone commits to the defuse regardless — ego never costs you the
        round on the timer.</li>
    </ul>
  </section>
  <section>
    <h3>v0.19.0 — planting and defusing are real commitments</h3>
    <ul>
      <li><strong>A unit planting or defusing can no longer move or shoot while
        the timer runs.</strong> Previously a defuser sitting on the spike could
        trade shots to defend itself; now it's locked in place and exposed — so a
        defuse is a genuine gamble you have to clear the area for first. The same
        applies to the planter. <strong>Defuse time drops from 4 ticks to 3</strong>
        to partly offset the added risk.</li>
      <li><strong>Discipline decides whether a unit commits.</strong> When a unit
        already on the spike is shot down to its last health, whether it holds and
        finishes under fire or bails depends on its Tenacity and Composure — gritty
        players clutch the defuse, flaky ones run. Stepping onto the spike is now a
        decision with real follow-through.</li>
    </ul>
  </section>
  <section>
    <h3>v0.18.0 — Canyon reworked (v3)</h3>
    <ul>
      <li><strong>Canyon's geometry was reshaped to give the defense a fighting
        chance.</strong> Both sites were expanded and given more cover to hold
        from, and several chokes were narrowed so defenders can actually anchor an
        angle instead of getting overrun the instant attackers arrive. The dense
        old layout left defenders bottom-of-the-pack; the rework lifts their
        average round win rate from ~19% to ~24%, with Hold now trading evenly vs
        a straight Execute and Pressure hard-countering Control. Fast Rush pushes
        are still the open problem against a static hold.</li>
    </ul>
  </section>
  <section>
    <h3>v0.17.0 — defenders retake and defuse</h3>
    <ul>
      <li><strong>Defenders now actually retake the spike.</strong> After a plant,
        one defender commits to the defuse while the rest hold covered angles to
        trade for them — previously defenders never attempted a defuse, handing
        attackers free detonations even when defenders were alive and ahead. This
        swings post-plant rounds back toward the defense on the open maps (Foundry
        II / Atoll II ~+3pp each). Canyon's dense layout makes retakes arrive too
        late regardless — a known gap we'll tackle separately.</li>
    </ul>
  </section>
  <section>
    <h3>v0.16.0 — map roster trimmed to the live three</h3>
    <ul>
      <li><strong>Foundry and Atoll (the originals) retired from the picker.</strong>
        They were one-dimensional and superseded by the Foundry II / Atoll II
        redesigns. The picker now shows <strong>Foundry II, Atoll II, Canyon</strong>,
        and the game opens on Foundry II. The old maps still exist in the build,
        just aren't selectable.</li>
    </ul>
  </section>
  <section>
    <h3>v0.15.0 — units stop watching their own backfield</h3>
    <ul>
      <li><strong>Holding units now watch the right way.</strong> A defender
        pushed forward into a lane was sometimes told to watch a region behind it
        (e.g. hold deep in A-main but face A-site), so it stared back at ground it
        had already passed instead of the direction attackers actually come from —
        and got caught looking the wrong way. Units now ignore a hold-angle that
        points behind them and watch the threat approach instead (a tracked enemy
        still overrides — if someone really is behind you, you turn). Sideways
        lane and off-angle watches are unchanged. With longer fights (v0.14.0),
        seeing the enemy first matters more, so this is a real edge.</li>
    </ul>
  </section>
  <section>
    <h3>v0.14.0 — longer fights, tactics matter more</h3>
    <ul>
      <li><strong>Units now have 4 HP (was 3).</strong> Fights last a beat
        longer — one extra rifle body-hit to down someone (snipers are unchanged:
        still a one-shot headshot / two-shot body). This isn't a shooter-y HP
        bump; it opens room for trades, refrags, and mid-fight repositioning, so
        a round is decided by team play and angles, not just who has the best aim
        in the first exchange.</li>
      <li><strong>Aim is a little less swingy.</strong> Raw aim still wins
        gunfights and is the #1 attribute — but it no longer dwarfs everything
        else, so Game Sense, positioning, and especially Leadership/trading now
        carry real weight. Drafting a great aimer still pays; drafting a great
        <em>team</em> now also pays.</li>
      <li><strong>Fixed:</strong> a long-standing bug silently capped every unit
        at 3 HP regardless of the configured value (Guardian Aura housekeeping
        used a hard-coded base) — so HP tuning had no effect until now.</li>
    </ul>
  </section>
  <section>
    <h3>v0.13.0 — Leadership matters (team trades)</h3>
    <ul>
      <li><strong>Comms / Leadership is now a real attribute.</strong> When a
        teammate has just fired — a fight to trade into — every unit's hit chance
        shifts by its Leadership: high-Leadership rosters convert trades, low ones
        fumble them. At 5v5 (unlike 3v3, where team coordination was inert) this
        swings rounds by ~9–10pp for a high-Leadership team. Drafting for
        Leadership now pays off; it has no effect at the flat-50 debug baseline.</li>
    </ul>
  </section>
  <section>
    <h3>v0.12.0 — two new 5v5 maps</h3>
    <ul>
      <li><strong>Foundry II + Atoll II</strong> are selectable from the map
        toggle — ground-up redesigns of the old one-dimensional layouts, built on
        the richer region vocabulary (site entries/anchors/off-angles, near/far
        lane splits, a real mid choke, and rotational connectors). Foundry II
        plays close to balanced; Atoll II is still attacker-leaning and a work in
        progress. Both now have a first pass of cover. The originals remain for
        comparison.</li>
      <li><strong>Map picker polish.</strong> The map toggle shows tidier labels
        and a one-line description of each map on hover.</li>
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
