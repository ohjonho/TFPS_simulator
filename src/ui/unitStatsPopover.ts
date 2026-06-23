// A lightweight hover popover showing a unit's identity + 5 visible aggregates,
// for the management screens (Match Prep leader pick, Playbook roster) where it's
// otherwise hard to recall who's who. Singleton element positioned beside the
// hovered control; reuses the attributes-panel aggregate block.

import type { Unit } from '../game/types.ts';
import { visibleAttributeBlockHtml } from './attributesPanel.ts';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

let pop: HTMLElement | null = null;
function ensure(): HTMLElement {
  if (pop) return pop;
  pop = document.createElement('div');
  pop.id = 'unit-stats-pop';
  pop.style.display = 'none';
  document.body.appendChild(pop);
  return pop;
}

function show(el: HTMLElement, unit: Unit): void {
  const p = ensure();
  p.innerHTML = `<div class="usp-head"><b>${esc(unit.name || unit.id)}</b> <small>${esc(unit.role)} · ${esc(unit.weapon)}</small></div>${visibleAttributeBlockHtml(unit.attributes)}`;
  p.style.display = 'block';
  // Prefer to the right of the control; flip left if it would overflow.
  const r = el.getBoundingClientRect();
  const pw = p.getBoundingClientRect().width || 220;
  let left = r.right + 8;
  if (left + pw > window.innerWidth - 4) left = r.left - pw - 8;
  if (left < 4) left = 4;
  p.style.left = `${left}px`;
  const ph = p.getBoundingClientRect().height;
  p.style.top = `${Math.max(4, Math.min(r.top, window.innerHeight - ph - 4))}px`;
}

function hide(): void { if (pop) pop.style.display = 'none'; }

export function attachUnitStatsPopover(el: HTMLElement, unit: Unit): void {
  el.addEventListener('mouseenter', () => show(el, unit));
  el.addEventListener('mouseleave', hide);
}

export function hideUnitStatsPopover(): void { hide(); }
