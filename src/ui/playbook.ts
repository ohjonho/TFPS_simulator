// Playbook (Part 5 B1) — the "adapt & save" editor. A between-matches, full-
// screen overlay (reached from Match Prep) where the manager clones a basic
// strategy, retargets its slots' regions, toggles directives on/off, names it,
// and saves it as a player-authored play. Saved plays land on
// SeasonState.customStrategies (B0), become resolvable everywhere via the
// strategy registry, and are pickable in the in-match menu. The measured matchup
// readout (fingerprintStrategy via a worker) is the next slice (B1b); for now a
// saved play is still measurable headlessly. Pure DOM, same pattern as matchPrep.

import type { MapDefinition, Side } from '../game/types.ts';
import {
  strategiesFor,
  type Strategy,
  type StrategyVariant,
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

// Next free authored id of the form `<baseId>_c<N>` (never collides with a
// builtin id, which has no `_c` suffix).
function uniqueAuthoredId(baseId: string, taken: ReadonlySet<string>): string {
  let n = 1;
  while (taken.has(`${baseId}_c${n}`)) n++;
  return `${baseId}_c${n}`;
}

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
  let baseId: string | null = null;
  let sourceVariant = 0;
  let name = '';
  // Working copy of the chosen variant's slots (region edits mutate this).
  let working: StrategyVariant | null = null;
  // Directives toggled OFF, keyed `${slotIdx}:${dirIdx}` against the working set.
  const disabled = new Set<string>();

  const bases = (): Strategy[] => strategiesFor(side, map).filter((s) => !s.authored);
  const base = (): Strategy | null => bases().find((s) => s.id === baseId) ?? null;

  const loadVariant = (): void => {
    const b = base();
    if (!b) { working = null; return; }
    working = structuredClone(b.variants[sourceVariant] ?? b.variants[0] ?? []);
    disabled.clear();
  };

  const selectBase = (id: string): void => {
    baseId = id;
    sourceVariant = 0;
    const b = base();
    name = b ? `${b.name} (custom)` : '';
    loadVariant();
    render();
  };

  const save = (): void => {
    const b = base();
    if (!b || !working) return;
    const taken = new Set<string>([...plays.map((s) => s.id), ...strategiesFor(side, map).map((s) => s.id)]);
    const id = uniqueAuthoredId(b.id, taken);
    const variant: StrategyVariant = working.map((slot, si) => ({
      ...slot,
      directives: slot.directives.filter((_d, di) => !disabled.has(`${si}:${di}`)),
    }));
    const play: Strategy = {
      ...b,
      id,
      name: name.trim() || `${b.name} (custom)`,
      description: `Custom · adapted from ${b.name}`,
      authored: true,
      variants: [variant],
    };
    plays.push(play);
    cb.onSave(play);
    // Reset the editor to a clean slate so the next play starts fresh.
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

    const baseBtns = bases().map((s) =>
      `<button class="mp-opt ${s.id === baseId ? 'sel' : ''}" data-base="${s.id}"><b>${s.name}</b><span>${s.description}</span></button>`).join('');

    const variantPicker = b && b.variants.length > 1
      ? `<div class="pb-row"><span class="pb-label">Start from variant</span>${b.variants.map((_v, i) =>
          `<button class="pb-chip ${i === sourceVariant ? 'sel' : ''}" data-variant="${i}">${String.fromCharCode(65 + i)}</button>`).join('')}</div>`
      : '';

    const slotEditor = working ? working.map((slot, si) => {
      const opts = regionOptions.map((r) =>
        `<option value="${r}" ${r === slot.region ? 'selected' : ''}>${r}</option>`).join('');
      const dirs = slot.directives.map((d, di) => {
        const key = `${si}:${di}`;
        const on = !disabled.has(key);
        return `<label class="pb-dir"><input type="checkbox" data-dir="${key}" ${on ? 'checked' : ''}/> ${directiveLabel(d)}</label>`;
      }).join('') || `<span class="pb-none">no directives</span>`;
      return `<div class="pb-slot">
        <div class="pb-slot-head"><span class="pb-slot-id">${slot.id}</span>
          <select class="pb-region" data-region="${si}">${opts}</select></div>
        <div class="pb-dirs">${dirs}</div>
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
          <div class="mp-kicker">Playbook · adapt &amp; save</div>
          <h1>Author a play</h1>
        </div>
        <div class="pb-grid">
          <div class="pb-col">
            <div class="mp-group-label">Side</div>
            <div class="pb-opts2">${sideBtns}</div>
            <div class="mp-group-label" style="margin-top:14px">Adapt from</div>
            <div class="pb-bases">${baseBtns}</div>
          </div>
          <div class="pb-col">
            ${b ? `
              ${variantPicker}
              <div class="pb-row"><span class="pb-label">Name</span><input class="pb-name" type="text" value="${name.replace(/"/g, '&quot;')}" placeholder="My play"/></div>
              <div class="mp-group-label" style="margin-top:12px">Slots — retarget region &amp; toggle directives</div>
              <div class="pb-slots">${slotEditor}</div>
            ` : `<div class="pb-hint">Pick a side and a base strategy to start adapting.</div>`}
          </div>
        </div>
        <div class="mp-group-label" style="margin-top:20px">Saved plays</div>
        <div class="pb-savedlist">${savedList}</div>
        <div class="mp-actions pb-actions">
          <button class="btn-back" data-close type="button">&larr; Done</button>
          <button class="btn-primary" data-save type="button" ${b ? '' : 'disabled'}>Save play</button>
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
