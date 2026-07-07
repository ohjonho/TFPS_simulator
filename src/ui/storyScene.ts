// A reusable click-to-advance VISUAL-NOVEL runner for scripted beats + arc scenes.
// A script is plain DATA (StoryBeat[]); the runner plays it one line at a time over
// a gradient stage with positioned character PORTRAITS — 1 centered / 2 left-right /
// 3 spread — lit for the speaker, dimmed otherwise. Portraits + display names come
// from ui/characterVisual (Remi stays "???" until met). A line with no speakerId
// (the coach = 'you', or 'narrator') shows no portrait: the coach is faceless.
// Choice/hub points branch or set flags. Authoring a new scene = new data.

import { castVisual, displayName, silhouetteSvg } from './characterVisual.ts';

export type Speaker = 'sam' | 'you' | 'caster' | 'narrator' | 'player' | 'npc';

// `speakerId` = a cast id (characterId or NPC like 'sam'/'remi'/'nova') → a portrait
// + registry name. `who`/`name` remain for portrait-less lines (backward-compatible).
// `clearStage` drops the current cast before this speaker enters — a solo spotlight
// (a big-cast scene like the team meeting can't hold everyone under the ≤3 cap).
// `set` applies story flags as the line shows — used for a name reveal (e.g. Remi
// flips from "???" to his name the moment he introduces himself).
// `portraitId` shows + lights a character's portrait WITHOUT a speaker nameplate —
// for narration over a face (e.g. the season epilogue reflecting on each player).
export type StoryLine = { art?: string; who: Speaker; speakerId?: string; portraitId?: string; name?: string; text: string; clearStage?: boolean; set?: Record<string, string> };
export type StoryChoiceOption = { label: string; reply?: StoryLine[]; set?: Record<string, string> };
export type StoryChoice = { art?: string; prompt?: string; options: StoryChoiceOption[] };
export type StoryHubTopic = { label: string; lines: StoryLine[]; set?: Record<string, string> };
export type StoryHub = { art?: string; prompt?: string; topics: StoryHubTopic[]; proceedLabel?: string };
export type StoryBeat = StoryLine | StoryChoice | StoryHub;

export type StoryFlags = Record<string, string>;

const SPEAKER_NAME: Record<Speaker, string> = { sam: 'Sam', you: 'You', caster: 'Caster', narrator: '', player: 'Player', npc: '' };
// `who` values that map to a registry portrait when no explicit speakerId is given.
const WHO_PORTRAIT: Partial<Record<Speaker, string>> = { sam: 'sam', caster: 'caster' };
// left% for each portrait slot, by how many are on stage.
const POSITIONS: Record<number, number[]> = { 1: [50], 2: [30, 70], 3: [20, 50, 80] };

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function isChoice(b: StoryBeat): b is StoryChoice { return (b as StoryChoice).options !== undefined; }
function isHub(b: StoryBeat): b is StoryHub { return (b as StoryHub).topics !== undefined; }

export function playStory(beats: readonly StoryBeat[], onDone: (flags: StoryFlags) => void, onBack?: () => void, initialFlags?: StoryFlags): void {
  document.getElementById('story-scene')?.remove();
  const host = document.createElement('div');
  host.id = 'story-scene';
  document.body.appendChild(host);

  let i = 0;
  let replies: StoryLine[] = [];
  let art = '';
  let hubAt = -1;
  let hubViewed = new Set<number>();
  const stage: string[] = [];            // cast on screen (≤3), in appearance order
  let lastSpeaker: string | null = null; // frames choice / hub screens
  const flags: StoryFlags = { ...(initialFlags ?? {}) }; // seed name-reveal etc. from season flags

  const finish = (): void => { host.remove(); onDone(flags); };
  const addToStage = (id: string): void => { if (!stage.includes(id) && stage.length < 3) stage.push(id); };
  const portraitIdOf = (line: StoryLine): string | null => line.speakerId ?? WHO_PORTRAIT[line.who] ?? null;

  const topHtml = (): string => {
    const skipBtn = '<button class="ss-skip" data-skip type="button">Skip ⏭</button>';
    const backBtn = onBack && i === 0 && replies.length === 0 ? '<button class="ss-skip" data-back type="button">&larr; Back</button>' : '';
    return `<div class="ss-top">${backBtn}${skipBtn}</div>`;
  };

  // The gradient stage + positioned portraits; the current speaker is lit.
  const sceneHtml = (speaker: string | null): string => {
    const pos = POSITIONS[stage.length] ?? POSITIONS[3];
    const portraits = stage.map((id, idx) => {
      const { tint } = castVisual(id);
      const dim = id !== speaker ? ' ss-dim' : '';
      return `<div class="ss-portrait${dim}" style="left:${pos[idx] ?? 50}%">`
        + silhouetteSvg(tint)
        + `<div class="ss-nameplate" style="border-color:${tint}">${esc(displayName(id, flags))}</div>`
        + `</div>`;
    }).join('');
    return `<div class="ss-scene"><div class="ss-portraits">${portraits}</div>`
      + (art ? `<div class="ss-scene-cap">${esc(art)}</div>` : '')
      + `</div>`;
  };

  const wire = (): void => {
    host.querySelector<HTMLButtonElement>('[data-skip]')?.addEventListener('click', finish);
    host.querySelector<HTMLButtonElement>('[data-back]')?.addEventListener('click', () => { host.remove(); onBack?.(); });
  };

  const renderHub = (hub: StoryHub): void => {
    if (hubAt !== i) { hubAt = i; hubViewed = new Set(); }
    if (hub.art) art = hub.art;
    const topicBtns = hub.topics.map((t, idx) => hubViewed.has(idx) ? '' : `<button class="ss-choice" data-topic="${idx}" type="button">${esc(t.label)}</button>`).join('');
    const proceedBtn = `<button class="ss-choice ss-proceed" data-proceed type="button">${esc(hub.proceedLabel ?? 'Move on')}</button>`;
    host.innerHTML = `<div class="ss-stage">${topHtml()}${sceneHtml(lastSpeaker)}
      <div class="ss-box ss-choicebox">${hub.prompt ? `<div class="ss-prompt">${esc(hub.prompt)}</div>` : ''}
        <div class="ss-choices">${topicBtns}${proceedBtn}</div></div></div>`;
    host.querySelectorAll<HTMLButtonElement>('[data-topic]').forEach((b) => b.addEventListener('click', () => {
      const idx = parseInt(b.getAttribute('data-topic') ?? '0', 10);
      hubViewed.add(idx);
      const t = hub.topics[idx];
      if (t.set) Object.assign(flags, t.set);
      replies = [...t.lines];
      render();
    }));
    host.querySelector<HTMLButtonElement>('[data-proceed]')?.addEventListener('click', () => { i += 1; render(); });
    wire();
  };

  const render = (): void => {
    if (replies.length === 0 && i >= beats.length) { finish(); return; }
    if (replies.length === 0 && isHub(beats[i])) { renderHub(beats[i] as StoryHub); return; }
    const item = (replies.length > 0 ? replies[0] : beats[i]) as StoryLine | StoryChoice;
    if (item.art) art = item.art;

    if (!isChoice(item)) {
      if (item.set) Object.assign(flags, item.set); // apply flag changes (e.g. name reveal) as the line shows
      if (item.clearStage) stage.length = 0; // solo spotlight — drop the current cast
      const pid = portraitIdOf(item);                  // the SPEAKER's portrait (drives the nameplate)
      const facePid = pid ?? item.portraitId ?? null;  // who to show + light on stage (portraitId = a face w/o a nameplate)
      if (facePid) { addToStage(facePid); lastSpeaker = facePid; }
      let nameTag: string;
      if (pid) {
        const { tint } = castVisual(pid);
        nameTag = `<div class="ss-speaker" style="color:${tint}">${esc(displayName(pid, flags))}</div>`;
      } else {
        const who = item.name ?? SPEAKER_NAME[item.who];
        nameTag = who ? `<div class="ss-speaker">${esc(who)}</div>` : '';
      }
      host.innerHTML = `<div class="ss-stage">${topHtml()}${sceneHtml(facePid)}
        <button class="ss-box ss-line ss-${item.who}" data-next type="button">
          ${nameTag}<div class="ss-text">${esc(item.text)}</div><div class="ss-cue">▸</div>
        </button></div>`;
      host.querySelector<HTMLButtonElement>('[data-next]')?.addEventListener('click', advance);
    } else {
      const opts = item.options.map((o, idx) => `<button class="ss-choice" data-opt="${idx}" type="button">${esc(o.label)}</button>`).join('');
      host.innerHTML = `<div class="ss-stage">${topHtml()}${sceneHtml(lastSpeaker)}
        <div class="ss-box ss-choicebox">${item.prompt ? `<div class="ss-prompt">${esc(item.prompt)}</div>` : ''}
          <div class="ss-choices">${opts}</div></div></div>`;
      host.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach((b) => b.addEventListener('click', () => {
        const o = item.options[parseInt(b.getAttribute('data-opt') ?? '0', 10)];
        if (o.set) Object.assign(flags, o.set);
        replies = o.reply ? [...o.reply] : [];
        i += 1;
        render();
      }));
    }
    wire();
  };

  const advance = (): void => {
    if (replies.length > 0) replies = replies.slice(1);
    else i += 1;
    render();
  };

  render();
}
