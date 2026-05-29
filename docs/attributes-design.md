# Attributes design

This historical design doc is **superseded by `docs/spec.md`** as of the
H1 attribute redesign. The shipped v0 attribute system differs materially
from what this document originally proposed:

- 14 attributes → **5 visible aggregates + 10 hidden sub-attributes**.
- The per-weapon `rifle/shotgun/sniperHandling` triple → a single
  **`weaponAffinity`** sub-rating read against whatever weapon the unit
  holds.
- The `discipline` sub → a visible aggregate, driven by a single
  **`tenacity`** sub which gates the per-tick **directive compliance
  roll**.
- `clutch` + `composure` consolidated into **`composure`** alone.
- `awareness` renamed → **`vision`**; `positioning` folded into
  **`mapIQ`**.
- `sprayControl`, `confidence`, `teamwork`, `communication` cut.

For the current attribute model — including the generation distribution
modes, the visible / hidden mapping, the formulas combat / vision math
reads, and the v1 hooks still inert in v0 — see:

- `docs/spec.md` §4.3 (Attributes)
- `src/game/config.ts ATTRIBUTES` (the canonical numbers)
- `src/game/types.ts Attributes` / `VisibleAttributes`
- `src/game/attributes.ts` (`generateAttributes`, `aggregateVisible`,
  `rollUnitMeta`)
