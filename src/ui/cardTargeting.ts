// Pass D — click-to-target UI for hex-targeted cards (Setup Play, Hold the
// Line) and a role-pick modal for Adapt. The legacy auto-default for these
// cards stays in place as a fallback — this module only fires when the player
// explicitly enters targeting mode by picking a hex-targeted card.
//
// Flow per Setup Play / Hold the Line:
//   1. Player picks the card in the side-panel hand.
//   2. main.ts sets `mode.kind = 'hex'` + shows the instruction banner.
//   3. Canvas click → pixelToOffset → passable hex → commit; clear mode.
//   4. Esc cancels (returns to hand selection, card stays picked but
//      untargeted; Begin Round stays disabled until a target is committed).
//
// Flow per Adapt: a modal pops with three role buttons; one click commits.

import type { HexCoord, MapDefinition, Role } from '../game/types.ts';
import { pixelToOffset } from '../game/hex.ts';
import { passableAt } from '../game/pathfind.ts';
import { showModal, dismissModal } from './modal.ts';

// What kind of pick the player is making in the current targeting session.
// `null` = not in targeting mode.
export type TargetingMode =
  | { kind: 'hex'; cardDefId: string; label: string }
  | null;

export type CardTargetingCallbacks = {
  // The active targeting mode (read each click to know what to commit). UI
  // state lives in main.ts; this module just reads/writes via the callbacks.
  getMode: () => TargetingMode;
  // Commit a hex target. Caller updates main's `cardTarget` UI state +
  // re-renders preview routes.
  onCommitHex: (cardDefId: string, hex: HexCoord) => void;
  // Cancel the active targeting session (Esc or click outside).
  onCancel: () => void;
  // Map needed for hex passability test (target must be a movable hex).
  getMap: () => MapDefinition;
};

export function attachCardTargeting(
  canvas: HTMLCanvasElement,
  cb: CardTargetingCallbacks,
): void {
  canvas.addEventListener('click', (ev) => {
    const mode = cb.getMode();
    if (!mode) return; // Not in targeting mode — let other click handlers run.
    const rect = canvas.getBoundingClientRect();
    const hex = pixelToOffset(ev.clientX - rect.left, ev.clientY - rect.top);
    const map = cb.getMap();
    if (!passableAt(map, hex)) return; // Ignore clicks on walls / out of bounds.
    cb.onCommitHex(mode.cardDefId, hex);
    ev.stopPropagation();
  }, true); // Capture phase — runs before click-to-select.

  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (cb.getMode()) cb.onCancel();
  });
}

// --- Adapt role modal ----------------------------------------------------

export function showAdaptRoleModal(onPick: (role: Role) => void): void {
  // Body lists the 3 selectable roles (Vanguard / Tactician / Warden); each
  // commits via the modal's action buttons. Specialist isn't an option (Adapt
  // is a Specialist's card — copying their own role would be a no-op).
  const body = `
    <p>Choose a role card for the Specialist to mimic this round.</p>
    <p class="hint">The Specialist also gets a flat +10 HR for the round on top.</p>
  `;
  const roles: ReadonlyArray<{ role: Role; label: string; blurb: string }> = [
    { role: 'Vanguard', label: 'Spearhead (Vanguard)', blurb: '+15 HR first engagement; allies pause 2 ticks.' },
    { role: 'Tactician', label: 'Setup Play (Tactician)', blurb: 'Specialist moves to a hex; ally near it gets +20 HR.' },
    { role: 'Warden', label: 'Hold the Line (Warden)', blurb: 'Anchor a hex; allies there get a safe window.' },
  ];
  showModal('Adapt — pick a role', body, roles.map(({ role, label, blurb }, idx) => ({
    label: `${label} — ${blurb}`,
    primary: idx === 0,
    onClick: () => { dismissModal(); onPick(role); },
  })));
}
