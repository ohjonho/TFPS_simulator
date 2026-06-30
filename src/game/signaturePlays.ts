// Signature plays (Part 5 B2.2) — a small hand-authored library of custom plays
// that AI opponents are "known for". Built the same way the player's Playbook
// builds plays: clone a builtin for the season map and apply a small region
// tweak, so they're guaranteed well-formed + measurable. Assigned to opponents in
// season.ts (OpponentInfo.signatureIds) and registered for the current match in
// buildSeasonMatch, so the AI deploys them and the Scout can read + counter them.
//
// `measured` is a SNAPSHOT from measureMatchups(play, 'Canyon', 24) (the season
// map) — defender-win% per opponent. It feeds the Scout's qualitative counter and
// the B2.1 counter-bias. Re-snapshot if the sim balance changes materially.

import type { MapDefinition, Side } from './types.ts';
import { strategyById, type Strategy, type StrategyVariant } from './strategies.ts';

type SignatureDef = {
  id: string;
  name: string;
  side: Side;
  baseId: string;
  description: string;
  // Transform the cloned base's variants into the signature's.
  tweak: (variants: StrategyVariant[]) => StrategyVariant[];
  measured: { matchups: Record<string, number>; seeds: number };
};

// Retarget the slot with the given id (per variant) to a region; safe no-op if
// the slot is absent.
function retarget(variants: StrategyVariant[], slotId: string, regionFor: (variantIdx: number) => string): StrategyVariant[] {
  return variants.map((v, vi) => v.map((slot) => (slot.id === slotId ? { ...slot, region: regionFor(vi) } : slot)));
}

const SIGNATURES: SignatureDef[] = [
  {
    id: 'sig_off_execute',
    name: 'Off-Angle Execute',
    side: 'attacker',
    baseId: 'Execute',
    description: 'a custom Execute — the lane rifle swings wide to an off-angle for the flank instead of holding the main',
    tweak: (vs) => retarget(vs, 'lane', (vi) => (vi === 0 ? 'a_off' : 'b_off')),
    // SNAPSHOT: measureMatchups(play, 'Canyon', 24) — defender-win% per opponent.
    measured: { matchups: { Hold: 62.5, Stack: 66.7, Pressure: 41.7, Mind_Games: 33.3, Coordinated_Lockdown: 41.7, Rotate_Stack: 66.7 }, seeds: 24 },
  },
  {
    id: 'sig_mid_anchor',
    name: 'Mid Anchor Hold',
    side: 'defender',
    baseId: 'Hold',
    description: 'a custom Hold — one rifle is pulled off-site to wall the mid choke',
    tweak: (vs) => vs.map((v) => v.map((slot, i) => (i === 0 ? { ...slot, region: 'mid_choke' } : slot))),
    // SNAPSHOT: measureMatchups(play, 'Canyon', 24) — defender-win% per opponent.
    measured: { matchups: { Execute: 79.2, Rush: 66.7, Control: 58.3, Mind_Games: 87.5 }, seeds: 24 },
  },
];

// Build the signature plays as resolvable Strategy objects for a given map (clone
// the base + apply the tweak + carry the snapshot matchup). Skips a signature
// whose base isn't on the map.
export function buildSignaturePlays(map: MapDefinition): Strategy[] {
  const out: Strategy[] = [];
  for (const sig of SIGNATURES) {
    const base = strategyById(sig.baseId, sig.side, map);
    if (!base) continue;
    const variants = sig.tweak(structuredClone(base.variants));
    out.push({
      ...base,
      id: sig.id,
      name: sig.name,
      description: sig.description,
      authored: true,
      variants,
      measured: sig.measured.seeds > 0 ? sig.measured : undefined,
    });
  }
  return out;
}

export function signatureIds(): string[] {
  return SIGNATURES.map((s) => s.id);
}

// Lightweight descriptors for season assignment (no map needed). `siteCommitting`
// = the base commits a site, so the opponent's lean should carry an A/B site.
export type SignatureMeta = { id: string; side: Side; siteCommitting: boolean };
const SITE_COMMITTING_BASES = new Set(['Rush', 'Execute', 'Stack', 'Mind_Games', 'Coordinated_Lockdown']);
export function signatureMeta(): SignatureMeta[] {
  return SIGNATURES.map((s) => ({ id: s.id, side: s.side, siteCommitting: SITE_COMMITTING_BASES.has(s.baseId) }));
}
