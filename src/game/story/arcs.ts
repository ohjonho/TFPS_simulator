// The arc registry (Phase 3): Moony + imissu, authored as data. Keyed by arcId
// (matches CharacterDef.arcId). The arc runtime plays whichever arcs belong to the
// drafted roster. Remaining arcs land in later phases.
//
// Moony exercises the whole engine: a post-match last-alive trigger, a morale dip,
// a personal/dry fork (freeze opt-out), a tough-love removeTag vs a hopeful
// resolution, a skip-a-day gap, and a weighted roll (Sam guaranteed vs a teammate
// roll shifted by Leadership) that evolves the curse into Clutch. imissu exercises
// calendar (onWeek) triggers and a morale-thorn resolution.
//
// Deferred to later phases (noted inline): Moony's per-personality mentor lines +
// the [Duo] upside + the Firebrand bad outcome; imissu's "built a tool" training
// bonus (grants a flag now for the later payoff).

import type { Arc } from './arcTypes.ts';

const MOONY: Arc = {
  id: 'moony-curse',
  characterId: 'moony',
  beats: [
    {
      id: 'crisis',
      trigger: { slot: 'post-match', onWeek: 2, onMatchEvent: 'last-alive-round' },
      kicker: 'A quiet word',
      headline: '{player} is in his own head',
      body: 'He had the round on his stick and it slipped — again. Sam catches your eye: that look is back. "Go easy," he murmurs. "That one runs deep."',
      scene: [
        { who: 'sam', text: 'Go easy on him tonight, coach. He had that round won and it got away from him — again.' },
        { who: 'sam', text: "That look's back. The one he walked in the door with. That one runs deep." },
        { who: 'you', text: "I'll sit with him." },
        { speakerId: 'moony', text: "You don't have to. I already know what it was. I had it, and I choked. Same as always." },
        { who: 'narrator', text: "He won't look up from the screen. The round loops there — his shot landing a half-second too late, over and over." },
      ],
      effects: [{ op: 'morale', scope: 'self', amount: -6 }],
      persona: { Analyst: 'He won\'t say it, but he\'s already replayed the miss a hundred times behind those eyes.' },
      choices: [
        { label: 'Sit with him — let on that you know who he is', effects: [{ op: 'setFlag', flag: 'moony-opened' }] },
        { label: 'Draw him out without saying you know', effects: [{ op: 'setFlag', flag: 'moony-opened' }] },
        {
          label: 'Keep it dry — pure coaching, no feelings',
          note: 'Steadies him now, but the door stays shut.',
          freezesArc: true,
          effects: [{ op: 'morale', scope: 'self', amount: 6 }, { op: 'attr', scope: 'self', agg: 'mechanics', amount: 1 }],
        },
      ],
    },
    {
      id: 'openup',
      trigger: { slot: 'either' },
      kicker: 'The curse',
      headline: '{player} finally says it out loud',
      body: 'The pseudonym. The grand final. The whispers that he can\'t win the ones that matter. He\'s carried it alone for two years. "Maybe they were right," he says.',
      scene: [
        { who: 'narrator', text: "Late. The café's dark but for one monitor. {player} finally talks — and once he starts, it comes out all at once." },
        { speakerId: 'moony', text: "Moony isn't my name. Two years ago I played as myself — Shiro — and I made a grand final." },
        { speakerId: 'moony', text: "I lost it on stage. The last round was mine, and I froze, and the whole scene watched me do it." },
        { speakerId: 'moony', text: "So I buried Shiro. Started over as nobody. But the ghost followed me here. \"Can't win the ones that matter.\" ...Maybe they were right." },
      ],
      choices: [
        {
          label: 'Tough love — dismiss the curse, outwork it',
          note: 'A hard individual session buries the doubt. Fixes the problem; forges no bond.',
          freezesArc: true,
          effects: [{ op: 'removeTag', tagId: 'anti-Clutch' }, { op: 'morale', scope: 'self', amount: 4 }],
        },
        {
          label: 'Encourage him to open up to the team',
          note: "Let him decide who to trust. He'll need a day.",
          effects: [{ op: 'setFlag', flag: 'moony-hopeful' }],
        },
      ],
    },
    {
      id: 'resolution',
      trigger: { slot: 'either', requiresFlag: 'moony-hopeful', minGapSlots: 1 },
      kicker: 'The talk',
      headline: '{player} decides who to lean on',
      body: 'He\'s ready to test the curse against someone he trusts. Who does he turn to?',
      scene: [
        { who: 'narrator', text: "A day later, {player} finds you before practice — steadier than you've seen him." },
        { speakerId: 'moony', text: "I want to put this down. Really put it down. But not alone — I need someone to lean on when the round's on my stick and the old voice starts up." },
        { who: 'you', text: 'Who do you trust to catch you?' },
        { speakerId: 'moony', text: "There's Sam. He signed me when I was no one, and he never once stopped believing. That's the safe hand. Or one of the squad — someone who really talks. Riskier. But if it lands, it lands harder." },
      ],
      choices: [
        {
          label: 'Sam — the man who signed him',
          note: 'Sam always believed. A sure thing.',
          roll: {
            baseWeights: [100],
            outcomes: [{ id: 'sam', effects: [{ op: 'evolveTag', from: 'anti-Clutch', to: 'Clutch' }, { op: 'morale', scope: 'self', amount: 8 }] }],
          },
        },
        {
          label: 'A teammate',
          note: 'A stronger communicator makes it land harder.',
          // Weighted by the best communicator on the roster. Both outcomes break the
          // curse (Clutch); the [Duo] bond + the Firebrand risk arrive in a later phase.
          roll: {
            baseWeights: [40, 60],
            weightBy: { agg: 'leadership', of: 'best-teammate' },
            outcomes: [
              { id: 'great', effects: [{ op: 'evolveTag', from: 'anti-Clutch', to: 'Clutch' }, { op: 'morale', scope: 'self', amount: 10 }] },
              { id: 'good', effects: [{ op: 'evolveTag', from: 'anti-Clutch', to: 'Clutch' }, { op: 'morale', scope: 'self', amount: 6 }] },
            ],
          },
        },
      ],
    },
  ],
  epilogue: {
    resolved: 'Moony — Shiro — plays without the ghost now. He can say his old name again and smile.',
    frozen: 'Moony kept his head down and his secret close. Steady enough — but the ceiling never lifted.',
    neglected: 'You kept meaning to sit with Moony, and then the season was gone. Some doors only open once.',
    unstarted: "You never got under Moony's quiet. Whatever he's carrying, he carried it all season.",
  },
};

const IMISSU: Arc = {
  id: 'imissu-home',
  characterId: 'imissu',
  beats: [
    {
      id: 'noodles',
      trigger: { slot: 'either', onWeek: 2 },
      kicker: 'After hours',
      headline: '{player} is a long way from home',
      body: 'Vending-machine noodles, a rent spreadsheet open on the second monitor, a video call with her mum just ended. She grins through it — which is exactly the tell. The café is the only place in this city that feels like hers.',
      scene: [
        { who: 'narrator', text: "After hours. The café's dark but for {player} — a cup of vending-machine noodles going cold, a rent spreadsheet glowing on the second monitor. A call with her mum just ended." },
        { speakerId: 'imissu', text: "Oh — hey, coach. Didn't hear you come in. Just off a call with my mum. Everyone's good back home. All good here too, honest." },
        { who: 'you', text: "That's a lot of 'good' for someone eating dinner alone at midnight." },
        { speakerId: 'imissu', text: "Ha. Busted. It's just — it's loud back home, you know? Six of us round one table. Here it's so quiet. I keep the café open late 'cause it's the one room in this city that doesn't echo." },
      ],
      choices: [
        { label: 'Throw a team potluck', note: 'The squad cooks. Cheap, warm, hers.', effects: [{ op: 'morale', scope: 'team', amount: 4 }, { op: 'setFlag', flag: 'imissu-roots' }] },
        { label: 'Sit and problem-solve the budget with her', note: 'Practical help, honestly given.', effects: [{ op: 'morale', scope: 'self', amount: 3 }, { op: 'setFlag', flag: 'imissu-roots' }] },
        { label: 'Sympathise, then move on', note: 'You have a season to run.', effects: [{ op: 'setFlag', flag: 'imissu-neglected' }] },
      ],
    },
    {
      id: 'the-job',
      trigger: { slot: 'either', onWeek: 5 },
      kicker: 'The offer',
      headline: '{player} has a way out',
      body: 'Her mum found her a safe government IT job back home — ten minutes from the farm, half the rent. She\'s seriously considering it. Underneath: she thinks chasing a game is selfish, that real engineers help their families.',
      scene: [
        { who: 'narrator', text: "{player} slides her phone across the desk before you've even sat down. An email, still open." },
        { speakerId: 'imissu', text: "My mum found me a job. Government IT, back home. Ten minutes from the farm, half the rent I pay here. Stable. Real." },
        { who: 'you', text: "And you're thinking about it." },
        { speakerId: 'imissu', text: "A real engineer helps her family. She didn't work two jobs so I could chase a video game across the country. Maybe this is just... the grown-up call." },
        { who: 'narrator', text: "She won't quite meet your eye. She's already half-built the case against herself." },
      ],
      choices: [
        { label: '"You belong here."', effects: [{ op: 'evolveTag', from: 'Homesick', to: 'Found Family' }, { op: 'morale', scope: 'self', amount: 8 }] },
        { label: '"Build something for us first."', note: 'Before you decide, make the thing only you can make.', effects: [{ op: 'evolveTag', from: 'Homesick', to: 'Found Family' }, { op: 'morale', scope: 'self', amount: 6 }, { op: 'setFlag', flag: 'imissu-tool' }] },
        { label: '"Whatever you choose, home\'s here."', effects: [{ op: 'evolveTag', from: 'Homesick', to: 'Found Family' }, { op: 'morale', scope: 'self', amount: 5 }] },
      ],
    },
  ],
  epilogue: {
    resolved: 'Emma stopped calling it "this city" and started calling it home. The bus ticket back went unbought.',
    neglected: 'Emma never quite found her feet here, and no one gave her a reason to stay. At season\'s end, she went home.',
    unstarted: 'Emma played out the season quiet and homesick, and when it ended, the little town pulled her back.',
  },
};

// Echo — the lightest arc (Phase 5, first slice): sibling visits → nerves (the
// already-wired Nervous combat debuff) → you steady him → it evolves to Steady-Hand
// (an earned badge; the real win is shedding the −HR). Existing ops only.
const ECHO: Arc = {
  id: 'echo-shadow',
  characterId: 'echo',
  beats: [
    {
      id: 'the-visit',
      trigger: { slot: 'either', onWeek: 3 },
      kicker: 'A visitor',
      headline: "{player}'s sister is coming to watch",
      body: "Nova — his big-league sister, the one whose shadow he's played in his whole life — is flying in to catch a game. {player} is buzzing. He's also, suddenly, tight as a drum: desperate to prove he's more than somebody's little brother.",
      scene: [
        { who: 'narrator', text: "Word gets around the café: Nova — {player}'s big-league sister — is flying in to watch a game." },
        { speakerId: 'echo', text: "She's actually coming. Okay. I'm going to show her I'm more than her little brother." },
        { who: 'narrator', text: "He's buzzing. He's also, all at once, wound tight as a drum." },
      ],
      effects: [{ op: 'grantTag', tagId: 'Nervous' }, { op: 'morale', scope: 'self', amount: -3 }],
      persona: { Firebrand: '"I\'m gonna show her," he keeps saying — a little too loud, a little too often.' },
    },
    {
      id: 'steady-him',
      trigger: { slot: 'either', minGapSlots: 1 },
      kicker: 'Pressing',
      headline: '{player} is trying too hard',
      body: "With Nova in the room he's forcing highlight plays and whiffing the simple ones. The nerves are eating him alive. How do you settle him?",
      scene: [
        { who: 'narrator', text: "With Nova in the room, {player} is forcing every play and clanking the easy ones." },
        { speakerId: 'nova', text: "Breathe, hermanito. You're trying to win the whole game on every duel." },
        { speakerId: 'echo', text: "I'm fine. I've got this." },
        { who: 'narrator', text: "He does not have this. How do you settle him?" },
      ],
      persona: { Firebrand: 'Afterwards Nova ribs him — "not bad, for my little brother." He grins. This time it doesn\'t sting.' },
      choices: [
        { label: 'Rally the team around him', note: "Remind him he's not out there alone.", effects: [{ op: 'evolveTag', from: 'Nervous', to: 'Steady-Hand' }, { op: 'morale', scope: 'self', amount: 6 }, { op: 'morale', scope: 'team', amount: 2 }] },
        { label: 'A quiet word from Sam', note: 'The old owner has steadied greener nerves than his.', effects: [{ op: 'evolveTag', from: 'Nervous', to: 'Steady-Hand' }, { op: 'morale', scope: 'self', amount: 6 }] },
        { label: "Solo reps until it's muscle memory", note: 'Bury the nerves under the fundamentals.', effects: [{ op: 'evolveTag', from: 'Nervous', to: 'Steady-Hand' }, { op: 'morale', scope: 'self', amount: 4 }, { op: 'attr', scope: 'self', agg: 'mechanics', amount: 1 }] },
      ],
    },
  ],
  epilogue: {
    resolved: "Echo stopped playing for Nova's approval and started playing like himself. Turned out that was better anyway.",
    neglected: "Echo chased his sister's shadow all season and never quite stepped out of it.",
    unstarted: "Nova's visit came and went, and Echo carried the same quiet weight he always had.",
  },
};

// R0nin — the reformed cheater's past resurfaces. An early push-for-info gates the
// resolution's options (flag-gated choices). The "replace him" branch fires a
// mid-season departure (exercises the 4b redraft). Existing ops only.
const RONIN: Arc = {
  id: 'ronin-past',
  characterId: 'ronin',
  beats: [
    {
      id: 'warning',
      trigger: { slot: 'post-match', onNthWin: 2 },
      kicker: 'A quiet warning',
      headline: '{player} needs to tell you something',
      body: "He's twitchy after the win. \"If we keep winning, people start looking. And if they look at me... there's stuff in my past that could drag the whole team down. I needed you to know.\"",
      scene: [
        { who: 'narrator', text: "The win's barely on the board when {player} pulls you aside — jittery, voice low, checking who's in earshot." },
        { speakerId: 'ronin', text: "I have to tell you something, and I'd rather you hear it from me than read it off someone else." },
        { speakerId: 'ronin', text: "If we keep winning like this, people start digging. And if they dig at me... there's stuff in my past. Stuff that could drag this whole team down with it." },
        { speakerId: 'ronin', text: "I'm not asking you to fix it. I just needed you to know what you're standing next to. That's all." },
      ],
      choices: [
        { label: 'Press him — what exactly happened?', note: 'You want the full story now.', effects: [{ op: 'setFlag', flag: 'ronin-pushed' }, { op: 'morale', scope: 'self', amount: -2 }] },
        { label: "Don't push — you trust him", note: "He'll tell you when he's ready.", effects: [{ op: 'setFlag', flag: 'ronin-trusted' }] },
      ],
    },
    {
      id: 'exposed',
      trigger: { slot: 'either', onWeek: 4, requiresWinning: true },
      kicker: 'The story breaks',
      headline: "The press dug up {player}'s past",
      body: 'An esports outlet runs it: your rising underdog\'s star was a blacklisted cheater in another game, years ago. "Known cheaters never change," the headline sneers. The room\'s rattled; {player} is mortified he hid it.',
      scene: [
        { speakerId: 'caster', text: "—and in less flattering news off the back of that upset: word is this Cinderella run's got a skeleton in the closet. One of their stars? Blacklisted for cheating, years back, under a different tag." },
        { speakerId: 'caster', text: "And look, I'll say it — known cheaters never change. Somebody in that org has some serious questions to answer tonight." },
        { speakerId: 'ronin', text: "It's everywhere. My phone hasn't stopped since the segment aired.", clearStage: true },
        { who: 'you', text: "You knew this might surface. Why not get ahead of it?" },
        { speakerId: 'ronin', text: "Because I hoped I'd earned enough that it wouldn't matter. Stupid. I'm sorry — you should've had all of it from me first." },
      ],
      effects: [{ op: 'morale', scope: 'team', amount: -4 }, { op: 'morale', scope: 'self', amount: -6 }],
    },
    {
      id: 'statement',
      trigger: { slot: 'either', minGapSlots: 1 },
      kicker: 'Your call',
      headline: 'How does the team answer?',
      body: 'The reporters want a statement. What you say — and whether you keep him — is up to you.',
      scene: [
        { who: 'narrator', text: "The inbox is a wall of interview requests. {player} sits across from you, already braced for the worst." },
        { speakerId: 'ronin', text: "Whatever you decide, I understand. I brought this to your door. If letting me go makes the noise stop, I won't turn it into a fight." },
        { who: 'you', text: "Let's talk about what we tell them." },
      ],
      choices: [
        { label: 'Back him completely — he\'s one of us', requiresFlag: 'ronin-pushed', note: 'You know the whole story. Draw the line here.', effects: [{ op: 'grantTag', tagId: 'Loyal' }, { op: 'attr', scope: 'self', agg: 'discipline', amount: 2 }, { op: 'attr', scope: 'self', agg: 'leadership', amount: 2 }, { op: 'morale', scope: 'team', amount: 6 }] },
        { label: 'A measured statement — everyone deserves a second chance', requiresFlag: 'ronin-pushed', effects: [{ op: 'grantTag', tagId: 'Loyal' }, { op: 'attr', scope: 'self', agg: 'discipline', amount: 2 }, { op: 'morale', scope: 'team', amount: 2 }] },
        { label: 'Trust him and move forward', requiresFlag: 'ronin-trusted', note: 'You never got the details, but you believe him.', effects: [{ op: 'grantTag', tagId: 'Loyal' }, { op: 'attr', scope: 'self', agg: 'discipline', amount: 2 }, { op: 'morale', scope: 'self', amount: 4 }] },
        { label: "It's not worth the risk — we let him go", requiresFlag: 'ronin-trusted', note: 'A clean-history player, and the noise stops.', effects: [{ op: 'depart', when: 'after-next-match', reason: 'The story never died down, and R0nin stepped away rather than drag the team through it.' }, { op: 'morale', scope: 'team', amount: -4 }] },
      ],
    },
  ],
  epilogue: {
    resolved: "R0nin — Samuel — finally stopped waiting for the other shoe to drop. He plays like a man who's been forgiven.",
    unstarted: 'R0nin kept his past buried and his head down, and it stayed buried — this season, at least.',
  },
};

// MommaMay — the mum with impostor syndrome. Four crossroads: commit (Busy→Committed),
// one glorious season (retire end-season), dismiss (leaves end-season), or push her
// out (mid-season depart). Existing ops.
const MOMMAMAY: Arc = {
  id: 'may-imposter',
  characterId: 'mommamay',
  beats: [
    {
      id: 'doubt',
      trigger: { slot: 'either', onWeek: 3 },
      kicker: 'After practice',
      headline: '{player} wonders if she belongs',
      body: "Three kids, a day job, and a decade on the players in the other seats. \"Maybe this is a young person's game,\" she says, not quite joking. \"Maybe I'm just holding a spot someone hungrier should have.\"",
      scene: [
        { who: 'narrator', text: "Practice winds down. The others file out; {player} lingers, packing up slow, like she's working up to something." },
        { speakerId: 'mommamay', text: "Can I be honest? Everyone in those other seats is half my age with twice the hours. I've got three kids, a day job, and a body clock that clocks off at ten." },
        { speakerId: 'mommamay', text: "Maybe this is a young person's game. Maybe I'm just keeping a chair warm for someone hungrier than me." },
      ],
      effects: [{ op: 'morale', scope: 'self', amount: -3 }],
    },
    {
      id: 'the-talk',
      trigger: { slot: 'either', onWeek: 5, minGapSlots: 1 },
      kicker: 'The crossroads',
      headline: "What's {player}'s place on this team?",
      body: "She's made up her mind to decide. Where you land here decides whether she doubles down or steps away.",
      scene: [
        { who: 'narrator', text: "{player} asked for five minutes. She's got that settled look — she's already decided to make a decision, and just needs you to weigh in." },
        { speakerId: 'mommamay', text: "I've gone back and forth on this for weeks, so I'll just ask you straight. What am I to this team? Really." },
        { speakerId: 'mommamay', text: "Because if I'm the weak link everyone's too kind to name, I'd rather hear it from you now than find out on a stage." },
      ],
      choices: [
        { label: 'Rally the team — show her they need her', note: 'She commits fully; the day-job juggling stops costing her.', effects: [{ op: 'evolveTag', from: 'Busy', to: 'Committed' }, { op: 'morale', scope: 'self', amount: 8 }, { op: 'morale', scope: 'team', amount: 2 }] },
        { label: 'Support her — give her one last great season', note: 'She frees up her time, then retires happy at season\'s end.', effects: [{ op: 'removeTag', tagId: 'Busy' }, { op: 'morale', scope: 'self', amount: 6 }, { op: 'depart', when: 'end-season', reason: 'MommaMay gave the season everything, then went home to her family for good — no regrets.' }] },
        { label: 'Tell her to make more time or step aside', note: 'It stings. She keeps her distance and leaves at season\'s end.', effects: [{ op: 'morale', scope: 'self', amount: -4 }, { op: 'depart', when: 'end-season', reason: 'MommaMay never felt she measured up, and quietly walked away when it was over.' }] },
        { label: "Agree she can't give what the team needs", note: 'Bittersweet — she leaves after the next match, and a slot opens.', effects: [{ op: 'depart', when: 'after-next-match', reason: "MommaMay couldn't give the team the time it deserved. She bowed out with grace." }, { op: 'morale', scope: 'team', amount: -4 }] },
      ],
    },
  ],
  epilogue: {
    resolved: 'MommaMay stopped apologising for her life and started leading with it. The kids never let her hear the end of it.',
    unstarted: 'MommaMay juggled the team, the job, and the family all season, and never once let you see the strain.',
  },
};

// t0ph — the banker's arc is the cost of stability. No starting thorn; an all-nighter
// brings the Drained debuff, then a promotion forces the fork. Both endings are good.
const TOPF: Arc = {
  id: 'topf-deal',
  characterId: 'topf',
  beats: [
    {
      id: 'all-nighter',
      trigger: { slot: 'either', onWeek: 3 },
      kicker: 'Straight from the office',
      headline: '{player} pulled an all-nighter',
      body: 'He arrives still in the suit, twenty hours into a deal, running on coffee and spite. "I\'ve been awake so long I can see the matrix," he deadpans. "Unrelated: do not trust my crossfire tonight."',
      scene: [
        { who: 'narrator', text: "{player} walks in still knotted into a suit, twenty hours into a deal, a coffee in each hand like a man defusing a bomb." },
        { speakerId: 'topf', text: "Evening. Before anyone asks: yes, straight from the office. No, I have not slept. I have transcended sleep." },
        { speakerId: 'topf', text: "I've been awake so long I can see the matrix. Purely as an administrative note — do not, under any circumstances, trust my crossfire tonight." },
      ],
      effects: [{ op: 'grantTag', tagId: 'Drained' }, { op: 'morale', scope: 'self', amount: -2 }],
      choices: [
        { label: 'Bench him this match — he needs the rest', note: 'He\'s quietly grateful.', effects: [{ op: 'removeTag', tagId: 'Drained' }, { op: 'morale', scope: 'self', amount: 2 }, { op: 'setFlag', flag: 'topf-cared' }] },
        { label: 'Let him play through it', note: 'His call to make.', effects: [] },
        { label: 'Ask him what the job\'s really costing', note: 'He cracks the door a little.', effects: [{ op: 'setFlag', flag: 'topf-cared' }, { op: 'morale', scope: 'self', amount: 1 }] },
      ],
    },
    {
      id: 'promotion',
      trigger: { slot: 'either', onWeek: 6, minGapSlots: 1 },
      kicker: 'The offer',
      headline: '{player} got the promotion',
      body: '"VP. Real money. And every evening for the next two years." He tells you over a quiet game. "Four years of ranked was the one part of my life the bank didn\'t own. This team\'s the first time it meant more than that. So... talk me out of it. Or don\'t. I genuinely can\'t tell which I want."',
      scene: [
        { who: 'narrator', text: "Late. A casual queue, just the two of you loading in. {player} says it between rounds, like it's nothing." },
        { speakerId: 'topf', text: "They offered me VP today. Real money. And every single evening I have for the next two years." },
        { speakerId: 'topf', text: "Four years of ranked was the one part of my life the bank never owned. This team's the first time it's meant more than that." },
        { speakerId: 'topf', text: "So talk me out of it. Or don't. I genuinely cannot tell you which one I'm hoping you'll pick." },
      ],
      choices: [
        { label: 'Take it — go out a champion this season', note: 'He finishes committed, then retires warm.', effects: [{ op: 'removeTag', tagId: 'Drained' }, { op: 'morale', scope: 'self', amount: 4 }, { op: 'depart', when: 'end-season', reason: 't0ph took the VP job — but not before giving this team one last, complete season.' }] },
        { label: "Turn his own question back — what does the grind buy you?", note: 'He negotiates flexibility instead, and stays.', effects: [{ op: 'removeTag', tagId: 'Drained' }, { op: 'grantTag', tagId: 'Locked In' }, { op: 'attr', scope: 'self', agg: 'discipline', amount: 2 }, { op: 'attr', scope: 'self', agg: 'improvisation', amount: 2 }, { op: 'morale', scope: 'self', amount: 6 }] },
        { label: "Sleep on it — you've earned the call", requiresFlag: 'topf-cared', note: 'Because you looked out for him, he chooses the team.', effects: [{ op: 'removeTag', tagId: 'Drained' }, { op: 'grantTag', tagId: 'Locked In' }, { op: 'attr', scope: 'self', agg: 'discipline', amount: 2 }, { op: 'morale', scope: 'self', amount: 4 }] },
      ],
    },
  ],
  epilogue: {
    resolved: 't0ph negotiated his evenings back and stayed. Turns out the ranked demon just wanted a team to carry that carried him back.',
    unstarted: 't0ph kept the job and the game in separate boxes all season, and never quite let the team into either.',
  },
};

// Reina — the hubris arc. Tilts (negative K/D) blaming the team. Train-harder arms
// an escalation (a second tilt → walk-or-stay); "it's a team game" resolves her and
// turns on recurring bonding events.
const REINA: Arc = {
  id: 'reina-hubris',
  characterId: 'reina',
  beats: [
    {
      id: 'blowup',
      trigger: { slot: 'post-match', onMatchEvent: 'negative-kd' },
      kicker: 'In the aftermath',
      headline: '{player} is blaming everyone but herself',
      body: 'She went 4-and-12 forcing hero plays and now the comms are on fire — every death was somebody else\'s fault. The prodigy does not lose gracefully.',
      scene: [
        { who: 'narrator', text: "The board reads 4 and 12. {player} tears her headset off before the round-end screen has even faded." },
        { speakerId: 'reina', text: "Don't. Do not even start. That is not on me — I got zero support out there. Zero. I'm hard-carrying four passengers and somehow I'm the problem?" },
        { who: 'you', text: "You forced six of those deaths yourself, Reina." },
        { speakerId: 'reina', text: "Because somebody has to actually DO something out there! Put a prodigy on a team of bots and this is the tape you get." },
      ],
      choices: [
        { label: 'Tell her to train harder and own her own discipline', note: 'Stats up, but the room cools on her.', effects: [{ op: 'attr', scope: 'self', agg: 'mechanics', amount: 2 }, { op: 'morale', scope: 'team', amount: -3 }, { op: 'setFlag', flag: 'reina-armed' }] },
        { label: "Sit her down — it's a team game, and good teams punish lone wolves", note: 'She grows sharper and closer to the squad.', freezesArc: true, effects: [{ op: 'attr', scope: 'self', agg: 'gameSense', amount: 3 }, { op: 'morale', scope: 'self', amount: 2 }, { op: 'enableEventGroup', groupId: 'bonding' }] },
      ],
    },
    {
      id: 'knife-edge',
      trigger: { slot: 'post-match', onMatchEvent: 'negative-kd', requiresFlag: 'reina-armed', minGapSlots: 1 },
      kicker: 'Sam pulls you aside',
      headline: '{player} tilted again — and the room\'s had enough',
      body: '"She\'s on a knife-edge," Sam says quietly. "One more blow-up and you\'ll lose the rest of them keeping her. Your call."',
      scene: [
        { who: 'sam', text: "Coach. Got a second? Away from the floor." },
        { who: 'sam', text: "That girl's on a knife-edge. The room's just about done carrying it. One more blow-up and you don't only lose her — you lose the four who've been biting their tongues to keep her." },
        { who: 'you', text: "You think there's a player in there worth it?" },
        { who: 'sam', text: "Oh, the talent's real. That was never the question. The question is whether it's worth what it's costing everyone else — and that one's yours, not mine." },
      ],
      choices: [
        { label: 'Talk her down one more time', note: 'You believe there\'s a player in there worth the trouble.', effects: [{ op: 'morale', scope: 'self', amount: 2 }, { op: 'morale', scope: 'team', amount: 2 }] },
        { label: 'She\'s poison — let her walk', note: 'The room can breathe again; a seat opens.', effects: [{ op: 'depart', when: 'after-next-match', reason: "Reina's talent was never the problem. She left still sure it was everyone else." }, { op: 'morale', scope: 'team', amount: -2 }] },
      ],
    },
  ],
  epilogue: {
    resolved: 'Reina learned the game is bigger than her aim. Still cocky — but she trusts the four around her now.',
    frozen: 'Reina found her ceiling was never mechanical. She plays for the badge on the jersey now, not just the scoreboard.',
    active: 'Reina put in the reps you asked for. The temper\'s still in there, coiled — but it held, this season.',
    unstarted: 'Reina fragged out of her mind and lost anyway, over and over, and never once wondered why.',
  },
};

// Jok3r — content-creator to competitor. A camera clash, then his chat calling him a
// fraud. Commit → the Disciplined trait (cures his low discipline); give up → he
// retires warm at season's end.
const JOK3R: Arc = {
  id: 'jok3r-competitor',
  characterId: 'jok3r',
  beats: [
    {
      id: 'the-camera',
      trigger: { slot: 'either', onWeek: 3 },
      kicker: 'Behind the scenes',
      headline: "{player}'s cameras are grating on the quiet ones",
      body: "His content's everywhere — and a couple of the heads-down analysts on the squad are sick of being B-roll. The room's a little frosty. Do you step in?",
      scene: [
        { who: 'narrator', text: "There's a chill in the room. A couple of the heads-down players have started sitting with their backs to {player}'s ever-present camera." },
        { speakerId: 'jok3r', text: "What? The content's good for us! Numbers are up, the org's happy, everybody eats. And nobody's even doing anything embarrassing... mostly." },
        { who: 'narrator', text: "Across the room, someone very deliberately angles a monitor away from the lens. Do you step in?" },
      ],
      choices: [
        { label: 'Side with the team — ease off the cameras', effects: [{ op: 'morale', scope: 'team', amount: 3 }, { op: 'setFlag', flag: 'jok3r-cam' }] },
        { label: 'Back {player} — the content pays the bills', effects: [{ op: 'morale', scope: 'self', amount: 3 }, { op: 'morale', scope: 'team', amount: -2 }, { op: 'setFlag', flag: 'jok3r-cam' }] },
        { label: 'Let them sort it out themselves', effects: [{ op: 'setFlag', flag: 'jok3r-cam' }] },
      ],
    },
    {
      id: 'reckoning',
      trigger: { slot: 'either', onWeek: 5, minGapSlots: 1 },
      kicker: 'A hard week',
      headline: '{player} took that loss to heart',
      body: "His chat's been at him — \"not a real competitor, just farming the team for content.\" It landed. \"I came for the clips,\" he admits. \"Somewhere in there I started actually caring. Feels too late to start trying for real.\"",
      scene: [
        { who: 'narrator', text: "The loss stung, and for once {player} isn't clipping it for the highlight reel. He's just quiet." },
        { speakerId: 'jok3r', text: "Chat was brutal tonight. 'Not a real competitor, just farming the boys for content.' And the thing is — they're not wrong, are they." },
        { speakerId: 'jok3r', text: "I came here for the clips. Somewhere along the way I started actually caring whether we win. Feels stupid to start trying for real this late in." },
      ],
      choices: [
        { label: "Never too late — start grinding, now", note: 'He commits, and the mistakes start to vanish.', effects: [{ op: 'grantTag', tagId: 'Disciplined' }, { op: 'attr', scope: 'self', agg: 'discipline', amount: 2 }, { op: 'morale', scope: 'self', amount: 6 }] },
        { label: 'Better late than never — and mean it', effects: [{ op: 'grantTag', tagId: 'Disciplined' }, { op: 'attr', scope: 'self', agg: 'discipline', amount: 2 }, { op: 'morale', scope: 'self', amount: 4 }] },
        { label: "It's too late — just enjoy the ride out", note: 'He plays it out for fun, then hangs it up.', effects: [{ op: 'morale', scope: 'self', amount: 2 }, { op: 'depart', when: 'end-season', reason: 'Jok3r never did take it fully seriously — but he left with more real friends than followers, and no regrets.' }] },
      ],
    },
  ],
  epilogue: {
    resolved: "The jokes never stopped, but the mistakes did. Jok3r turned into a player the tape doesn't laugh at.",
    unstarted: 'Jok3r farmed a season of content and shrugged off every loss, exactly as he arrived.',
  },
};

// Cardo — the tinkerer. Restless in his role; either promise him the reps (an
// obligation the training day checks) or let him experiment with a new role/hero.
const CARDO: Arc = {
  id: 'cardo-role',
  characterId: 'cardo',
  beats: [
    {
      id: 'restless',
      trigger: { slot: 'post-match', onNthWin: 1 },
      kicker: 'A word after the win',
      headline: '{player} thinks he\'s in the wrong seat',
      body: "\"I'm fine at this,\" he says, \"but I keep feeling I'd be dangerous somewhere else.\" He wants to try a role and hero the team doesn't run. Do you let him tinker?",
      scene: [
        { who: 'narrator', text: "Good win — and {player} catches you before you've even packed up, practically vibrating." },
        { speakerId: 'cardo', text: "So. Hear me out. I'm fine in this seat — solid, reliable, whatever. But every single round I'm sat there thinking about what I'd be doing from a completely different one." },
        { speakerId: 'cardo', text: "There's a role and a hero we don't run, and I've got the whole thing sketched out. I think I'd be genuinely dangerous. Just let me tinker. Please." },
      ],
      choices: [
        { label: 'Keep him where he is — but promise him extra reps', note: 'Fulfil it at the next training day, or you\'ll lose his trust.', freezesArc: true, effects: [{ op: 'obligation', id: 'cardo-reps', require: 'focused-self', onBreak: [{ op: 'morale', scope: 'self', amount: -8 }] }, { op: 'morale', scope: 'self', amount: 2 }] },
        { label: 'Let him try Tactician + Techy', effects: [{ op: 'swapLoadout', role: 'Tactician', hero: 'Techy' }] },
        { label: 'Let him try Warden + Bulwark', effects: [{ op: 'swapLoadout', role: 'Warden', hero: 'Bulwark' }] },
      ],
    },
    {
      id: 'verdict',
      trigger: { slot: 'either', minGapSlots: 1 },
      kicker: 'The experiment',
      headline: 'Did the new role suit {player}?',
      body: "A game or two in the new seat. He's got a read on whether it fits — but it's your call whether to lock it in.",
      scene: [
        { who: 'narrator', text: "A couple of games in the new seat. {player} drops into the chair beside you, turning it over in his head." },
        { speakerId: 'cardo', text: "So I ran the experiment. Honest read? Some rounds it clicked like nothing I've ever felt. Some rounds I was a passenger in my own game." },
        { speakerId: 'cardo', text: "I'm too close to call it. You've watched the tape from outside — does it suit me, or do I go back to what I know?" },
      ],
      choices: [
        { label: 'It suits him — lock it in', note: 'He\'s found his spot.', effects: [{ op: 'morale', scope: 'self', amount: 4 }, { op: 'attr', scope: 'self', agg: 'improvisation', amount: 1 }] },
        { label: 'Put him back where he was', note: 'Worth the look; back to the drawing board.', effects: [{ op: 'swapLoadout', role: 'Vanguard', hero: 'Angelic' }, { op: 'morale', scope: 'self', amount: 1 }] },
      ],
    },
  ],
  epilogue: {
    resolved: 'Cardo finally stopped wondering what he could be somewhere else, and became it.',
    frozen: 'You gave Cardo the reps you promised, and the restlessness settled. Sometimes the seat was fine all along.',
    unstarted: 'Cardo played the whole season quietly sure he belonged somewhere else on the map, and never found out where.',
  },
};

// Yahyo — trust after loss. She guards her heart after her old team broke up; back her
// through her old teammate's tryout offer and she opens up (a Sisterhood bond).
const YAHYO: Arc = {
  id: 'yahyo-girlaxy',
  characterId: 'yahyo',
  beats: [
    {
      id: 'reruns',
      trigger: { slot: 'either', onWeek: 2 },
      kicker: 'After hours',
      headline: '{player} is watching old tape',
      body: "You catch her rewatching Girlaxy Gamers VODs — the team she loved, the one that fell apart when a teammate went pro. She's polite, sharp, and about a mile away behind the eyes.",
      scene: [
        { who: 'narrator', text: "Late. {player} hasn't logged off — she's rewatching old Girlaxy Gamers VODs, the same clutch round looping on the screen." },
        { speakerId: 'yahyo', text: "Oh — didn't see you there. Just... old tape. Girlaxy. Best roster I ever played on. We had something real, you know? Actual chemistry." },
        { who: 'narrator', text: "She says it lightly enough. Her eyes are somewhere a couple of years away — back with the team that fell apart the day a teammate went pro." },
      ],
      choices: [
        { label: 'Pull up a chair and watch with her', effects: [{ op: 'morale', scope: 'self', amount: 2 }, { op: 'setFlag', flag: 'yahyo-opened' }] },
        { label: 'Ask her about it', effects: [{ op: 'setFlag', flag: 'yahyo-opened' }] },
        { label: 'Leave her to it', effects: [] },
      ],
    },
    {
      id: 'starling',
      trigger: { slot: 'either', onWeek: 4, minGapSlots: 1 },
      kicker: 'A message from the past',
      headline: "{player}'s old teammate came calling",
      body: '"Starling\'s org wants me to try out. After the season." She says it flat, guarding. Last time a roster broke up it broke her — and here she is again, one foot out the door before she\'s even let herself in.',
      scene: [
        { who: 'narrator', text: "{player} slides a message across for you to read, her jaw set tight." },
        { speakerId: 'yahyo', text: "Starling's org wants me to try out. After the season. Starling — from Girlaxy. Landed on her feet, apparently. Good for her." },
        { speakerId: 'yahyo', text: "I'm not going anywhere mid-season, don't worry. It's just — last time I let a roster be my whole world, it broke me when it ended. I'm not doing that to myself twice." },
      ],
      choices: [
        { label: "Back her fully — she's ours till then, no strings", note: 'She stops guarding, and finds a sister on this team too.', effects: [{ op: 'removeTag', tagId: 'Guarded' }, { op: 'grantDuo', partner: 'imissu', tagId: 'Sisterhood', agg: 'leadership', amount: 3 }, { op: 'morale', scope: 'self', amount: 6 }] },
        { label: "Tell her you need her head here", note: 'Fair — but it reads like her old managers, and she closes back up.', effects: [{ op: 'morale', scope: 'self', amount: -2 }] },
      ],
    },
  ],
  epilogue: {
    resolved: 'Yahyo let this team in, in the end — and found the thing she lost with Girlaxy was rebuildable after all.',
    unstarted: 'Yahyo played every round like she was already halfway out the door, and never let anyone close enough to change that.',
  },
};

// WonManArmy — the temper, tested. A rage clip resurfaces; face it and the Short Fuse
// becomes Even Keel (and his community nights kick off) — or keep it light, fun over growth.
const WON: Arc = {
  id: 'won-temper',
  characterId: 'wonmanarmy',
  beats: [
    {
      id: 'the-clip',
      trigger: { slot: 'either', onWeek: 3 },
      kicker: 'It resurfaces',
      headline: 'An old clip of {player} losing it is going around',
      body: "Thirty seconds of a younger, angrier Won putting a keyboard through a monitor. His whole brand now is the guy who grew up — and he's mortified. Do you get into it?",
      scene: [
        { who: 'narrator', text: "A thirty-second clip is doing the rounds: a younger {player}, mid-meltdown, feeding a monitor a keyboard. He's seen it. Everyone's seen it." },
        { speakerId: 'wonmanarmy', text: "Yeah. That's me. Or — that was me. Ten years and a whole different person ago. My entire brand now is 'the guy who grew up,' and the internet just dug up the receipts." },
        { speakerId: 'wonmanarmy', text: "I'm not proud of it. Only question is whether we make a thing of it, or let it die on its own." },
      ],
      choices: [
        { label: 'Talk it through, privately', effects: [{ op: 'morale', scope: 'self', amount: 2 }, { op: 'setFlag', flag: 'won-honest' }] },
        { label: 'Laugh it off publicly, with him', effects: [{ op: 'morale', scope: 'self', amount: 1 }] },
        { label: 'Let it blow over', effects: [] },
      ],
    },
    {
      id: 'why-i-retired',
      trigger: { slot: 'either', onWeek: 5, minGapSlots: 1 },
      kicker: 'The real story',
      headline: "Why {player} really walked away",
      body: '"I didn\'t retire at my peak. I retired from myself — the anger was eating everything." He\'s scared competition wakes the worst of him. He floats stepping back to just making content.',
      scene: [
        { who: 'narrator', text: "The clip cracked something open. Later, quietly, {player} tells you the part he leaves out of the videos." },
        { speakerId: 'wonmanarmy', text: "Everyone thinks I retired at my peak. I didn't. I retired from myself. The anger was eating everything — my play, my friendships, all of it." },
        { speakerId: 'wonmanarmy', text: "And now I'm back in real competition and I can feel it stirring again. Maybe I should just stick to content. Stay the guy people already think I am." },
      ],
      choices: [
        { label: "You're not that guy anymore — stay and prove it", note: 'He faces it. Bad beats stop dragging him under, and the meetups start up again.', effects: [{ op: 'evolveTag', from: 'Short Fuse', to: 'Even Keel' }, { op: 'enableEventGroup', groupId: 'community' }, { op: 'morale', scope: 'self', amount: 6 }, { op: 'morale', scope: 'team', amount: 2 }] },
        { label: 'Keep it light — fun over growth', note: 'A legitimate choice: he stays, unburdened, exactly as he is.', effects: [{ op: 'morale', scope: 'self', amount: 4 }] },
      ],
    },
  ],
  epilogue: {
    resolved: 'The rager who couldn\'t control his own fire became the hearth the whole team warmed itself at.',
    frozen: 'Won kept it light, and kept himself whole. Some fights you win by refusing to have them.',
    unstarted: 'Won played the season for fun and never let it get its hooks in — which was, perhaps, the point.',
  },
};

// Potter — the analyst who unlocks tactical depth. His old on-air feud looms; trust his
// read and it opens the playbook wide (extra custom-play slots).
const POTTER: Arc = {
  id: 'potter-rival',
  characterId: 'potter',
  beats: [
    {
      id: 'the-rival',
      trigger: { slot: 'either', onWeek: 4 },
      kicker: 'Old business',
      headline: 'The team {player} trashed on-air is coming up',
      body: 'Last season, from the desk, he tore their setups apart on live TV. He stands by every word — but now he has to face them across a server, and the confidence has drained right out of him.',
      scene: [
        { who: 'narrator', text: "The bracket updates and {player} goes very still. Next up: the team he spent last season taking apart on live TV." },
        { speakerId: 'potter', text: "I stand by every word I said about them from that desk. Every word. Their setups were lazy and I called it, on air, to a live audience." },
        { speakerId: 'potter', text: "It's just... it's a lot easier to grade a man's positioning than to sit in the chair across from him and prove you could do it better." },
      ],
      effects: [{ op: 'grantTag', tagId: 'Nervous' }, { op: 'morale', scope: 'self', amount: -3 }],
    },
    {
      id: 'the-reckoning',
      trigger: { slot: 'either', onWeek: 6, minGapSlots: 1 },
      kicker: 'The game plan',
      headline: 'How much do you lean on {player}?',
      body: "He's built a dossier on them thick enough to choke a printer. The question is how far you trust the analyst to be a player — do you build the whole game plan around his read?",
      scene: [
        { who: 'narrator', text: "{player} drops a document on the table. It lands with a thud you can feel through your shoes." },
        { speakerId: 'potter', text: "Everything. Every tendency, every default, every time they over-rotate off a single piece of utility. I know this team better than they know themselves." },
        { speakerId: 'potter', text: "The only question left is how much of tonight you're willing to hang on the analyst who's never been the one actually holding the mouse." },
      ],
      choices: [
        { label: 'All in — build the plan around his intel', note: 'His nerves burn off, and the playbook opens right up.', effects: [{ op: 'removeTag', tagId: 'Nervous' }, { op: 'grantPlaybookSlots', amount: 2 }, { op: 'morale', scope: 'self', amount: 6 }] },
        { label: 'Hedge — use his read, but keep the basics close', note: 'A measured bet on the new guy.', effects: [{ op: 'removeTag', tagId: 'Nervous' }, { op: 'grantPlaybookSlots', amount: 1 }, { op: 'morale', scope: 'self', amount: 3 }] },
      ],
    },
  ],
  epilogue: {
    resolved: 'Potter proved the desk was never where he belonged. The reads that made him a good analyst made the team a nightmare to play.',
    unstarted: 'Potter kept his sharpest reads to himself all season, still half-convinced the players\' seats weren\'t for him.',
  },
};

export const ARCS: Record<string, Arc> = {
  [MOONY.id]: MOONY,
  [IMISSU.id]: IMISSU,
  [ECHO.id]: ECHO,
  [RONIN.id]: RONIN,
  [MOMMAMAY.id]: MOMMAMAY,
  [TOPF.id]: TOPF,
  [REINA.id]: REINA,
  [JOK3R.id]: JOK3R,
  [CARDO.id]: CARDO,
  [YAHYO.id]: YAHYO,
  [WON.id]: WON,
  [POTTER.id]: POTTER,
};
