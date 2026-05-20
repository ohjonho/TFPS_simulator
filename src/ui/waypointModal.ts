// Floating popover for editing a waypoint at a specific path hex.
// Controls: hold-ticks stepper (0–10) and 6 directional buttons for facing.

import type { Facing, Waypoint } from '../game/types.ts';

export type WaypointModalCallbacks = {
  onSave: (waypoint: Waypoint) => void;
  onRemove: () => void;
  onCancel: () => void;
};

const FACING_LABELS: Record<Facing, string> = {
  0: 'N',
  1: 'NE',
  2: 'SE',
  3: 'S',
  4: 'SW',
  5: 'NW',
};

const MIN_HOLD = 0;
const MAX_HOLD = 10;

export function openWaypointModal(
  host: HTMLElement,
  anchor: { x: number; y: number },
  existing: Waypoint | null,
  cb: WaypointModalCallbacks,
): void {
  // Close any previously open modal first.
  closeWaypointModal(host);

  const modal = document.createElement('div');
  modal.className = 'waypoint-modal';
  modal.dataset.role = 'waypoint-modal';

  let hold = existing?.holdTicks ?? 2;
  let facing: Facing = existing?.facing ?? 0;

  modal.innerHTML = `
    <div class="wp-row">
      <label>Hold ticks</label>
      <div class="wp-stepper">
        <button type="button" data-act="dec">−</button>
        <span class="wp-hold-value">${hold}</span>
        <button type="button" data-act="inc">+</button>
      </div>
    </div>
    <div class="wp-row">
      <label>Facing</label>
      <div class="wp-facing-grid">
        ${(Object.keys(FACING_LABELS) as unknown as string[])
          .map((k) => {
            const f = Number(k) as Facing;
            const selected = f === facing ? ' selected' : '';
            return `<button type="button" data-facing="${f}" class="wp-facing-btn${selected}">${FACING_LABELS[f]}</button>`;
          })
          .join('')}
      </div>
    </div>
    <div class="wp-actions">
      <button type="button" class="wp-cancel" data-act="cancel">Cancel</button>
      <button type="button" class="wp-remove" data-act="remove">Remove</button>
      <button type="button" class="wp-save" data-act="save">Save</button>
    </div>
  `;

  host.appendChild(modal);
  positionModal(modal, anchor);

  const holdValueEl = modal.querySelector<HTMLSpanElement>('.wp-hold-value')!;

  modal.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    const act = target.dataset.act;
    const facingAttr = target.dataset.facing;

    if (facingAttr !== undefined) {
      facing = Number(facingAttr) as Facing;
      modal.querySelectorAll('.wp-facing-btn').forEach((btn) => {
        btn.classList.toggle('selected', (btn as HTMLElement).dataset.facing === facingAttr);
      });
      return;
    }

    if (act === 'inc') {
      hold = Math.min(MAX_HOLD, hold + 1);
      holdValueEl.textContent = String(hold);
      return;
    }
    if (act === 'dec') {
      hold = Math.max(MIN_HOLD, hold - 1);
      holdValueEl.textContent = String(hold);
      return;
    }
    if (act === 'save') {
      closeWaypointModal(host);
      cb.onSave({ holdTicks: hold, facing });
      return;
    }
    if (act === 'remove') {
      closeWaypointModal(host);
      cb.onRemove();
      return;
    }
    if (act === 'cancel') {
      closeWaypointModal(host);
      cb.onCancel();
      return;
    }
  });

  // Dismiss on outside click (next animation frame so the opening click doesn't
  // immediately close it).
  requestAnimationFrame(() => {
    const onDocClick = (ev: MouseEvent) => {
      if (!modal.contains(ev.target as Node)) {
        document.removeEventListener('mousedown', onDocClick);
        closeWaypointModal(host);
        cb.onCancel();
      }
    };
    document.addEventListener('mousedown', onDocClick);
  });
}

export function closeWaypointModal(host: HTMLElement): void {
  const existing = host.querySelector<HTMLElement>('[data-role="waypoint-modal"]');
  if (existing) existing.remove();
}

function positionModal(modal: HTMLElement, anchor: { x: number; y: number }): void {
  // Place near the cursor but clamp within the viewport.
  modal.style.position = 'fixed';
  modal.style.left = `${anchor.x + 12}px`;
  modal.style.top = `${anchor.y + 12}px`;
  // After layout, nudge back if it would overflow.
  requestAnimationFrame(() => {
    const rect = modal.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) {
      modal.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight - 8) {
      modal.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  });
}
