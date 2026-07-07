/**
 * vrTheme — shared visual tokens for the immersive player's canvas-drawn UI.
 *
 * One place for the glass/accent language every panel speaks, so the control
 * bar, side panels, tabs and chips read as a single product instead of a
 * collection of hand-mixed rgba() literals. Canvas 2D has no CSS variables;
 * these constants are the equivalent. All values are chosen to stay cheap to
 * rasterize (flat fills, two-stop gradients, hairline strokes — no blurs).
 */
export const VRT = {
  // ── Accent (electric blue, matches the laser + Home wall) ────────────────
  accent: "rgba(96,165,250,0.95)",
  accentSoft: "rgba(96,165,250,0.55)",
  /** Faint accent wash for hovered surfaces. */
  accentWashTop: "rgba(120,180,255,0.26)",
  accentWashBot: "rgba(96,165,250,0.10)",
  /** Active (lit) element gradient. */
  accentGradTop: "rgba(136,196,255,0.95)",
  accentGradBot: "rgba(64,122,226,0.85)",
  /** Border for accent-hovered / active elements. */
  accentBorder: "rgba(168,212,255,0.45)",
  /** Wide, low-alpha halo stroke — the cheap stand-in for an outer glow. */
  accentHalo: "rgba(96,165,250,0.18)",
  /** Text/glyph colour on top of a lit accent fill. */
  onAccent: "#07111f",

  // ── Positive / success (Handy connected, loop armed) ─────────────────────
  greenGradTop: "rgba(110,214,128,0.95)",
  greenGradBot: "rgba(52,150,74,0.85)",
  greenBorder: "rgba(148,226,160,0.42)",

  // ── Now-playing (warm gold — distinguishes "this is currently loaded" from
  // accent-blue hover across the Home wall and the in-player Scenes list) ───
  gold: "rgba(250,200,80,0.95)",
  /** Wide, low-alpha halo stroke — pairs with `gold` for the two-stroke glow. */
  goldHalo: "rgba(250,200,80,0.20)",
  /** Crisp inner stroke for the now-playing glow (paired with `goldHalo`). */
  goldGlow: "rgba(250,200,80,0.85)",

  // ── Raw RGB triplets ──────────────────────────────────────────────────────
  // For call sites that need an alpha this file doesn't offer a fixed token
  // for (e.g. a canvas panel compositing many one-off translucencies from a
  // single hue) — compose via `rgba(${VRT.accentRGB},0.42)` instead of
  // hardcoding the hue a second time. Keeps every panel's accent/gold in sync
  // with this file even where a fixed alpha token doesn't fit.
  accentRGB: "96,165,250",
  goldRGB: "250,200,80",

  // ── Danger (Exit) ─────────────────────────────────────────────────────────
  dangerText: "rgba(252,168,168,0.95)",
  dangerBorder: "rgba(248,113,113,0.50)",

  // ── Glass surfaces ────────────────────────────────────────────────────────
  /** Panel body gradient, top → mid → bottom (cool blue-black glass). */
  panelTop: "rgba(24,28,42,0.96)",
  panelMid: "rgba(13,15,24,0.94)",
  panelBot: "rgba(7,8,14,0.92)",
  /** Faint cool sheen radiating from the panel's top edge. */
  panelSheen: "rgba(164,196,255,0.06)",
  panelBorder: "rgba(255,255,255,0.10)",
  panelRim: "rgba(255,255,255,0.28)",
  /**
   * Idle raised element (button/chip/card) gradient. Deliberately brighter
   * than a subtle glass tint — panelTop/Mid/Bot are ~92-96% opaque near-black,
   * so a too-faint raised fill reads as "invisible", leaving only each
   * element's own rounded-corner cutout visible against the panel behind it
   * (a stark dark square peeking out at the corners instead of a clearly
   * separate raised card).
   */
  raisedTop: "rgba(255,255,255,0.18)",
  raisedBot: "rgba(255,255,255,0.08)",
  raisedBorder: "rgba(255,255,255,0.22)",
  /** Neutral-hover variant (elements that shouldn't tint blue). */
  raisedHoverTop: "rgba(255,255,255,0.32)",
  raisedHoverBot: "rgba(255,255,255,0.16)",

  // ── Text tiers ────────────────────────────────────────────────────────────
  textHi: "rgba(255,255,255,0.95)",
  textMid: "rgba(255,255,255,0.72)",
  textDim: "rgba(255,255,255,0.50)",
  textFaint: "rgba(255,255,255,0.34)",

  // ── Radii (canvas px) ─────────────────────────────────────────────────────
  radiusPanel: 28,
  radiusButton: 18,
  /**
   * How far a button's hover/active fill pulls in from its full tap-target
   * box. Idle buttons draw no fill at all (see [VRControlPanel.drawButton]);
   * insetting the interactive-state pill keeps its rounded corners well clear
   * of the box's true corners, so the panel glass shows through evenly on
   * every side instead of an asymmetric square poking out past one corner.
   */
  buttonInset: 8,
  radiusCard: 14,
} as const;
