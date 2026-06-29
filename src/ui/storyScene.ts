// Phase 4 — a reusable click-to-advance dialogue runner (visual-novel style) for
// scripted story beats. A script is plain DATA (an array of StoryBeat); the runner
// plays it one line at a time with a placeholder-art slot, named speakers, and
// choice points whose options can show a flavour reply and set story flags.
// Choices are cosmetic-converging: they colour the scene + record hooks, but the
// script always continues on the same path. Authoring a new cutscene = new data.

export type Speaker = 'sam' | 'you' | 'caster' | 'narrator' | 'player' | 'npc';

// `name` overrides the speaker label — used for roster players (who: 'player').
export type StoryLine = { art?: string; who: Speaker; name?: string; text: string };
export type StoryChoiceOption = { label: string; reply?: StoryLine[]; set?: Record<string, string> };
export type StoryChoice = { art?: string; prompt?: string; options: StoryChoiceOption[] };
// A conversation HUB — optional topics the player can pick in any order (each plays
// some lines + may set a flag, then returns to the hub), plus a "move on" to exit.
export type StoryHubTopic = { label: string; lines: StoryLine[]; set?: Record<string, string> };
export type StoryHub = { art?: string; prompt?: string; topics: StoryHubTopic[]; proceedLabel?: string };
export type StoryBeat = StoryLine | StoryChoice | StoryHub;

export type StoryFlags = Record<string, string>;

const SPEAKER_NAME: Record<Speaker, string> = { sam: 'Sam', you: 'You', caster: 'Caster', narrator: '', player: 'Player', npc: '' };

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
function isChoice(b: StoryBeat): b is StoryChoice {
  return (b as StoryChoice).options !== undefined;
}
function isHub(b: StoryBeat): b is StoryHub {
  return (b as StoryHub).topics !== undefined;
}

export function playStory(beats: readonly StoryBeat[], onDone: (flags: StoryFlags) => void, onBack?: () => void): void {
  document.getElementById('story-scene')?.remove();
  const host = document.createElement('div');
  host.id = 'story-scene';
  document.body.appendChild(host);

  let i = 0;
  let replies: StoryLine[] = [];
  let art = '';
  let hubAt = -1;                       // which beat index the current hub-state belongs to
  let hubViewed = new Set<number>();    // topics already opened in the current hub
  const flags: StoryFlags = {};

  const finish = (): void => { host.remove(); onDone(flags); };

  const chrome = (): { skipBtn: string; backBtn: string; artBox: string } => ({
    skipBtn: '<button class="ss-skip" data-skip type="button">Skip ⏭</button>',
    backBtn: onBack && i === 0 && replies.length === 0 ? '<button class="ss-skip" data-back type="button">&larr; Back</button>' : '',
    artBox: `<div class="ss-art"><span class="ss-art-cap">🎬 ${esc(art || 'Scene')}</span><span class="ss-art-note">placeholder art</span></div>`,
  });

  const renderHub = (hub: StoryHub): void => {
    if (hubAt !== i) { hubAt = i; hubViewed = new Set(); }
    if (hub.art) art = hub.art;
    const { skipBtn, backBtn, artBox } = chrome();
    const topicBtns = hub.topics.map((t, idx) =>
      hubViewed.has(idx) ? '' : `<button class="ss-choice" data-topic="${idx}" type="button">${esc(t.label)}</button>`).join('');
    const proceedBtn = `<button class="ss-choice ss-proceed" data-proceed type="button">${esc(hub.proceedLabel ?? 'Move on')}</button>`;
    host.innerHTML = `
      <div class="ss-stage">
        <div class="ss-top">${backBtn}${skipBtn}</div>
        ${artBox}
        <div class="ss-box ss-choicebox">
          ${hub.prompt ? `<div class="ss-prompt">${esc(hub.prompt)}</div>` : ''}
          <div class="ss-choices">${topicBtns}${proceedBtn}</div>
        </div>
      </div>`;
    host.querySelectorAll<HTMLButtonElement>('[data-topic]').forEach((b) => b.addEventListener('click', () => {
      const idx = parseInt(b.getAttribute('data-topic') ?? '0', 10);
      hubViewed.add(idx);
      const t = hub.topics[idx];
      if (t.set) Object.assign(flags, t.set);
      replies = [...t.lines]; // play this topic's lines, then return to the hub (i unchanged)
      render();
    }));
    host.querySelector<HTMLButtonElement>('[data-proceed]')?.addEventListener('click', () => { i += 1; render(); });
    host.querySelector<HTMLButtonElement>('[data-skip]')?.addEventListener('click', finish);
    host.querySelector<HTMLButtonElement>('[data-back]')?.addEventListener('click', () => { host.remove(); onBack?.(); });
  };

  const render = (): void => {
    if (replies.length === 0 && i >= beats.length) { finish(); return; }
    // Hub beat (only when no topic-reply is mid-play) — a conversation menu.
    if (replies.length === 0 && isHub(beats[i])) { renderHub(beats[i] as StoryHub); return; }
    const item = (replies.length > 0 ? replies[0] : beats[i]) as StoryLine | StoryChoice;
    if (item.art) art = item.art;

    const skipBtn = '<button class="ss-skip" data-skip type="button">Skip ⏭</button>';
    const backBtn = onBack && i === 0 && replies.length === 0 ? '<button class="ss-skip" data-back type="button">&larr; Back</button>' : '';
    const artBox = `<div class="ss-art"><span class="ss-art-cap">🎬 ${esc(art || 'Scene')}</span><span class="ss-art-note">placeholder art</span></div>`;

    if (!isChoice(item)) {
      const who = item.name ?? SPEAKER_NAME[item.who];
      const cls = `ss-line ss-${item.who}`;
      const nameTag = who ? `<div class="ss-speaker">${esc(who)}</div>` : '';
      host.innerHTML = `
        <div class="ss-stage">
          <div class="ss-top">${backBtn}${skipBtn}</div>
          ${artBox}
          <button class="ss-box ${cls}" data-next type="button">
            ${nameTag}
            <div class="ss-text">${esc(item.text)}</div>
            <div class="ss-cue">▸</div>
          </button>
        </div>`;
      host.querySelector<HTMLButtonElement>('[data-next]')?.addEventListener('click', advance);
    } else {
      const opts = item.options.map((o, idx) =>
        `<button class="ss-choice" data-opt="${idx}" type="button">${esc(o.label)}</button>`).join('');
      host.innerHTML = `
        <div class="ss-stage">
          <div class="ss-top">${backBtn}${skipBtn}</div>
          ${artBox}
          <div class="ss-box ss-choicebox">
            ${item.prompt ? `<div class="ss-prompt">${esc(item.prompt)}</div>` : ''}
            <div class="ss-choices">${opts}</div>
          </div>
        </div>`;
      host.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach((b) => b.addEventListener('click', () => {
        const o = item.options[parseInt(b.getAttribute('data-opt') ?? '0', 10)];
        if (o.set) Object.assign(flags, o.set);
        replies = o.reply ? [...o.reply] : [];
        i += 1; // advance past the choice; replies (if any) play first
        render();
      }));
    }
    host.querySelector<HTMLButtonElement>('[data-skip]')?.addEventListener('click', finish);
    host.querySelector<HTMLButtonElement>('[data-back]')?.addEventListener('click', () => { host.remove(); onBack?.(); });
  };

  const advance = (): void => {
    if (replies.length > 0) replies = replies.slice(1);
    else i += 1;
    render();
  };

  render();
}
