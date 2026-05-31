// Vite config. Lives at repo root so `vite` picks it up automatically.
//
// `base` is set conditionally:
//   - `vite` (dev) → '/'   so http://localhost:5173/ works locally.
//   - `vite build` → '/TFPS_simulator/'  so the built bundle loads on
//     https://ohjonho.github.io/TFPS_simulator/.
//
// If the repo is ever renamed or moved to a custom domain, only this one
// line needs to change (or set base: '/' for a username.github.io user page).
//
// Two HTML entries: the game (`index.html`) and the dev-only map editor
// (`map-editor.html`, served at /map-editor.html). Listing both under
// rollupOptions.input keeps the editor a separate chunk so it never ships in
// the game bundle. Adding any input means `main` must be listed explicitly —
// Vite no longer auto-discovers index.html once `input` is set.

import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/TFPS_simulator/' : '/',
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        editor: fileURLToPath(new URL('./map-editor.html', import.meta.url)),
      },
    },
  },
}));
