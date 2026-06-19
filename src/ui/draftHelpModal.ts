// "How to read a player card" — the draft tutorial, rendered as an always-visible
// legend panel inside the draft screen (no longer a pop-up). Static content; the
// live pool cards are the worked examples. Distinguishes role vs hero explicitly.

export function draftCardLegendHtml(): string {
  return `
    <div class="draft-help">
      <p class="dh-intro">Each card in the pool is a scouting report on one recruit. Here's how to read one — and hover any chip for its own description.</p>
      <dl class="dh-legend">
        <dt>Weapon</dt>
        <dd><strong>Rifle</strong> is the all-rounder (good at mid-range), <strong>Sniper</strong> is deadly at range once set but weak on the move, <strong>Shotgun</strong> is lethal up close. Aim for roughly four riflers + one sniper.</dd>

        <dt>Role <span class="dh-vs">— how they play every round</span></dt>
        <dd>Where a player sets up and how readily they fight. <strong>Vanguard</strong> pushes first and takes the entry duel; <strong>Tactician</strong> plays the mid-game and trades; <strong>Warden</strong> anchors a site and holds from cover; <strong>Specialist</strong> flexes to the plan.</dd>

        <dt>Hero <span class="dh-vs">— one signature moment per round</span></dt>
        <dd>A different axis from role: role is their <em>every-round</em> style, hero is <em>one big ability</em> that fires once when its moment comes. <strong>Angelic</strong> heals a hurt teammate; <strong>Techy</strong> scans enemies near a site; <strong>Cursed</strong> marks the first enemy spotted; <strong>Bulwark</strong> shields itself and nearby allies when first hit.</dd>

        <dt>Tactical traits (two)</dt>
        <dd>Concrete combat / behaviour edges — e.g. <strong>Marksman</strong> (flat aim bonus), <strong>Anchor</strong> (deadlier once it settles), <strong>Aggressor</strong> (takes more duels, never retreats), <strong>Clutch</strong> (surges when last alive).</dd>

        <dt>Personality (one)</dt>
        <dd>Flavour for now — a small stat nudge. The locker-room layer (chemistry, morale) reads it once the management side lands.</dd>

        <dt>Attributes</dt>
        <dd><strong>Mechanics</strong> (shooting), <strong>Game Sense</strong> (perception), <strong>Discipline</strong> (sticks to the plan under fire), <strong>Improvisation</strong> (clutch under stress), <strong>Leadership</strong> (converts team trades).</dd>
      </dl>
      <p class="dh-foot">There's no perfect pick — a couple of riflers, a sniper, and complementary roles is a fine start.</p>
    </div>`;
}
