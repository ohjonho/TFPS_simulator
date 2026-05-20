// Placeholder playback controls for Pass 1. All buttons disabled; wiring
// arrives in Pass 2.

const BUTTONS: Array<{ id: string; label: string }> = [
  { id: 'btn-play', label: 'Play' },
  { id: 'btn-pause', label: 'Pause' },
  { id: 'btn-1x', label: '1×' },
  { id: 'btn-2x', label: '2×' },
  { id: 'btn-4x', label: '4×' },
  { id: 'btn-replay', label: 'Replay' },
];

export function renderBottomControls(host: HTMLElement): void {
  host.innerHTML = '';
  for (const def of BUTTONS) {
    const btn = document.createElement('button');
    btn.id = def.id;
    btn.textContent = def.label;
    btn.disabled = true;
    host.appendChild(btn);
  }
}
