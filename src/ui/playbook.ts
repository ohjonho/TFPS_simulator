// Playbook (Part 5 B1 + B2.3) — the "adapt & save / author" editor. A between-
// matches, full-screen overlay (reached from Match Prep) where the manager either
// CLONES a basic strategy and retargets it, or builds one FROM SCRATCH on a blank
// slate; sets each slot's region; adds + toggles directives; names it; and saves
// it as a player-authored play. Saved plays land on SeasonState.customStrategies
// (B0), resolve everywhere via the strategy registry, are pickable in the in-match
// menu, and get a background assistant-coach review (B1b). Pure DOM.

import type { MapDefinition, Side } from '../game/types.ts';
import {
  strategiesFor,
  type Strategy,
  type StrategyVariant,
  type SlotPick,
} from '../game/strategies.ts';
import type { DirectiveSpec } from '../game/directives.ts';
import { coachRead } from '../game/playbookCoach.ts';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export type PlaybookCallbacks = {
  onSave: (play: Strategy) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

// HexRef → short human label (region name, or the spawn shorthand).
function refLabel(ref: unknown): string {
  if (ref && typeof ref === 'object') {
    const r = ref as { region?: string; spawn?: string };
    if (r.region) return r.region;
    if (r.spawn) return `${r.spawn} spawn`;
  }
  return '?';
}

// One-line description of a directive for the toggle list.
function directiveLabel(spec: DirectiveSpec): string {
  switch (spec.kind) {
    case 'hold_angle': return `Hold angle → ${refLabel(spec.facing)}`;
    case 'safe_sniper': return `Sniper angle → ${refLabel(spec.angle)}`;
    case 'rotate_on_team_contact': return `Rotate on contact → ${refLabel(spec.rotateTo)}`;
    case 'trade_for': return `Trade for ${spec.ally}`;
    case 'peek_and_retreat': return `Peek & retreat → ${refLabel(spec.peek)}`;
    case 'commit_site': return `Commit site → ${refLabel(spec.site)}`;
    case 'read_and_commit': return `Read & commit`;
    default: return (spec as { kind: string }).kind;
  }
}

// Next free authored id of the form `<prefix>_c<N>` (never collides with a builtin
// id, which has no `_c` suffix).
function uniqueAuthoredId(prefix: string, taken: ReadonlySet<string>): string {
  let n = 1;
  while (taken.has(`${prefix}_c${n}`)) n++;
  return `${prefix}_c${n}`;
}

// --- author-from-scratch (B2.3) -------------------------------------------
const BLANK = '__blank__';
const RIFLE: SlotPick = { preferWeapon: 'rifle' };
const SNIPER: SlotPick = { preferWeapon: 'sniper' };

// A blank 5-slot skeleton (4 rifles + 1 sniper, matching LOADOUTS) on a neutral
// region with no directives — the player sets regions + adds directives.
function blankVariant(): StrategyVariant {
  return [
    { id: 'pos1', pick: RIFLE, region: 'mid', directives: [] },
    { id: 'pos2', pick: RIFLE, region: 'mid', directives: [] },
    { id: 'pos3', pick: RIFLE, region: 'mid', directives: [] },
    { id: 'pos4', pick: RIFLE, region: 'mid', directives: [] },
    { id: 'pos5', pick: SNIPER, region: 'mid', directives: [] },
  ];
}

// Directive kinds the "add" UI can append. `ref` = the extra input the kind needs
// (a region, an ally slot id, or nothing). `build` makes a well-formed spec
// (priorities mirror the strategies.ts authoring helpers).
type AddableKind = { kind: string; label: string; ref: 'region' | 'slot' | 'none'; build: (arg: string) => DirectiveSpec };
const ADDABLE: AddableKind[] = [
  { kind: 'hold_angle', label: 'Hold angle', ref: 'region', build: (r) => ({ kind: 'hold_angle', facing: { region: r }, priority: 50 }) },
  { kind: 'safe_sniper', label: 'Sniper angle', ref: 'region', build: (r) => ({ kind: 'safe_sniper', angle: { region: r }, priority: 55 }) },
  { kind: 'commit_site', label: 'Commit to site', ref: 'region', build: (r) => ({ kind: 'commit_site', site: { region: r }, priority: 70 }) },
  { kind: 'peek_and_retreat', label: 'Peek & retreat', ref: 'region', build: (r) => ({ kind: 'peek_and_retreat', peek: { region: r }, cadenceTicks: 4, priority: 65 }) },
  { kind: 'trade_for', label: 'Trade for ally', ref: 'slot', build: (s) => ({ kind: 'trade_for', ally: s, windowTicks: 4, priority: 40 }) },
  { kind: 'read_and_commit', label: 'Read & commit', ref: 'none', build: () => ({ kind: 'read_and_commit', priority: 70 }) },
];

export function showPlaybook(
  map: MapDefinition,
  existing: readonly Strategy[],
  cb: PlaybookCallbacks,
): { refresh: () => void } {
  document.getElementById('playbook')?.remove();
  const host = document.createElement('div');
  host.id = 'playbook';
  document.body.appendChild(host);

  const regionOptions = Object.keys(map.regions).sort();
  const plays: Strategy[] = existing.map((s) => s); // live copy for the saved list

  // --- editor state ---
  let side: Side = 'defender';
  let baseId: string | null = null; // a builtin id, BLANK, or null (nothing picked)
  let sourceVariant = 0;
  let name = '';
  // Working copy of the chosen variant's slots (region/directive edits mutate this).
  let working: StrategyVariant | null = null;
  // Directives toggled OFF, keyed `${slotIdx}:${dirIdx}` against the working set.
  const disabled = new Set<string>();

  const bases = (): Strategy[] => strategiesFor(side, map).filter((s) => !s.authored);
  const base = (): Strategy | null => bases().find((s) => s.id === baseId) ?? null;

  // Options for the add-directive ref select, by the chosen kind.
  const refOptionsFor = (kind: string): string => {
    const k = ADDABLE.find((a) => a.kind === kind);
    if (!k || k.ref === 'none') return '<option value="">(no target)</option>';
    if (k.ref === 'slot') return (working ?? []).map((s) => `<option value="${s.id}">${s.id}</option>`).join('');
    return regionOptions.map((r) => `<option value="${r}">${r}</option>`).join('');
  };

  const loadVariant = (): void => {
    disabled.clear();
    if (baseId === BLANK) { working = blankVariant(); return; }
    const b = base();
    working = b ? structuredClone(b.variants[sourceVariant] ?? b.variants[0] ?? []) : null;
  };

  const selectBase = (id: string): void => {
    baseId = id;
    sourceVariant = 0;
    if (id === BLANK) name = 'New play';
    else { const b = base(); name = b ? `${b.name} (custom)` : ''; }
    loadVariant();
    render();
  };

  const save = (): void => {
    if (!working) return;
    const taken = new Set<string>([...plays.map((s) => s.id), ...strategiesFor(side, map).map((s) => s.id)]);
    const variant: StrategyVariant = working.map((slot, si) => ({
      ...slot,
      directives: slot.directives.filter((_d, di) => !disabled.has(`${si}:${di}`)),
    }));
    let play: Strategy;
    if (baseId === BLANK) {
      play = {
        id: uniqueAuthoredId('custom', taken), name: name.trim() || 'New play', side,
        description: 'Custom · authored from scratch',
        variants: [variant], fallbackRegion: 'mid', aggressionMod: 0, retreatThresholdMod: 0, authored: true,
      };
    } else {
      const b = base();
      if (!b) return;
      play = {
        ...b, id: uniqueAuthoredId(b.id, taken),
        name: name.trim() || `${b.name} (custom)`,
        description: `Custom · adapted from ${b.name}`,
        authored: true, variants: [variant],
      };
    }
    plays.push(play);
    cb.onSave(play);
    baseId = null; working = null; name = ''; disabled.clear();
    render();
  };

  const removePlay = (id: string): void => {
    const i = plays.findIndex((s) => s.id === id);
    if (i >= 0) plays.splice(i, 1);
    cb.onDelete(id);
    render();
  };

  const render = (): void => {
    const b = base();
    const sideBtns = (['defender', 'attacker'] as Side[]).map((sd) =>
      `<button class="mp-opt ${sd === side ? 'sel' : ''}" data-side="${sd}"><b>${sd === 'defender' ? 'Defense' : 'Attack'}</b></button>`).join('');

    const blankBtn = `<button class="mp-opt ${baseId === BLANK ? 'sel' : ''}" data-base="${BLANK}"><b>＋ Blank slate</b><span>build a play from scratch</span></button>`;
    const baseBtns = blankBtn + bases().map((s) =>
      `<button class="mp-opt ${s.id === baseId ? 'sel' : ''}" data-base="${s.id}"><b>${s.name}</b><span>${s.description}</span></button>`).join('');

    const variantPicker = b && b.variants.length > 1
      ? `<div class="pb-row"><span class="pb-label">Start from variant</span>${b.variants.map((_v, i) =>
          `<button class="pb-chip ${i === sourceVariant ? 'sel' : ''}" data-variant="${i}">${String.fromCharCode(65 + i)}</button>`).join('')}</div>`
      : '';

    const kindOpts = ADDABLE.map((k) => `<option value="${k.kind}">${k.label}</option>`).join('');
    const slotEditor = working ? working.map((slot, si) => {
      const opts = regionOptions.map((r) => `<option value="${r}" ${r === slot.region ? 'selected' : ''}>${r}</option>`).join('');
      const dirs = slot.directives.map((d, di) => {
        const key = `${si}:${di}`;
        return `<label class="pb-dir"><input type="checkbox" data-dir="${key}" ${disabled.has(key) ? '' : 'checked'}/> ${directiveLabel(d)}</label>`;
      }).join('') || `<span class="pb-none">no directives</span>`;
      return `<div class="pb-slot">
        <div class="pb-slot-head"><span class="pb-slot-id">${slot.id}</span>
          <select class="pb-region" data-region="${si}">${opts}</select></div>
        <div class="pb-dirs">${dirs}</div>
        <div class="pb-add">
          <select class="pb-add-kind" data-add-kind="${si}">${kindOpts}</select>
          <select class="pb-add-ref" data-add-ref="${si}">${refOptionsFor(ADDABLE[0].kind)}</select>
          <button class="pb-add-btn" data-add="${si}" type="button">+ add</button>
        </div>
      </div>`;
    }).join('') : '';

    const savedList = plays.length
      ? plays.map((s) => {
          const read = s.measured ? coachRead(s, s.measured.matchups) : null;
          const coach = read
            ? `<div class="pb-coach v-${read.verdict}"><span class="pb-coach-tag">🧑‍🏫 Coach</span> <b>${esc(read.headline)}</b><div class="pb-coach-detail">${esc(read.character)} ${esc(read.advice)}</div></div>`
            : `<div class="pb-coach pending"><span class="pb-coach-tag">🧑‍🏫 Coach</span> reviewing this play…</div>`;
          return `<div class="pb-saved">
            <div class="pb-saved-head"><span>${esc(s.name)} <small>(${s.side === 'defender' ? 'def' : 'atk'})</small></span><button class="pb-del" data-del="${s.id}">Delete</button></div>
            ${coach}
          </div>`;
        }).join('')
      : `<div class="pb-none">No saved plays yet.</div>`;

    host.innerHTML = `
      <div class="mp-card pb-card">
        <div class="mp-header">
          <div class="mp-kicker">Playbook · adapt &amp; author</div>
          <h1>Author a play</h1>
        </div>
        <div class="pb-grid">
          <div class="pb-col">
            <div class="mp-group-label">Side</div>
            <div class="pb-opts2">${sideBtns}</div>
            <div class="mp-group-label" style="margin-top:14px">Start from</div>
            <div class="pb-bases">${baseBtns}</div>
          </div>
          <div class="pb-col">
            ${working ? `
              ${variantPicker}
              <div class="pb-row"><span class="pb-label">Name</span><input class="pb-name" type="text" value="${name.replace(/"/g, '&quot;')}" placeholder="My play"/></div>
              <div class="mp-group-label" style="margin-top:12px">Slots — set region · add / toggle directives</div>
              <div class="pb-slots">${slotEditor}</div>
            ` : `<div class="pb-hint">Pick a side, then a base to adapt or a blank slate to build from scratch.</div>`}
          </div>
        </div>
        <div class="mp-group-label" style="margin-top:20px">Saved plays</div>
        <div class="pb-savedlist">${savedList}</div>
        <div class="mp-actions pb-actions">
          <button class="btn-back" data-close type="button">&larr; Done</button>
          <button class="btn-primary" data-save type="button" ${working ? '' : 'disabled'}>Save play</button>
        </div>
      </div>`;

    host.querySelectorAll<HTMLButtonElement>('[data-side]').forEach((el) => el.addEventListener('click', () => {
      side = el.getAttribute('data-side') as Side; baseId = null; working = null; render();
    }));
    host.querySelectorAll<HTMLButtonElement>('[data-base]').forEach((el) => el.addEventListener('click', () => selectBase(el.getAttribute('data-base')!)));
    host.querySelectorAll<HTMLButtonElement>('[data-variant]').forEach((el) => el.addEventListener('click', () => {
      sourceVariant = parseInt(el.getAttribute('data-variant')!, 10); loadVariant(); render();
    }));
    host.querySelectorAll<HTMLSelectElement>('[data-region]').forEach((el) => el.addEventListener('change', () => {
      const si = parseInt(el.getAttribute('data-region')!, 10);
      if (working && working[si]) working[si] = { ...working[si], region: el.value };
    }));
    host.querySelectorAll<HTMLInputElement>('[data-dir]').forEach((el) => el.addEventListener('change', () => {
      const key = el.getAttribute('data-dir')!;
      if (el.checked) disabled.delete(key); else disabled.add(key);
    }));
    // Add-directive: kind change repopulates the ref select; + add appends a spec.
    host.querySelectorAll<HTMLSelectElement>('[data-add-kind]').forEach((el) => el.addEventListener('change', () => {
      const si = el.getAttribute('data-add-kind')!;
      const ref = host.querySelector<HTMLSelectElement>(`[data-add-ref="${si}"]`);
      if (ref) ref.innerHTML = refOptionsFor(el.value);
    }));
    host.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((el) => el.addEventListener('click', () => {
      const si = parseInt(el.getAttribute('data-add')!, 10);
      const kindSel = host.querySelector<HTMLSelectElement>(`[data-add-kind="${si}"]`);
      const refSel = host.querySelector<HTMLSelectElement>(`[data-add-ref="${si}"]`);
      const k = ADDABLE.find((a) => a.kind === kindSel?.value);
      if (!k || !working || !working[si]) return;
      working[si] = { ...working[si], directives: [...working[si].directives, k.build(refSel?.value ?? '')] };
      render();
    }));
    host.querySelector<HTMLInputElement>('.pb-name')?.addEventListener('input', (e) => { name = (e.target as HTMLInputElement).value; });
    host.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((el) => el.addEventListener('click', () => removePlay(el.getAttribute('data-del')!)));
    host.querySelector<HTMLButtonElement>('[data-save]')?.addEventListener('click', save);
    host.querySelector<HTMLButtonElement>('[data-close]')?.addEventListener('click', () => { host.remove(); cb.onClose(); });
  };

  render();
  // Handle so the host can re-render the saved-play coach reads in place when a
  // background review lands (the editor's in-progress state lives in closure vars,
  // so re-rendering preserves it).
  return { refresh: render };
}
