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
      effects: [{ op: 'grantTag', tagId: 'Nervous' }, { op: 'morale', scope: 'self', amount: -3 }],
      persona: { Firebrand: '"I\'m gonna show her," he keeps saying — a little too loud, a little too often.' },
    },
    {
      id: 'steady-him',
      trigger: { slot: 'either', minGapSlots: 1 },
      kicker: 'Pressing',
      headline: '{player} is trying too hard',
      body: "With Nova in the room he's forcing highlight plays and whiffing the simple ones. The nerves are eating him alive. How do you settle him?",
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
      effects: [{ op: 'morale', scope: 'team', amount: -4 }, { op: 'morale', scope: 'self', amount: -6 }],
    },
    {
      id: 'statement',
      trigger: { slot: 'either', minGapSlots: 1 },
      kicker: 'Your call',
      headline: 'How does the team answer?',
      body: 'The reporters want a statement. What you say — and whether you keep him — is up to you.',
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
      effects: [{ op: 'morale', scope: 'self', amount: -3 }],
    },
    {
      id: 'the-talk',
      trigger: { slot: 'either', onWeek: 5, minGapSlots: 1 },
      kicker: 'The crossroads',
      headline: "What's {player}'s place on this team?",
      body: "She's made up her mind to decide. Where you land here decides whether she doubles down or steps away.",
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
      effects: [{ op: 'grantTag', tagId: 'Nervous' }, { op: 'morale', scope: 'self', amount: -3 }],
    },
    {
      id: 'the-reckoning',
      trigger: { slot: 'either', onWeek: 6, minGapSlots: 1 },
      kicker: 'The game plan',
      headline: 'How much do you lean on {player}?',
      body: "He's built a dossier on them thick enough to choke a printer. The question is how far you trust the analyst to be a player — do you build the whole game plan around his read?",
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
