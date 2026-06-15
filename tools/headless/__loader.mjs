// Headless-harness resolver shim. src/maps/*.ts use extensionless relative
// imports (e.g. `from './gridUtils'`) which Vite resolves but Node does not;
// this hook appends `.ts` so the whole graph loads under Node's type-stripping.
import path from 'node:path';
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !path.extname(specifier)) {
    try { return await nextResolve(specifier + '.ts', context); } catch {}
  }
  return nextResolve(specifier, context);
}
