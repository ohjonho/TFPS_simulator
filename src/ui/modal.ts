// Minimal centered overlay used for round-result, halftime, and match-end
// screens. Caller provides title, body, and action buttons.

export type ModalAction = { label: string; onClick: () => void; primary?: boolean };

let activeRoot: HTMLDivElement | null = null;
let escListener: ((ev: KeyboardEvent) => void) | null = null;

export function showModal(title: string, body: string, actions: ModalAction[]): void {
  dismissModal();
  // F1 — Esc closes the modal. Skip when Esc is consumed elsewhere (e.g.
  // active card-target session). The listener is removed on dismiss.
  escListener = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && activeRoot) dismissModal();
  };
  window.addEventListener('keydown', escListener);
  const root = document.createElement('div');
  root.id = 'modal-root';
  root.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;' +
    'align-items:center;justify-content:center;z-index:1000;font-family:inherit;';

  const panel = document.createElement('div');
  panel.style.cssText =
    'background:#1c2230;color:#eee;padding:20px 24px;border-radius:8px;' +
    'min-width:320px;max-width:820px;max-height:90vh;overflow-y:auto;' +
    'border:1px solid #2a2f3a;';
  const h = document.createElement('h2');
  h.textContent = title;
  h.style.cssText = 'margin:0 0 8px;font-size:18px;color:#facc15;';
  // Pass A5 — round-end + match-end bodies are rich HTML (stat tables,
  // SVG sparklines). Use innerHTML; callers are internal so no XSS risk.
  const p = document.createElement('div');
  p.innerHTML = body;
  p.style.cssText = 'margin:0 0 18px;font-size:13px;line-height:1.5;';
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.textContent = a.label;
    btn.style.cssText = a.primary
      ? 'padding:6px 14px;background:#facc15;color:#0e1116;border:none;border-radius:4px;cursor:pointer;font-weight:600;'
      : 'padding:6px 14px;background:#2a2f3a;color:#eee;border:1px solid #3a3f4a;border-radius:4px;cursor:pointer;';
    btn.addEventListener('click', () => { dismissModal(); a.onClick(); });
    row.appendChild(btn);
  }
  panel.append(h, p, row);
  root.appendChild(panel);
  document.body.appendChild(root);
  activeRoot = root;
}

export function dismissModal(): void {
  if (activeRoot) {
    activeRoot.remove();
    activeRoot = null;
  }
  if (escListener) {
    window.removeEventListener('keydown', escListener);
    escListener = null;
  }
}
