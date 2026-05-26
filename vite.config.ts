// Vite config. Lives at repo root so `vite` picks it up automatically.
//
// `base` is set conditionally:
//   - `vite` (dev) → '/'   so http://localhost:5173/ works locally.
//   - `vite build` → '/TFPS_simulator/'  so the built bundle loads on
//     https://ohjonho.github.io/TFPS_simulator/.
//
// If the repo is ever renamed or moved to a custom domain, only this one
// line needs to change (or set base: '/' for a username.github.io user page).

import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/TFPS_simulator/' : '/',
}));
