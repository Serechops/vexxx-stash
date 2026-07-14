/**
 * VRKeyboardPanel — an in-scene, ray-tapped keyboard drawn on a canvas panel.
 *
 * This replaces the Meta system keyboard (the old VRSystemKeyboard, which
 * summoned it by focusing a DOM <input> during the session). That path hard-
 * crashed the Quest browser the moment the search pill was tapped — before a
 * single character could be typed — on every content tab, and there is no API
 * surface to work around it from script. It was also Quest-only: no other
 * WebXR browser implements `isSystemKeyboardSupported`, so search simply did
 * not exist anywhere else.
 *
 * Drawing our own keys costs us nothing the compositor cares about: it is an
 * ordinary VRCanvasPanel like every other UI surface here, hit-tested through
 * the same controller-ray pipeline, so no DOM focus, no session visibility
 * change, and no system overlay is ever involved.
 *
 * Text is owned by the panel while it is open. Every key edit fires onInput
 * (the session re-queries on a debounce) and the ✓ / ✕ keys fire onCommit with
 * the final text, mirroring the contract the system keyboard had so the call
 * sites did not have to change shape.
 */
import * as THREE from "three";
import { VRCanvasPanel, IPanelRegion } from "./VRInfoPanels";
import { VRControlAction } from "./types";

const CANVAS_W = 1360;
const CANVAS_H = 560;
const PANEL_WIDTH_M = 1.7;

const PAD = 16;
const KEY_W = 124;
const KEY_H = 78;
const GAP = 10;
const FIELD_H = 84;
const ROWS_Y = PAD + FIELD_H + 18;

const ACCENT = "rgba(96,165,250,0.95)";

interface IKeyDef {
  /** Region id suffix — also the character inserted for plain letter keys. */
  id: string;
  label: string;
  /** Width in key units (1 = KEY_W). */
  span?: number;
  /** Non-character keys handled by name. */
  action?: "shift" | "back" | "space" | "layer" | "clear" | "done" | "cancel";
}

function chars(row: string): IKeyDef[] {
  return row.split("").map((c) => ({ id: c, label: c }));
}

const LETTER_ROWS: IKeyDef[][] = [
  chars("1234567890"),
  chars("qwertyuiop"),
  chars("asdfghjkl"),
  [
    { id: "shift", label: "⇧", span: 1.4, action: "shift" },
    ...chars("zxcvbnm"),
    { id: "back", label: "⌫", span: 1.6, action: "back" },
  ],
];

const SYMBOL_ROWS: IKeyDef[][] = [
  chars("1234567890"),
  chars('-/:;()$&@"'),
  chars(".,?!'#%^*+"),
  [
    // Distinct id from the bottom row's layer key — two regions sharing one id
    // would both light up on hover.
    { id: "layerAbc", label: "ABC", span: 1.4, action: "layer" },
    ...chars("=_[]{}<"),
    { id: "back", label: "⌫", span: 1.6, action: "back" },
  ],
];

const BOTTOM_ROW: IKeyDef[] = [
  { id: "layer", label: "?123", span: 1.6, action: "layer" },
  { id: "space", label: "space", span: 4.6, action: "space" },
  { id: "clear", label: "Clear", span: 1.4, action: "clear" },
  { id: "cancel", label: "✕", span: 1, action: "cancel" },
  { id: "done", label: "✓ Search", span: 2, action: "done" },
];

export interface IVRKeyboardOpenOptions {
  /** Text to pre-fill (the field opens with the caret after it). */
  initial: string;
  /** Fires on every edit while the user types. */
  onInput: (text: string) => void;
  /** Fires once when the user closes the keyboard (✓ or ✕). */
  onCommit: (text: string) => void;
}

export class VRKeyboardPanel extends VRCanvasPanel {
  private text = "";
  private active = false;
  private shift = false;
  private symbols = false;
  private onInput: ((text: string) => void) | null = null;
  private onCommit: ((text: string) => void) | null = null;

  /** @param onDismiss lets the session drop the panel from the hittable set. */
  constructor(private onDismiss: () => void) {
    super(PANEL_WIDTH_M, CANVAS_W, CANVAS_H);
    this.mesh.name = "vr-keyboard-panel";
    // Above the Home wall / control bar it floats in front of (all panels draw
    // with depthTest off, so paint order alone decides what wins).
    this.mesh.renderOrder = 20;
  }

  get isOpen(): boolean {
    return this.active;
  }

  open(opts: IVRKeyboardOpenOptions) {
    this.text = opts.initial;
    this.onInput = opts.onInput;
    this.onCommit = opts.onCommit;
    this.active = true;
    this.shift = false;
    this.symbols = false;
    this.hoveredId = null;
    this.markDirty();
  }

  /** Close without committing (session teardown, scene launch, tab switch). */
  close() {
    if (!this.active) return;
    this.active = false;
    this.onInput = null;
    this.onCommit = null;
    this.hoveredId = null;
    this.markDirty();
  }

  protected handleSelect(region: IPanelRegion): VRControlAction | null {
    if (!this.active) return null;
    // No press sound here — the session's routeSelect already ticks one for any
    // panel tap.
    const key = this.keyFor(region.id);
    if (!key) return null;

    switch (key.action) {
      case "shift":
        this.shift = !this.shift;
        this.markDirty();
        return null;
      case "layer":
        this.symbols = !this.symbols;
        this.shift = false;
        this.markDirty();
        return null;
      case "back":
        this.edit(this.text.slice(0, -1));
        return null;
      case "space":
        this.edit(`${this.text} `);
        return null;
      case "clear":
        this.edit("");
        return null;
      case "done":
      case "cancel": {
        const { text } = this;
        const commit = this.onCommit;
        this.active = false;
        this.onInput = null;
        this.onCommit = null;
        this.markDirty();
        commit?.(text);
        this.onDismiss();
        return null;
      }
      default: {
        // A character key. Shift is one-shot, like a phone keyboard.
        const ch = this.shift ? key.id.toUpperCase() : key.id;
        if (this.shift) this.shift = false;
        this.edit(this.text + ch);
        return null;
      }
    }
  }

  /** Apply an edit and push it to the session (which re-queries, debounced). */
  private edit(next: string) {
    if (next === this.text) return;
    this.text = next;
    this.markDirty();
    this.onInput?.(next);
  }

  private get rows(): IKeyDef[][] {
    return [...(this.symbols ? SYMBOL_ROWS : LETTER_ROWS), BOTTOM_ROW];
  }

  private keyFor(regionId: string): IKeyDef | null {
    if (!regionId.startsWith("k:")) return null;
    const id = regionId.slice(2);
    for (const row of this.rows) {
      const key = row.find((k) => k.id === id);
      if (key) return key;
    }
    return null;
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  protected draw() {
    const { ctx } = this;
    this.panelBackground();
    this.drawField();

    const { rows } = this;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const units = row.reduce((sum, k) => sum + (k.span ?? 1), 0);
      const width = units * KEY_W + (row.length - 1) * GAP;
      let x = (this.cw - width) / 2;
      const y = ROWS_Y + r * (KEY_H + GAP);
      for (const key of row) {
        const w = (key.span ?? 1) * KEY_W;
        this.drawKey(key, x, y, w);
        x += w + GAP;
      }
    }
    ctx.textAlign = "left";
  }

  /** The text field: what has been typed, with a blinking-free caret bar. */
  private drawField() {
    const { ctx } = this;
    const w = this.cw - PAD * 2;
    this.roundRect(PAD, PAD, w, FIELD_H, 12);
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ACCENT;
    ctx.stroke();

    const cy = PAD + FIELD_H / 2 + 1;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    if (this.text) {
      ctx.font = "600 34px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      const shown = this.fitText(this.text, w - 60);
      ctx.fillText(shown, PAD + 20, cy);
      const caretX = PAD + 20 + ctx.measureText(shown).width + 6;
      ctx.fillStyle = ACCENT;
      ctx.fillRect(caretX, cy - 20, 3, 40);
    } else {
      ctx.font = "400 32px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillText("Search…", PAD + 20, cy);
    }
  }

  private drawKey(key: IKeyDef, x: number, y: number, w: number) {
    const { ctx } = this;
    const id = `k:${key.id}`;
    const hovered = this.hoveredId === id;
    const held =
      (key.action === "shift" && this.shift) ||
      (key.action === "layer" && this.symbols);
    const accented = key.action === "done";

    this.roundRect(x, y, w, KEY_H, 12);
    if (accented) {
      ctx.fillStyle = hovered ? "rgba(96,165,250,1)" : ACCENT;
    } else if (held) {
      ctx.fillStyle = "rgba(255,255,255,0.30)";
    } else {
      ctx.fillStyle = hovered
        ? "rgba(255,255,255,0.22)"
        : "rgba(255,255,255,0.10)";
    }
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.stroke();

    const label =
      key.action || key.id.length > 1
        ? key.label
        : this.shift
        ? key.label.toUpperCase()
        : key.label;
    ctx.font = key.action ? "600 24px sans-serif" : "600 32px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = accented ? "#06121f" : "rgba(255,255,255,0.92)";
    ctx.fillText(label, x + w / 2, y + KEY_H / 2 + 1);

    this.regions.push({ id, x, y, w, h: KEY_H });
  }

  /** Ignore hover/rays entirely while closed (the mesh is hidden anyway). */
  setHovered(uv: THREE.Vector2 | null) {
    super.setHovered(this.active ? uv : null);
  }
}

export default VRKeyboardPanel;
