// Phase 4 — the ambient event pool (data only). Each entry is a SeasonEvent; the
// runtime draws one (weighted) per non-special week slot. Lean opportunity/flavour
// for P4.1 (friction events with real downside arrive with the morale system).
// Effect numbers are small + hidden — the text carries the meaning qualitatively.

import type { SeasonEvent } from './types.ts';

export const AMBIENT_EVENTS: readonly SeasonEvent[] = [
  {
    id: 'scrim-up',
    weight: 2,
    kicker: 'Locker room',
    headline: 'A scrim against the big boys',
    body: 'You book a late-night scrim against a higher-ranked team. The squad gets run over — but they pick apart the VODs afterward and come away sharper readers of the game.',
    effects: [{ op: 'attr', scope: 'team', agg: 'gameSense', amount: 2 }],
    record: {
      strong: 'Even riding a good run, nobody coasted — they wanted to measure up against the best.',
      struggling: 'They needed the reminder that they belong on the same server as names like that.',
      even: 'Exactly the gut-check this team\'s been needing.',
    },
  },
  {
    id: 'grind',
    weight: 2,
    kicker: 'Locker room',
    headline: '{player} has been putting in the hours',
    body: '{player} has been first in and last out all week, grinding aim trainers and deathmatch. It is starting to show on the server.',
    subject: 'random',
    effects: [{ op: 'attr', scope: 'self', agg: 'mechanics', amount: 3 }],
    persona: {
      Firebrand: '"If I\'m not the best mechanic in this room, what am I even doing here?" {player} says. Only half joking.',
      Catalyst: '{player} keeps roping the others into the late sessions too — half of it is just wanting the company.',
      Analyst: '{player} keeps a spreadsheet of their own deathmatch splits. Of course they do.',
      Stabilizer: 'No fanfare from {player} — just there every night, quietly, before anyone else thinks to show.',
    },
    record: {
      strong: 'On a run like this, that hunger is what stops a team getting comfortable.',
      struggling: 'With results not coming, you can see them trying to drag the whole thing up by sheer effort.',
    },
  },
  {
    id: 'clinic',
    weight: 1,
    kicker: 'Opportunity',
    headline: 'A visiting pro runs a clinic',
    body: 'A retired pro is in town and offers the squad a one-day clinic. What do you have them focus on?',
    record: {
      strong: 'Riding high, they soak it all up — winners stay curious.',
      struggling: 'A fresh voice might be just what shakes the squad out of its rut.',
    },
    choices: [
      { label: 'Aim & mechanics', note: 'A day on crosshair placement and duels.', effects: [{ op: 'attr', scope: 'team', agg: 'mechanics', amount: 2 }] },
      { label: 'Reads & rotations', note: 'A day in the film room on positioning.', effects: [{ op: 'attr', scope: 'team', agg: 'gameSense', amount: 2 }] },
      { label: 'Composure under fire', note: 'A day on nerves and clutch situations.', effects: [{ op: 'attr', scope: 'team', agg: 'improvisation', amount: 2 }] },
    ],
  },
  {
    id: 'cafe-sponsor',
    weight: 1,
    kicker: 'Opportunity',
    headline: 'The cafe down the road chips in',
    body: 'A local cafe likes the underdog story and throws a little support behind the squad for the week.',
    effects: [{ op: 'leaguePoints', amount: 15 }],
    record: {
      strong: 'Winning makes the underdog story easy to root for — and the goodwill is snowballing.',
      struggling: 'Win or lose, the neighbourhood\'s stuck with you. That counts for something on a hard week.',
    },
  },
  {
    id: 'clash',
    weight: 1,
    kicker: 'Locker room',
    headline: 'Tension in the ranks',
    body: 'Two of your players got into it after a sloppy scrim and the room has gone cold. Do you step in?',
    record: {
      strong: 'Even winning, the friction is there — a good run can paper over real cracks.',
      struggling: 'The losing\'s got everyone\'s nerves frayed; this was always going to boil over.',
    },
    choices: [
      { label: 'Clear the air', note: 'Sit them down — costs time, but the squad comes out closer.', effects: [{ op: 'morale', scope: 'team', amount: 8 }] },
      { label: 'Let them stew, just grind', note: 'Skip the talk and drill — sharper hands, sourer mood.', effects: [{ op: 'morale', scope: 'team', amount: -6 }, { op: 'attr', scope: 'team', agg: 'mechanics', amount: 2 }] },
    ],
  },
  {
    id: 'rough-patch',
    weight: 1,
    kicker: 'Locker room',
    headline: '{player} is in their own head',
    body: '{player} has been quiet all week — the pressure is getting to them. How do you handle it?',
    subject: { lowest: 'improvisation' },
    persona: {
      Firebrand: 'It\'s eating at them loud — {player} doesn\'t do quiet doubt, and the whole room can hear it.',
      Catalyst: 'The strange part is how withdrawn they\'ve gone; {player} is usually the one lifting everyone else.',
      Analyst: '{player} has over-analysed it into a corner — every rep replayed a hundred times behind their eyes.',
      Stabilizer: '{player} would never breathe a word of it, which is exactly how you know it\'s bad.',
    },
    record: {
      strong: 'Odd, with the team winning — but the standard you\'ve set is its own kind of pressure.',
      struggling: 'The losing skid isn\'t helping; you can feel the whole room tightening up.',
    },
    choices: [
      { label: 'Ease off, steady them', note: 'A calmer week builds their nerve.', effects: [{ op: 'attr', scope: 'self', agg: 'improvisation', amount: 3 }] },
      { label: 'Drill it out of them', note: 'Bury the doubt under reps.', effects: [{ op: 'attr', scope: 'self', agg: 'mechanics', amount: 3 }] },
    ],
  },
];
