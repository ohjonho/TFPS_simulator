// "How to read a player card" — the draft tutorial, rendered as an always-visible
// legend panel inside the draft screen (no longer a pop-up). The Weapon / Role /
// Hero / trait / personality terms render as the EXACT SAME chips the pool cards
// use (same colours, borders, hover tooltips), so the instructions and the live
// cards read as one consistent language.

import type { Hero, Role, Weapon } from '../game/types.ts';
import { roleChip, heroChip } from './unitMetaChip.ts';
import { traitSpan } from './traitChip.ts';

const WEAPON_NAME: Record<Weapon, string> = { rifle: 'Rifle', sniper: 'Sniper', shotgun: 'Shotgun' };

// A weapon chip styled exactly like the pool card's (`.pool-card-weapon`).
function weaponChip(w: Weapon): string {
  return `<span class="pool-card-weapon weapon-${w}">${WEAPON_NAME[w]}</span>`;
}

// One labelled sub-bullet: <chip> — description.
function sub(chip: string, desc: string): string {
  return `<li>${chip} <span class="dh-sub-desc">— ${desc}</span></li>`;
}

export function draftCardLegendHtml(): string {
  const weapons: [Weapon, string][] = [
    ['rifle', 'the all-rounder, strong at mid-range. Aim for about four of these.'],
    ['sniper', 'deadly at range once set, but weak on the move. One is plenty.'],
    ['shotgun', 'lethal up close, useless at distance.'],
  ];
  const roles: [Role, string][] = [
    ['Vanguard', 'pushes first and takes the entry duel.'],
    ['Tactician', 'plays the mid-game and trades.'],
    ['Warden', 'anchors a site and holds from cover.'],
    ['Specialist', 'flexes to whatever the plan needs.'],
  ];
  const heroes: [Hero, string][] = [
    ['Angelic', 'heals a hurt teammate.'],
    ['Techy', 'scans for enemies near a site.'],
    ['Cursed', 'marks the first enemy spotted.'],
    ['Bulwark', 'shields itself and nearby allies when first hit.'],
  ];
  return `
    <div class="draft-help">
      <p class="dh-intro">Each card in the pool is a scouting report on one recruit. The chips below are the same ones you'll see on every card — hover any chip for its own description.</p>
      <dl class="dh-legend">
        <dt>Weapon</dt>
        <dd><ul class="dh-sub">${weapons.map(([w, d]) => sub(weaponChip(w), d)).join('')}</ul></dd>

        <dt>Role <span class="dh-vs">— how they play every round</span></dt>
        <dd><ul class="dh-sub">${roles.map(([r, d]) => sub(roleChip(r), d)).join('')}</ul></dd>

        <dt>Hero <span class="dh-vs">— one signature moment per round</span></dt>
        <dd>A different axis from role: role is their <em>every-round</em> style; the hero is <em>one big ability</em> that fires once when its moment comes.
          <ul class="dh-sub">${heroes.map(([h, d]) => sub(heroChip(h), d)).join('')}</ul></dd>

        <dt>Tactical trait <span class="dh-vs">— one concrete combat edge</span></dt>
        <dd>Each recruit has a single standout trait — ${traitSpan('Marksman', 'skill')} (flat aim bonus), ${traitSpan('Anchor', 'skill')} (deadlier once it settles), ${traitSpan('Aggressor', 'skill')} (takes more duels, never retreats), ${traitSpan('Clutch', 'skill')} (surges when last alive), and more.</dd>

        <dt>Personality <span class="dh-vs">— one of four temperaments</span></dt>
        <dd>${traitSpan('Firebrand', 'personality')}, ${traitSpan('Catalyst', 'personality')}, ${traitSpan('Analyst', 'personality')}, ${traitSpan('Stabilizer', 'personality')}. Drives morale, how they react to events, and the flight-risk beats — the management layer reads it now, so it's a real consideration, not just flavour.</dd>

        <dt>Attributes</dt>
        <dd><strong>Mechanics</strong> (shooting), <strong>Game Sense</strong> (perception), <strong>Discipline</strong> (sticks to the plan under fire), <strong>Improvisation</strong> (clutch under stress), <strong>Leadership</strong> (converts team trades).</dd>
      </dl>
      <p class="dh-foot">There's no perfect pick — a couple of riflers, a sniper, and complementary roles is a fine start.</p>
    </div>`;
}
