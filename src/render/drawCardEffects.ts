// Pass D — visible feedback for active card effects during resolution. Pure
// read over state.cardEffects (ActiveCardEffect[]) + per-unit cardFlags.
// Renders after units so visuals layer over the squares. Animation uses
// state.tick so the rendered frame is deterministic vs the sim.
//
// Pass E m3 — enemy-team effects are gated on player visibility: the player
// only sees an enemy aura / anchor / mark / Lurker outline once the relevant
// source/target/anchor is in their visibility set. Own-team effects always
// render. Closes a fog-of-war leak (pre-m3 you could see the enemy's
// Guardian Aura ring even behind a wall).

import type { ActiveCardEffect, GameState, HexCoord, Team, Unit } from '../game/types.ts';
import { hexDistance, hexToPixel, offsetToPixel } from '../game/hex.ts';
import { hexKey } from '../game/vision.ts';
import { CARD_VISUAL, COLORS, HEX } from '../game/config.ts';

export function drawCardEffects(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (state.phase !== 'resolution') return;
  const unitsById = new Map(state.units.map((u) => [u.id, u]));
  const playerTeam = state.playerTeam;
  const playerVisible = state.visibility[playerTeam];

  // Helpers (Pass E m3): is the player allowed to see this enemy effect now?
  // Own-team effects always render; enemy-team gated on whether the relevant
  // unit / hex is in the player team's visibility set.
  const isOwn = (e: { team: Team }): boolean => e.team === playerTeam;
  const unitVisible = (id: string): boolean => {
    const u = unitsById.get(id);
    if (!u || u.state !== 'alive') return false;
    return playerVisible.has(hexKey(u.pos));
  };
  const hexVisible = (h: HexCoord): boolean => playerVisible.has(hexKey(h));

  // Order: large background effects first (auras, scan tints, anchors), then
  // glyphs / outlines, then high-priority overlays (marks). Layering keeps
  // marks readable on top of other effects.
  for (const e of state.cardEffects) {
    if (e.kind === 'tactical_scan') {
      // Tactical Scan is the casting team's UI; the opposing team has no
      // "you got scanned" cue. Player-side only.
      if (!isOwn(e)) continue;
      drawTacticalScan(ctx, state, e);
    } else if (e.kind === 'guardian_aura') {
      if (!isOwn(e) && !unitVisible(e.sourceId)) continue;
      drawGuardianAura(ctx, state, e, unitsById);
    } else if (e.kind === 'hold_the_line') {
      if (!isOwn(e) && !hexVisible(e.anchorHex)) continue;
      drawHoldTheLine(ctx, state, e, unitsById);
    } else if (e.kind === 'setup_play') {
      // Anchor pivot is read off the bonus-ally's cardFlags; gate on the
      // ally being visible.
      if (!isOwn(e) && !unitVisible(e.allyId)) continue;
      drawSetupPlay(ctx, e, unitsById);
    } else if (e.kind === 'spearhead') {
      if (!isOwn(e) && !unitVisible(e.vanguardId)) continue;
      drawSpearheadArrow(ctx, state, e, unitsById);
    }
  }

  // Per-unit cardFlag visuals (Anchor / Reckless / Slow Flank). Enemy-team
  // overlays gated on whether the unit itself is visible to the player.
  for (const u of state.units) {
    if (u.state !== 'alive') continue;
    if (u.team !== playerTeam && !playerVisible.has(hexKey(u.pos))) continue;
    if (u.cardFlags.anchorPosition) drawAnchorPositionGlyph(ctx, u);
    if (u.cardFlags.recklessPush) drawRecklessOutline(ctx, u);
    if (u.cardFlags.slowFlank || u.cardFlags.invisibleUntilFire) drawSlowFlankOutline(ctx, u);
  }

  // Mark Target / Trade Window crosshair last — high visibility over the unit.
  for (const e of state.cardEffects) {
    if (e.kind !== 'mark_target') continue;
    // Trade Window's mark expires; expired effects shouldn't render.
    if (e.expiresAtTick !== undefined && e.expiresAtTick <= state.tick) continue;
    // Marks on an unseen enemy stay hidden until the target hex is visible.
    // Own-team marks always render (the player knows what they picked).
    if (!isOwn(e) && !unitVisible(e.targetId)) continue;
    drawMarkCrosshair(ctx, state, e, unitsById);
  }
}

// --- Guardian Aura: dashed ring around source + "+1 HP" badge on allies -----

function drawGuardianAura(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  e: Extract<ActiveCardEffect, { kind: 'guardian_aura' }>,
  unitsById: Map<string, Unit>,
): void {
  const src = unitsById.get(e.sourceId);
  if (!src || src.state !== 'alive') return;
  const { x, y } = hexToPixel(src.pos);
  const cfg = CARD_VISUAL.guardianAura;
  const teamColor = e.team === 'defenders' ? COLORS.defenderUnit : COLORS.attackerUnit;
  // Radius in pixels — approximate hex-distance R as R * (HEX.size * sqrt(3))
  // (the row-spacing distance between centers). Close enough for an overlay.
  const pxRadius = e.radius * HEX.w;

  ctx.save();
  ctx.globalAlpha = cfg.alpha;
  ctx.strokeStyle = teamColor;
  ctx.lineWidth = cfg.lineWidth;
  ctx.setLineDash([...cfg.dash]);
  ctx.beginPath();
  ctx.arc(x, y, pxRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Per-ally "+1 HP" badge (small filled chip top-right of square).
  ctx.save();
  ctx.globalAlpha = cfg.badgeAlpha;
  ctx.fillStyle = teamColor;
  ctx.font = `bold 9px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const u of state.units) {
    if (u.team !== e.team || u.state !== 'alive') continue;
    if (hexDistance(u.pos, src.pos) > e.radius) continue;
    const p = hexToPixel(u.pos);
    // Badge in the top-right corner of the unit square.
    const bx = p.x + HEX.size * 0.5;
    const by = p.y - HEX.size * 0.55;
    ctx.beginPath();
    ctx.arc(bx, by, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0e1116';
    ctx.fillText('+', bx, by + 0.5);
    ctx.fillStyle = teamColor;
  }
  ctx.restore();
}

// --- Tactical Scan: faint tint on every enemy hex (live during scan window) -

function drawTacticalScan(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  e: Extract<ActiveCardEffect, { kind: 'tactical_scan' }>,
): void {
  if (e.expiresAtTick <= state.tick) return;
  const enemyTeam = e.team === 'defenders' ? 'attackers' : 'defenders';
  ctx.save();
  ctx.fillStyle = CARD_VISUAL.tacticalScan.color;
  for (const u of state.units) {
    if (u.team !== enemyTeam || u.state !== 'alive') continue;
    fillHex(ctx, u.pos);
  }
  ctx.restore();
}

// --- Hold the Line: anchor flag + pulse when safe-window is active ---------

function drawHoldTheLine(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  e: Extract<ActiveCardEffect, { kind: 'hold_the_line' }>,
  unitsById: Map<string, Unit>,
): void {
  const cfg = CARD_VISUAL.holdTheLine;
  const { x, y } = hexToPixel(e.anchorHex);

  // Anchor flag: small inverted triangle on the hex.
  ctx.save();
  ctx.strokeStyle = cfg.color;
  ctx.fillStyle = cfg.color.replace('0.85', '0.25');
  ctx.lineWidth = cfg.lineWidth;
  ctx.beginPath();
  const s = HEX.size * 0.55;
  ctx.moveTo(x - s, y - s * 0.4);
  ctx.lineTo(x + s, y - s * 0.4);
  ctx.lineTo(x, y + s * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Safe-window pulse: if ANY ally is on the anchor with safeWindowUntilTick
  // > tick, ring the anchor with a green pulse.
  let safeActive = false;
  for (const u of state.units) {
    if (u.team !== e.team || u.state !== 'alive') continue;
    if (u.pos.col !== e.anchorHex.col || u.pos.row !== e.anchorHex.row) continue;
    const until = u.cardFlags.safeWindowUntilTick;
    if (until !== undefined && until > state.tick) { safeActive = true; break; }
  }
  if (safeActive) {
    ctx.save();
    ctx.strokeStyle = cfg.safeWindowPulseColor;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.arc(x, y, HEX.size * 0.85, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Suppress unused-warning by reading unitsById (kept for parallel signature).
  void unitsById;
}

// --- Setup Play: pivot triangle + faint 5-hex range ring around anchor -----

function drawSetupPlay(
  ctx: CanvasRenderingContext2D,
  e: Extract<ActiveCardEffect, { kind: 'setup_play' }>,
  unitsById: Map<string, Unit>,
): void {
  const ally = unitsById.get(e.allyId);
  // The anchor lives on the ally's cardFlags.setupPlayAnchor; fall back to
  // ally's current pos if unset (very rare).
  const anchor: HexCoord | null = ally?.cardFlags.setupPlayAnchor ?? null;
  if (!anchor) return;
  const cfg = CARD_VISUAL.setupPlay;
  const { x, y } = hexToPixel(anchor);

  // Pivot: small filled triangle pointing up at the anchor.
  ctx.save();
  ctx.fillStyle = cfg.pivotColor;
  ctx.beginPath();
  const s = HEX.size * 0.4;
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s * 0.9, y + s * 0.6);
  ctx.lineTo(x - s * 0.9, y + s * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Range ring (5 hexes — uses HEX.w as one-hex pixel distance approximation).
  ctx.save();
  ctx.strokeStyle = cfg.ringColor;
  ctx.lineWidth = cfg.ringLineWidth;
  ctx.setLineDash([...cfg.ringDash]);
  ctx.beginPath();
  ctx.arc(x, y, 5 * HEX.w, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// --- Spearhead: arrow above the Vanguard square (fades after 3 engaged) ----

function drawSpearheadArrow(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  e: Extract<ActiveCardEffect, { kind: 'spearhead' }>,
  unitsById: Map<string, Unit>,
): void {
  const van = unitsById.get(e.vanguardId);
  if (!van || van.state !== 'alive') return;
  const cfg = CARD_VISUAL.spearhead;
  const ai = state.ai[van.id];
  if (ai && ai.engagementTicks > cfg.fadeAfterEngagementTicks) return;

  const { x, y } = hexToPixel(van.pos);
  ctx.save();
  ctx.fillStyle = cfg.color;
  ctx.beginPath();
  const s = HEX.size * 0.45;
  const top = y - HEX.size * 0.95;
  ctx.moveTo(x, top);
  ctx.lineTo(x + s * 0.7, top + s * 0.9);
  ctx.lineTo(x - s * 0.7, top + s * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// --- Mark Target / Trade Window: pulsing crosshair on the marked enemy ----

function drawMarkCrosshair(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  e: Extract<ActiveCardEffect, { kind: 'mark_target' }>,
  unitsById: Map<string, Unit>,
): void {
  const tgt = unitsById.get(e.targetId);
  if (!tgt || tgt.state !== 'alive') return;
  const cfg = CARD_VISUAL.markTarget;
  const { x, y } = hexToPixel(tgt.pos);

  // Pulse: oscillate radius between 0.55 and 0.95 × HEX.size over pulseTicks.
  const phase = (state.tick % cfg.pulseTicks) / cfg.pulseTicks;
  const wave = 0.5 * (1 + Math.cos(phase * Math.PI * 2)); // 0..1..0
  const r = HEX.size * (0.55 + (cfg.radiusFactor - 0.55) * wave);

  ctx.save();
  ctx.strokeStyle = cfg.color;
  ctx.lineWidth = cfg.lineWidth;
  // Crosshair rings + cross lines.
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - r * 1.15, y);
  ctx.lineTo(x - r * 0.45, y);
  ctx.moveTo(x + r * 0.45, y);
  ctx.lineTo(x + r * 1.15, y);
  ctx.moveTo(x, y - r * 1.15);
  ctx.lineTo(x, y - r * 0.45);
  ctx.moveTo(x, y + r * 0.45);
  ctx.lineTo(x, y + r * 1.15);
  ctx.stroke();
  ctx.restore();
}

// --- Anchor Position: small anchor glyph below the Sentinel ----------------

function drawAnchorPositionGlyph(ctx: CanvasRenderingContext2D, u: Unit): void {
  const cfg = CARD_VISUAL.anchorPosition;
  const { x, y } = hexToPixel(u.pos);
  const bottomY = y + HEX.size * 0.78;
  ctx.save();
  ctx.strokeStyle = cfg.color;
  ctx.fillStyle = cfg.color;
  ctx.lineWidth = cfg.lineWidth;
  // Stylized anchor: small circle (ring), vertical bar, two curls.
  ctx.beginPath();
  ctx.arc(x, bottomY - 4, 2.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, bottomY - 2);
  ctx.lineTo(x, bottomY + 5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, bottomY + 4, 4, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  ctx.restore();
}

// --- Reckless Push: faint red speed-trail behind unit (back of facing) -----

function drawRecklessOutline(ctx: CanvasRenderingContext2D, u: Unit): void {
  const cfg = CARD_VISUAL.recklessPush;
  const { x, y } = hexToPixel(u.pos);
  // Facing 0=N, 1=NE, 2=SE, 3=S, 4=SW, 5=NW. The TRAIL goes opposite the
  // facing direction. Use the same offset table tick.ts derives facing from.
  const facingBearings: ReadonlyArray<[number, number]> = [
    [0, -1],            // 0 = N
    [Math.sin(Math.PI / 3),  -Math.cos(Math.PI / 3)],   // 1 = NE
    [Math.sin(Math.PI / 3),   Math.cos(Math.PI / 3)],   // 2 = SE
    [0, 1],             // 3 = S
    [-Math.sin(Math.PI / 3),  Math.cos(Math.PI / 3)],   // 4 = SW
    [-Math.sin(Math.PI / 3), -Math.cos(Math.PI / 3)],   // 5 = NW
  ];
  const [dx, dy] = facingBearings[u.facing];
  ctx.save();
  ctx.strokeStyle = cfg.color;
  ctx.lineWidth = cfg.lineWidth;
  for (let i = 1; i <= 3; i++) {
    const r = HEX.size * (0.65 + i * 0.15);
    const tx = x - dx * (i * HEX.size * 0.35);
    const ty = y - dy * (i * HEX.size * 0.35);
    ctx.globalAlpha = (4 - i) / 5;
    ctx.beginPath();
    ctx.arc(tx, ty, r * 0.35, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// --- Slow Flank: dotted outline around the Lurker (player-team only) ------

function drawSlowFlankOutline(ctx: CanvasRenderingContext2D, u: Unit): void {
  const cfg = CARD_VISUAL.slowFlank;
  const { x, y } = hexToPixel(u.pos);
  ctx.save();
  ctx.strokeStyle = cfg.color;
  ctx.lineWidth = cfg.lineWidth;
  ctx.setLineDash([...cfg.dash]);
  ctx.beginPath();
  ctx.arc(x, y, HEX.size * 0.95, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// --- helpers ---------------------------------------------------------------

function fillHex(ctx: CanvasRenderingContext2D, hex: HexCoord): void {
  const { x, y } = offsetToPixel(hex.col, hex.row);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const px = x + HEX.size * Math.cos(a);
    const py = y + HEX.size * Math.sin(a);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}
