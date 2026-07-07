// "How to read a player card" — the draft tutorial, rendered as an always-visible
// legend panel inside the draft screen (no longer a pop-up). The Weapon / Role /
// Hero / trait / personality terms render as the EXACT SAME chips the pool cards
// use (same colours, borders, hover tooltips), so the instructions and the live
// cards read as one consistent language.

import type { Hero, Role, Weapon } from '../game/types.ts';
import { ROLE_DESCRIPTIONS, PERSONALITIES } from '../game/config.ts';
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

// The five visible aggregate stats — one-line glosses. Shared by the season-draft
// legend AND that board's hover tooltips so the two never drift.
export const AGG_BLURB: Record<string, string> = {
  mechanics: 'raw shooting — aim and headshots.',
  gameSense: 'perception — reading the map and the enemy.',
  discipline: 'sticking to the plan under fire.',
  improvisation: 'staying clutch when it goes sideways.',
  leadership: 'turning team play into trades and won rounds.',
};

// Weapon one-liners (the new board shows a weapon chip but no description).
export const WEAPON_BLURB: Record<Weapon, string> = {
  rifle: 'the all-rounder, strong at mid-range. Aim for about four.',
  sniper: 'deadly at range once set, weak on the move. One is plenty.',
  shotgun: 'lethal up close, useless at distance.',
};

// Fuller, plain-language hero write-ups for the reference (the board's inline line
// + chip tooltip use the terser HERO_DESCRIPTIONS from config; this is the "tell me
// properly" version — passive + the once-a-round active, in words a new manager reads).
export const HERO_BLURB: Record<Hero, string> = {
  Angelic: 'the medic. Once a round, when a teammate in sight is hurt but survives, the Angelic dashes over, heals a big chunk of their health, and sharpens their aim for a moment. Pure support — keeps your carries alive.',
  Techy: 'the eyes. Always sees a touch wider; and once contact starts, briefly reveals enemies lurking around the near site — targeted intel for your hit or your hold.',
  Cursed: 'the hunter. A small always-on aim edge; and it marks the first enemy your team spots, so everyone hits that target harder until you damage it or the mark fades. Turns a pick into a kill.',
  Bulwark: 'the wall. A little extra health always; and the first time it takes a hit, the Bulwark and nearby allies harden up — enemies deal less to them for a few seconds. A defensive anchor.',
};

// A "how to read a recruit" legend for the BG3-style season draft board. Covers
// weapon / role / hero / personality / the five stats. Each section is wrapped in a
// .dh-sec so the board's CSS can flow them into two columns (it was too tall as one).
// (Authored recruits carry no tactical trait, so that's still omitted.) Reuses the
// shared .draft-help / .dh-* markup so it matches the other legend.
export function recruitLegendHtml(): string {
  const roles: Role[] = ['Vanguard', 'Tactician', 'Warden', 'Specialist'];
  const heroes: Hero[] = ['Angelic', 'Techy', 'Cursed', 'Bulwark'];
  const persons = ['Firebrand', 'Catalyst', 'Analyst', 'Stabilizer'];
  const stats: [string, string][] = [
    ['Mechanics', AGG_BLURB.mechanics], ['Game Sense', AGG_BLURB.gameSense],
    ['Discipline', AGG_BLURB.discipline], ['Improvisation', AGG_BLURB.improvisation],
    ['Leadership', AGG_BLURB.leadership],
  ];
  const item = (name: string, desc: string): string => `<li><b>${name}</b> <span class="dh-sub-desc">— ${desc}</span></li>`;
  const sec = (title: string, vs: string, lis: string): string =>
    `<div class="dh-sec"><dt>${title}${vs ? ` <span class="dh-vs">— ${vs}</span>` : ''}</dt><dd><ul class="dh-sub">${lis}</ul></dd></div>`;
  const roleGloss = (r: Role): string => ROLE_DESCRIPTIONS[r].replace(/^Aggression \d+ — /, '');
  return `
    <div class="draft-help">
      <p class="dh-intro">Every recruit is a scouting report. Here's what each part means — or just hover any chip or stat on a recruit for the same note.</p>
      <dl class="dh-legend">
        ${sec('Weapon', '', (['rifle', 'sniper', 'shotgun'] as Weapon[]).map((w) => item(WEAPON_NAME[w], WEAPON_BLURB[w])).join(''))}
        ${sec('Role', 'how they play every round', roles.map((r) => item(r, roleGloss(r))).join(''))}
        ${sec('Hero', 'a once-a-round signature ability', heroes.map((h) => item(h, HERO_BLURB[h])).join(''))}
        ${sec('Personality', 'temperament; drives morale + how they take events', persons.map((p) => item(p, PERSONALITIES[p].description)).join(''))}
        ${sec('The five stats', 'the bars are zoomed, so specialists stand out', stats.map(([l, d]) => item(l, d)).join(''))}
      </dl>
      <p class="dh-foot">There's no perfect pick — a couple of riflers, a sniper, and complementary roles is a fine start.</p>
    </div>`;
}
