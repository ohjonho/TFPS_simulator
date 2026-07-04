// The 12 authored ORIGIN characters — the season draft pool (pick 5 of 12).
// Replaces the procedural generatePool for the season path only (standalone
// draft/match modes stay procedural). Each carries a tuned attribute spread, a
// personality/role/hero/weapon/trait identity, starting story-tag THORN(s), and
// hidden narrative descriptors (event/dialogue eligibility — see game/storyTags).
// Arc beats (triggers/effects/epilogue) live in the arc registry (later phase);
// `arcId` is the link.
//
// Overall power is deliberately compressed to ~44–51 (centred just below the 50
// procedural-opponent average) so the squad starts as scrappy underdogs and grows
// over the season. Peaks ~62 / floors ~36 give each a spiky identity without
// warping balance. `characterId` rides through finalizeDraft so the arc runtime
// can find the unit later.

import type {
  Attributes, Hero, Modifiers, Personality, Role, TacticalTrait, Unit, Weapon,
} from '../types.ts';
import type { Rng } from '../rng.ts';
import { UNIT_DEFAULTS } from '../config.ts';
import { rollUnitMeta } from '../attributes.ts';

export interface CharacterDef {
  id: string;
  realName: string;
  username: string;
  prevName?: string;
  age: number;
  bio: string;                 // one-line hook (draft card / dossier)
  personality: Personality;
  role: Role;
  hero: Hero;
  weapon: Weapon;
  tacticalTraits: TacticalTrait[];
  storyTags: string[];         // starting THORN tag(s) (StoryTagId); [] if the thorn is a low stat
  attributes: Attributes;      // final 10 subs (authored, not rolled)
  descriptors: string[];       // hidden narrative flags — event/dialogue eligibility, never a stat
  arcId: string;               // link to the arc registry (later phase)
  tier: 'origin';
}

// aim, headshot, reflexes, weaponAffinity | vision, mapIQ | tenacity | composure, adaptability | comms
const A = (
  aim: number, headshot: number, reflexes: number, weaponAffinity: number,
  vision: number, mapIQ: number, tenacity: number,
  composure: number, adaptability: number, comms: number,
): Attributes => ({ aim, headshot, reflexes, weaponAffinity, vision, mapIQ, tenacity, composure, adaptability, comms });

export const AUTHORED_ORIGINS: readonly CharacterDef[] = [
  {
    id: 'moony', realName: 'Shiro Toshiyuki', username: 'Moony', prevName: 'Sunny', age: 26,
    bio: "Benched-then-cut ex-pro hiding under a pseudonym at the café, haunted by a 'clutch curse'.",
    personality: 'Analyst', role: 'Tactician', hero: 'Techy', weapon: 'rifle',
    tacticalTraits: ['Marksman'], storyTags: ['anti-Clutch'],
    attributes: A(56, 54, 50, 54, 52, 54, 50, 46, 48, 46),
    descriptors: ['Veteran', 'ex-Pro'], arcId: 'moony-curse', tier: 'origin',
  },
  {
    id: 'mommamay', realName: 'May Jacobs', username: 'MommaMay', age: 38,
    bio: "Bank manager and mum of three — the family's best player, a natural leader stretched thin by real life.",
    personality: 'Stabilizer', role: 'Warden', hero: 'Bulwark', weapon: 'rifle',
    tacticalTraits: ['Anchor'], storyTags: ['Busy'],
    attributes: A(46, 44, 44, 48, 47, 49, 48, 52, 54, 60),
    descriptors: ['Mother', 'Older', 'Warm', 'Banker'], arcId: 'may-imposter', tier: 'origin',
  },
  {
    id: 'ronin', realName: 'Samuel Sapper', username: 'R0nin', prevName: 'S4murai', age: 22,
    bio: 'Reformed teenage battle-royale cheater, now a shy lit-grad librarian giving competition an honest second try.',
    personality: 'Analyst', role: 'Specialist', hero: 'Cursed', weapon: 'rifle',
    tacticalTraits: ['Trader'], storyTags: [],
    attributes: A(60, 56, 56, 54, 38, 36, 52, 44, 42, 44),
    descriptors: ['ex-Pro', 'young', 'ex-cheater'], arcId: 'ronin-past', tier: 'origin',
  },
  {
    id: 'potter', realName: 'Harry Frankel', username: 'Potter', age: 26,
    bio: 'Ex-broadcast analyst who left the desk to finally play — elite reads, hands a step behind the kids.',
    personality: 'Analyst', role: 'Tactician', hero: 'Techy', weapon: 'sniper',
    tacticalTraits: ['Anchor'], storyTags: [],
    attributes: A(42, 42, 38, 44, 56, 56, 50, 52, 56, 52),
    descriptors: ['Older', 'Smart', 'Vocal'], arcId: 'potter-rival', tier: 'origin',
  },
  {
    id: 'echo', realName: 'Mateo Reyes', username: 'Echo', age: 18,
    bio: 'Younger brother of a big-league star, desperate to step out of her shadow.',
    personality: 'Firebrand', role: 'Specialist', hero: 'Bulwark', weapon: 'shotgun',
    tacticalTraits: ['Clutch'], storyTags: [],
    attributes: A(54, 50, 58, 48, 42, 40, 44, 40, 46, 44),
    descriptors: ['young'], arcId: 'echo-shadow', tier: 'origin',
  },
  {
    id: 'reina', realName: 'Maria Hernandez', username: 'Reina', age: 17,
    bio: 'Cocky mechanical prodigy who thinks she reigns over any lobby — until better teams punish her recklessness.',
    personality: 'Firebrand', role: 'Vanguard', hero: 'Cursed', weapon: 'rifle',
    tacticalTraits: ['Aggressor'], storyTags: [],
    attributes: A(62, 58, 60, 52, 44, 42, 36, 40, 40, 42),
    descriptors: ['young'], arcId: 'reina-hubris', tier: 'origin',
  },
  {
    id: 'cardo', realName: 'Riccardo Pensa', username: 'Cardo', age: 24,
    bio: "High-caliber all-rounder, quietly restless — good at everything, sure he's meant for something more specific.",
    personality: 'Stabilizer', role: 'Vanguard', hero: 'Angelic', weapon: 'rifle',
    tacticalTraits: ['Clutch'], storyTags: [],
    attributes: A(50, 48, 50, 52, 50, 52, 50, 50, 52, 50),
    descriptors: [], arcId: 'cardo-role', tier: 'origin',
  },
  {
    id: 'jok3r', realName: 'Wanxiao Kai', username: 'Jok3r', age: 20,
    bio: 'Chatty team-content creator, insane with a sniper and allergic to discipline; jokes through every loss.',
    personality: 'Catalyst', role: 'Warden', hero: 'Angelic', weapon: 'sniper',
    tacticalTraits: ['Freelancer'], storyTags: [],
    attributes: A(60, 56, 52, 56, 44, 42, 36, 48, 50, 50),
    descriptors: ['Content Creator'], arcId: 'jok3r-competitor', tier: 'origin',
  },
  {
    id: 'topf', realName: 'Christopher Tan', username: 't0ph', age: 30,
    bio: 'Six years into banking and a decade in soloqueue — a ranked demon tired of carrying strangers.',
    personality: 'Stabilizer', role: 'Specialist', hero: 'Bulwark', weapon: 'sniper',
    tacticalTraits: ['Anchor'], storyTags: [],
    attributes: A(58, 52, 52, 52, 46, 48, 50, 50, 48, 38),
    descriptors: ['Ranked Demon', 'Banker'], arcId: 'topf-deal', tier: 'origin',
  },
  {
    id: 'yahyo', realName: 'Aaliyah Young', username: 'Yahyo', age: 25,
    bio: 'Ex-Girlaxy Gamers — a sneaky shotgun trapper who guards her heart after losing a team she loved.',
    personality: 'Firebrand', role: 'Warden', hero: 'Cursed', weapon: 'shotgun',
    tacticalTraits: ['Flanker'], storyTags: ['Guarded'],
    attributes: A(50, 48, 54, 50, 50, 52, 50, 50, 50, 38),
    descriptors: ['Content Creator', 'Scene-Known'], arcId: 'yahyo-girlaxy', tier: 'origin',
  },
  {
    id: 'wonmanarmy', realName: 'Tyler Won', username: 'WonManArmy', age: 33,
    bio: 'Mellowed ex-rager streamer who retired at his peak; plays for fun and community now, the temper only mostly tamed.',
    personality: 'Catalyst', role: 'Specialist', hero: 'Techy', weapon: 'rifle',
    tacticalTraits: ['Trader'], storyTags: ['Short Fuse'],
    attributes: A(48, 48, 42, 50, 50, 52, 48, 52, 52, 56),
    descriptors: ['Content Creator', 'Friend of Sam', 'Rich'], arcId: 'won-temper', tier: 'origin',
  },
  {
    id: 'imissu', realName: 'Emma Siew', username: 'imissu', age: 23,
    bio: 'Small-town game-dev new to the big city — bubbly on the surface, coldly calculated in the server.',
    personality: 'Analyst', role: 'Vanguard', hero: 'Angelic', weapon: 'rifle',
    tacticalTraits: ['Disciplined'], storyTags: ['Homesick'],
    attributes: A(54, 52, 52, 50, 46, 48, 54, 46, 48, 42),
    descriptors: ['Nerdy', 'Country Girl'], arcId: 'imissu-home', tier: 'origin',
  },
];

export function characterById(id: string): CharacterDef | undefined {
  return AUTHORED_ORIGINS.find((c) => c.id === id);
}

// Spoiler-free 2-sentence intros for the draft screen — who they are + a hook, no
// thorns or arcs given away. The player picks on vibe + stats, not foreknowledge.
const DRAFT_INTROS: Record<string, string> = {
  moony: "Real name Shiro Toshiyuki — known for reliable, techy play and a good eye. New in town and new to the game, he says, though Sam smiles like there's more to it.",
  mommamay: 'A bank manager and mum of three, and the undisputed champion of family game night. A sharp shot-caller, warm as they come, trying out because her kids dared her to.',
  ronin: "A soft-spoken library assistant with frighteningly clean mechanics. Keeps to himself, and doesn't much talk about where he learned to aim like that.",
  potter: 'Ex-professional analyst who called TFPS on the live broadcast for years. Always itched to actually play — and reckons this scrappy café side might be his (pixel) perfect shot.',
  echo: "Eighteen, fearless, and carrying a famous last name. His big-league sister casts a long shadow, and he is desperate to step out of it.",
  reina: "A seventeen-year-old mechanical phenom who's never met a duel she didn't take. Absurdly gifted, absolutely certain of it, and not big on the word 'we.'",
  cardo: 'A polished all-rounder with no obvious holes in his game. Solid everywhere, restless everywhere — like he is still hunting for the seat that fits.',
  jok3r: 'A chaos-goblin sniper and full-time content creator who plays every round like a highlight reel. Wildly entertaining, wildly inconsistent, having the time of his life.',
  topf: 'A thirty-year-old banker moonlighting as a ranked demon. Immaculate aim, dry as a bone, and thoroughly done carrying strangers up the ladder.',
  yahyo: 'A shotgun specialist who made her name setting nasty traps for an all-girls squad that did real damage last season. Sharp, self-reliant, and playing it close to the chest.',
  wonmanarmy: 'A semi-retired streaming legend once as famous for his temper as his aim. Mellowed and generous now, back for the love of the game — and the community around it.',
  imissu: 'A small-town software engineer new to the big city — all bubbly smiles until the round starts. Then the cold, calculated aggression comes out, and the noodles go cold.',
};

export function draftIntro(id: string): string {
  return DRAFT_INTROS[id] ?? '';
}

// Build the season draft pool: the 12 authored characters as pool Units (ids
// P1..P12). Uses rollUnitMeta's full-override path to pin every field — the
// authored `attributes` land LAST so they're the exact final values (no random
// roll, no personality-bonus drift). `rng` is still threaded (rollUnitMeta draws
// from it internally then discards) so the call stays deterministic.
// Build a single authored character into a pool/roster Unit with the given id.
// rollUnitMeta's full-override path pins every field (authored attributes land
// LAST, so they're exact). Reused for the draft pool AND mid-season redraft signings.
export function buildCharacterUnit(def: CharacterDef, id: string, rng: Rng): Unit {
  const u: Unit = {
    id, name: def.username, team: 'defenders', weapon: def.weapon,
    pos: { col: -1, row: -1 }, hp: UNIT_DEFAULTS.maxHp, maxHp: UNIT_DEFAULTS.maxHp,
    facing: 5, state: 'alive',
    tacticalTraits: [], storyTags: [...def.storyTags], characterId: def.id,
    personality: null, role: 'Specialist', preferredRole: 'Specialist', hero: 'Angelic',
    modifiers: { aggression: 50, baseAggression: 50, offPosition: false, retreatThresholdMod: 0 } as Modifiers,
    attributes: {} as Attributes, cardFlags: {}, directives: [],
  };
  rollUnitMeta(u, rng, {
    tacticalTraits: [...def.tacticalTraits], personality: def.personality,
    role: def.role, preferredRole: def.role, hero: def.hero, attributes: def.attributes,
  });
  return u;
}

export function authoredSeasonPool(rng: Rng): Unit[] {
  return AUTHORED_ORIGINS.map((def, i) => buildCharacterUnit(def, `P${i + 1}`, rng));
}
