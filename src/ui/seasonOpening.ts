// Campaign opening cutscene — the scripted story beat that starts a New Season.
// Replaces the old season-intro modal. Watching the Worlds Grand Finals at the
// café "Pixel Perfect" with the owner Sam, who reveals the shop is in trouble
// ($500k developer offer) just as an ad announces the Amateur TFPS circuit with a
// $500k prize. You and Sam decide to enter, form a team ("Pixel Pursuit"), and go.
//
// Built on the generic dialogue runner (storyScene.playStory). Choices colour the
// player's personality + relationship with Sam and record hooks for future events;
// the path always lands at the draft. The Worlds winner is rolled 50/50 before the
// scene and recorded as a flag. Commentary is original, written in the genre style.

import { playStory, type StoryBeat, type StoryFlags } from './storyScene.ts';

// Star players of the two Worlds finalists — used in the clutch + as future hooks.
const STAR: Record<string, string> = { 'G3': 'Riser', 'Paper Hex': 'Kaze' };

function buildOpeningScript(champion: string, runnerUp: string): StoryBeat[] {
  const star = STAR[champion];
  const cafe = 'the big screen, packed house';
  return [
    { art: `Pixel Perfect café — ${cafe}`, who: 'narrator', text: 'Pixel Perfect. Friday night. Every machine in the place is mirrored to the big screen on the wall — the 2026 Worlds Tactical FPS Championship, Grand Finals.' },
    { who: 'narrator', text: `G3 of North America against Paper Hex of Asia-Pacific. Map five. Twelve rounds each. One more for the title.` },
    { art: 'On screen — the deciding round begins', who: 'caster', text: 'Twelve all on the decider, and the whole arena is on its feet. One round. One world title. Here we go.' },
    { who: 'caster', text: `They trade off the start — two for two — spike is down on A, and it is an absolute coin-flip from here...` },
    { who: 'caster', text: `It's a one-versus-two now for ${champion}! ${star} is the last one alive — sixteen HP, two enemies, the clock bleeding out...` },
    { who: 'caster', text: `${star} swings the corner — ONE DOWN! Reload, reload — they peek again — TWO!! ${star} HAS DONE IT!` },
    { art: `On screen — ${champion} pile onto the stage`, who: 'caster', text: `${champion.toUpperCase()} ARE YOUR WORLD CHAMPIONS! A one-versus-two on the Grand Final stage — you will not see a bigger clutch all year!` },
    { art: 'Inside the café — the room erupts', who: 'narrator', text: 'Half the café is on its feet. The other half groans into their energy drinks. Somebody knocks over a chair.' },

    { art: 'Sam, behind the counter, grinning', who: 'sam', text: `${star}! Did you SEE that swing? Ice in the veins. Absolute ice.` },
    {
      prompt: '',
      options: [
        { label: 'Called it. That swing was always there.', set: { vibe: 'cocky' }, reply: [{ who: 'sam', text: 'You did NOT call that. ...Okay, you maybe called it.' }] },
        { label: `Poor ${runnerUp}. So close.`, set: { vibe: 'sentimental' }, reply: [{ who: 'sam', text: `Next year for them, maybe. Brutal way to lose a final, though.` }] },
        { label: 'I need a minute. My heart.', set: { vibe: 'joker' }, reply: [{ who: 'sam', text: 'Ha! Sit down before you fall down.' }] },
      ],
    },
    { who: 'sam', text: 'Man... how many of these have we watched on that wall now? You and me. Ten years of finals.' },
    { who: 'sam', text: 'Since we were kids messing with my dad\'s busted repair PCs in the back.' },

    { art: 'Sam, glancing around the half-empty café', who: 'sam', text: 'Can I be real with you for a second?' },
    { who: 'you', text: 'Always.' },
    { who: 'sam', text: 'Nights like this are rare now. Everyone\'s got a rig at home — it\'s just the die-hards who still come in. The numbers haven\'t added up in a long time.' },
    { who: 'sam', text: 'My folks own the unit. A developer offered five hundred grand for the space. Mom and Dad want me to seriously think about it.' },
    {
      prompt: '...',
      options: [
        { label: 'Sam. You can\'t sell Pixel Perfect.', set: { stance: 'fight' }, reply: [{ who: 'sam', text: 'I know. I KNOW. But five hundred grand is five hundred grand.' }] },
        { label: 'That\'s... a lot of money, though.', set: { stance: 'realist' }, reply: [{ who: 'sam', text: 'Right? That\'s what makes it so hard. It\'d set my whole family up.' }] },
        { label: 'What do YOU actually want to do?', set: { stance: 'supportive' }, reply: [{ who: 'sam', text: 'Honestly? I want to keep the doors open. I just don\'t see how.' }] },
      ],
    },
    { who: 'sam', text: 'I don\'t know. I really don\'t.' },

    { art: 'On screen — the broadcast cuts to a flashy ad', who: 'caster', text: '— and THAT is a wrap on Worlds! But the grind never stops, folks...' },
    { who: 'caster', text: 'Introducing the Amateur Tactical FPS Circuit! Open qualifiers start NEXT WEEK — last call to register your squad...' },
    { who: 'caster', text: '...for a run at the main event, and a grand prize of FIVE. HUNDRED. THOUSAND. DOLLARS.' },
    { art: 'You and Sam, turning to look at each other', who: 'narrator', text: 'You and Sam turn and look at each other at the exact same moment.' },
    { who: 'sam', text: '...No.' },
    { who: 'you', text: 'You\'re thinking it too.' },
    { who: 'sam', text: 'That is the single dumbest idea I have ever—' },
    {
      prompt: 'Make the pitch:',
      options: [
        { label: 'We enter. We win it. We save the shop.', set: { pitch: 'bold' }, reply: [{ who: 'sam', text: 'Just like that. "We win it." Five hundred grand.' }] },
        { label: 'I read scrims better than half those casters. I can manage a team.', set: { pitch: 'manager' }, reply: [{ who: 'sam', text: 'You really do. I\'ve watched you call rounds before they happen.' }] },
        { label: 'It\'s already on the table. What have we got to lose?', set: { pitch: 'nothinglose' }, reply: [{ who: 'sam', text: 'The entry fee. My dignity. ...Not much else, honestly.' }] },
      ],
    },
    { art: 'Sam, leaning in, the idea taking hold', who: 'sam', text: '...You\'re serious.' },
    { who: 'you', text: 'Five players. One season. One shot.' },
    { who: 'sam', text: '...' },
    { who: 'sam', text: 'Okay. Okay! Let\'s do it. Let\'s build a team and go win this stupid, beautiful thing.' },
    { art: 'Sam, registering the team on a laptop', who: 'sam', text: 'Registering us now. Team name? "Pixel Perfect." Same as the shop. We play for the name on the door.' },
    { who: 'sam', text: 'Alright, manager. Go find me five players. We\'ve got a qualifier to win.' },
  ];
}

// Roll the Worlds winner (50/50) ONCE per opening, record the hooks, and play the
// scene. `onDone` receives the accumulated story flags (worlds result + the
// player's dialogue choices) for the season to carry.
export function showSeasonOpening(champion: string, onDone: (flags: StoryFlags) => void, onBack?: () => void): void {
  const runnerUp = champion === 'G3' ? 'Paper Hex' : 'G3';
  const worldsFlags: StoryFlags = {
    worldsChampion: champion,
    worldsRunnerUp: runnerUp,
    worldsChampionStar: STAR[champion],
  };
  playStory(buildOpeningScript(champion, runnerUp), (choiceFlags) => onDone({ ...worldsFlags, ...choiceFlags }), onBack);
}
