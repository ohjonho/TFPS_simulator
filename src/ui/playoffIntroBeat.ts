// Playoff framing beats — the bridge into the knockout climax, and the grand-final
// BOOKEND that mirrors the opening (which opened on watching a Worlds grand-final
// clutch on the café wall, Sam going "ice in the veins"):
//   • showPlayoffIntroBeat — MADE the top 4: Sam frames the shift to knockout and
//     what's at stake, building into the bracket. Seeds the bookend (the café wall).
//   • showSeasonMissedBeat — fell short: a brief, honest "we came up short".
//   • showFinalIntroBeat — before YOUR final: the café wall again, but the team on
//     it is yours now; a caster hypes it, Sam recalls the clutch you watched.
//   • showChampionBeat — you WON it: the broadcast crowns Pixel Perfect, and Sam's
//     "ice in the veins" from the opening comes back — now about your team.
// Sam carries them (his portrait shows on the VN stage); the coach stays faceless.

import type { SeasonState } from '../game/season.ts';
import { playStory, type StoryBeat } from './storyScene.ts';
import { playerRank } from '../game/standings.ts';
import { LEAGUE } from '../game/config.ts';

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export function showPlayoffIntroBeat(season: SeasonState, onDone: () => void): void {
  const rank = playerRank(season);
  const wins = season.results.filter((r) => r === 'W').length;
  const losses = season.results.length - wins;
  const beats: StoryBeat[] = [
    { art: 'The regular season, done — the league table locks', who: 'narrator', text: `Eight matches played. The table locks, and Pixel Perfect finishes ${ordinal(rank)} — inside the top ${LEAGUE.playoffTeams}. You're in the playoffs.` },
    { who: 'sam', text: `We made it. We actually made it. A ${wins}-and-${losses} café side, in the bracket — do you have any idea how many people said that couldn't happen?` },
    { who: 'sam', text: `A year ago we watched the pros do this on that wall. Now it's us up there.` },
    { who: 'you', text: 'So what changes now?' },
    { who: 'sam', text: `Everything. The table's meaningless from here — it's straight knockout. Win, or the season's over. No second chances, no next round.` },
    { who: 'sam', text: `Two matches stand between us and the prize. A semifinal, then the final. Win them both, and Pixel Perfect keeps its doors open — for good.` },
    {
      art: 'Sam, nodding at the bracket now taped above the counter',
      prompt: 'How do you send them into the knockouts?',
      options: [
        { label: 'Swing for it — nothing to lose now.', reply: [{ who: 'sam', text: `That's the spirit. Play like the underdogs we are — loose and fearless.` }] },
        { label: 'Same as all season. Trust the work.', reply: [{ who: 'sam', text: `No panic, no reinventing it. Just us, at our best. I like it.` }] },
        { label: 'One match at a time — the semi first.', reply: [{ who: 'sam', text: `Eyes on the next one only. Win it, then we worry about the final. Smart.` }] },
      ],
    },
    { art: 'The squad, loose and ready', who: 'sam', text: `Alright. Let's go be the story nobody saw coming.` },
  ];
  playStory(beats, () => onDone());
}

export function showSeasonMissedBeat(season: SeasonState, onDone: () => void): void {
  const rank = playerRank(season);
  const beats: StoryBeat[] = [
    { art: 'The final table — Pixel Perfect just the wrong side of the line', who: 'narrator', text: `The regular season ends. Pixel Perfect finishes ${ordinal(rank)} — short of the top ${LEAGUE.playoffTeams}. No playoffs this year.` },
    { who: 'sam', text: `...Well. That's that, then. We came up short.` },
    { who: 'you', text: 'We were close.' },
    { who: 'sam', text: `We were. And close isn't nothing — this squad had no business being this close. But it doesn't save the shop. Not this year.` },
    { who: 'sam', text: `So we take what we learned, we keep who we can, and we come back hungrier. There's always next season. ...There has to be.` },
  ];
  playStory(beats, () => onDone());
}

// The grand-final BOOKEND (open): before the player's own final, the café wall shows
// their team where it once showed the pros — Sam recalls the clutch you watched in
// the opening. Reads the opening's stored Worlds flags for the callback.
export function showFinalIntroBeat(season: SeasonState, onDone: () => void): void {
  const champ = season.storyFlags?.worldsChampion ?? 'the champions';
  const star = season.storyFlags?.worldsChampionStar ?? '';
  const watched = star ? `${star} of ${champ}` : champ;
  const beats: StoryBeat[] = [
    { art: 'Match day at the café — every screen mirrored to the wall, the house packed', who: 'narrator', text: `Pixel Perfect. Match day. Every machine in the place is mirrored to the big screen on the wall — the same wall, the same packed house. Only this time, the team up there is yours.` },
    { who: 'sam', text: `A year ago we sat right here and watched ${watched} lift a trophy on this screen. "Ice in the veins," I said. Remember?` },
    { who: 'you', text: 'I remember.' },
    { who: 'sam', text: `And now look at us. One match, one title — a café side that had no business getting this far. It's YOUR grand final.` },
    { art: 'On screen — the broadcast desk, the final about to begin', who: 'caster', text: `— and we are LIVE for the Amateur Circuit grand final! One match, one title, and a Cinderella run one win from the perfect ending. Here. We. Go.` },
    { who: 'sam', text: `This is the one, coach. Everything we've built comes down to the next few rounds. Go and take it.` },
  ];
  playStory(beats, () => onDone());
}

// The grand-final BOOKEND (close): you WON it. The broadcast crowns Pixel Perfect in
// the opening's voice, and Sam's "ice in the veins" comes back around — now about
// your team, on the wall where you once watched someone else's.
export function showChampionBeat(onDone: () => void): void {
  const beats: StoryBeat[] = [
    { art: 'On screen — the last round falls, the café erupting', who: 'caster', text: `THAT'S IT — IT'S OVER! PIXEL PERFECT ARE YOUR CHAMPIONS! A café side, a roster of nobodies — champions of the circuit. You will not see a better story all year!` },
    { art: 'Inside the café — the room comes apart', who: 'narrator', text: `The café detonates. Chairs go over, drinks go up, someone's already crying. The wall that showed you someone else's grand final a year ago is showing your team lifting one now.` },
    { who: 'sam', text: `Did you SEE that?! ICE IN THE VEINS! Absolute ICE!` },
    { who: 'you', text: 'We did it.' },
    { who: 'sam', text: `We did it. We actually did it — the shop, the team, all of it — because you believed a stupid idea in a half-empty café. ...Thank you.` },
  ];
  playStory(beats, () => onDone());
}
