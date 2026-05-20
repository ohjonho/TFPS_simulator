// Playback controls. Active only in the resolution phase.
//
// Play / Pause toggle, three speed buttons (1× / 2× / 4×) that act as a radio
// group, and Replay (resets cursors to tick 0 and starts again).

import type { GameState, PlaybackSpeed } from '../game/types.ts';
import { PLAYBACK_SPEEDS } from '../game/config.ts';

export type BottomControlsCallbacks = {
  onPlayToggle: () => void;
  onSpeedChange: (speed: PlaybackSpeed) => void;
  onReplay: () => void;
};

export function renderBottomControls(
  host: HTMLElement,
  state: GameState,
  cb: BottomControlsCallbacks,
): void {
  host.innerHTML = '';
  const disabled = state.phase !== 'resolution';

  const playBtn = document.createElement('button');
  playBtn.textContent = state.playback.playing ? 'Pause' : 'Play';
  playBtn.disabled = disabled;
  playBtn.addEventListener('click', cb.onPlayToggle);

  host.appendChild(playBtn);

  const speedGroup = document.createElement('div');
  speedGroup.className = 'speed-group';
  for (const sp of PLAYBACK_SPEEDS) {
    const btn = document.createElement('button');
    btn.textContent = `${sp}×`;
    btn.disabled = disabled;
    if (sp === state.playback.speed) btn.classList.add('selected');
    btn.addEventListener('click', () => cb.onSpeedChange(sp));
    speedGroup.appendChild(btn);
  }
  host.appendChild(speedGroup);

  const replay = document.createElement('button');
  replay.textContent = 'Replay';
  replay.disabled = disabled;
  replay.addEventListener('click', cb.onReplay);
  host.appendChild(replay);
}
