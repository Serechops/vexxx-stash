/**
 * VRPassthroughPanel — DeoVR-style passthrough adjustment panel.
 *
 * Opened from the control bar's "PT" button into the right-hand side slot
 * (mirroring DeoVR's passthrough controls). Holds the on/off toggle plus the
 * full chroma-key tuning surface — the same five sliders DeoVR exposes:
 * Hue / Saturation / Brightness are per-channel WEIGHTS of the HSV distance
 * metric (not the key colour!), Color range is the keying tolerance and
 * Falloff the edge feather. The key colour itself comes from "Sample from
 * video" (DeoVR's "(A)" button) and shows on the swatch beside the title.
 * A sixth slider, Edge softness, is this fork's addition — it tunes the
 * embedded alpha-mask ("(A)" mode) boundary blur/threshold instead, so the
 * two alpha sources each get a dedicated edge control. Sliders for the
 * INACTIVE alpha source dim (but stay adjustable) rather than disappear.
 *
 * Slider drags apply LIVE through the onLive callback (shader-uniform updates
 * only — cheap at drag frequency); release emits setPassthroughSettings once
 * per gesture so React persists it. Mirrors VRHandyPanel's stroke-slider
 * press/drag/release mechanics.
 */
import * as THREE from "three";
import { VRCanvasPanel, IPanelRegion } from "./VRInfoPanels";
import {
  IVRPassthroughSettings,
  DEFAULT_VR_PASSTHROUGH_SETTINGS,
  VRControlAction,
} from "./types";

const CANVAS_W = 640;
const CANVAS_H = 720;
const PAD = 32;
const TRACK_X = PAD;
const TRACK_W = CANVAS_W - PAD * 2;
const SLIDERS_Y = 214;
// 80 * 6 sliders == the original 96 * 5, so adding the mask-edge-softness
// slider doesn't change the panel's physical size.
const SLIDER_H = 80;
const TRACK_H = 10;
const HANDLE_R = 16;

const ACCENT = "rgba(96,165,250,0.95)";

function pct(v: number): string {
  return `${Math.round(v * 100)}`;
}

interface ISliderDef {
  key: keyof IVRPassthroughSettings;
  label: string;
  /** Stored-value maximum (slider fraction × max = stored value). */
  max: number;
  format: (v: number) => string;
  /** Which alpha source this control affects — dims when the other is active. */
  mode: "chroma" | "mask";
}

/**
 * DeoVR's slider order: H/S/B channel weights, then tolerance, then feather —
 * all chroma-key only. "Edge softness" is this fork's addition, tuning the
 * embedded alpha-mask ("(A)" mode) boundary instead (see maskBlurRadius /
 * maskEdgeBand in passthrough.ts).
 */
const SLIDERS: ISliderDef[] = [
  { key: "hueWeight", label: "Hue", max: 1, format: pct, mode: "chroma" },
  { key: "satWeight", label: "Saturation", max: 1, format: pct, mode: "chroma" },
  { key: "briWeight", label: "Brightness", max: 1, format: pct, mode: "chroma" },
  { key: "range", label: "Color range", max: 1, format: pct, mode: "chroma" },
  { key: "falloff", label: "Falloff", max: 1, format: pct, mode: "chroma" },
  {
    key: "maskEdgeSoftness",
    label: "Edge softness",
    max: 1,
    format: pct,
    mode: "mask",
  },
];

export class VRPassthroughPanel extends VRCanvasPanel {
  private settings: IVRPassthroughSettings = {
    ...DEFAULT_VR_PASSTHROUGH_SETTINGS,
  };
  private ptOn = false;
  /**
   * "(A)" mode: alpha comes from the video's embedded corner-packed mask
   * (SLR alpha encodes) instead of the chroma key — DeoVR's (A) button.
   * Auto-set from the filename, user-togglable.
   */
  private alphaMaskOn = false;
  /** Slider the trigger is currently dragging (null = not dragging). */
  private dragging: ISliderDef | null = null;

  constructor(private onLive: (s: IVRPassthroughSettings) => void) {
    super(0.95, CANVAS_W, CANVAS_H);
    this.mesh.name = "vr-passthrough-panel";
  }

  get hasContent(): boolean {
    return true;
  }

  /** Replace the displayed settings (persisted load / a frame sample). */
  setSettings(s: IVRPassthroughSettings) {
    this.settings = { ...s };
    this.markDirty();
  }

  /** Reflect the live passthrough on/off state on the toggle pill. */
  setPassthroughState(on: boolean) {
    if (on !== this.ptOn) {
      this.ptOn = on;
      this.markDirty();
    }
  }

  /** Reflect the embedded-alpha-mask mode on the (A) pill. */
  setAlphaMaskState(on: boolean) {
    if (on !== this.alphaMaskOn) {
      this.alphaMaskOn = on;
      this.markDirty();
    }
  }

  protected handleSelect(region: IPanelRegion): VRControlAction | null {
    switch (region.id) {
      case "ptToggle":
        return { type: "togglePassthrough" };
      case "ptAlphaMask":
        return { type: "toggleAlphaMask" };
      case "ptSample":
        return { type: "chromaSample" };
      case "ptReset": {
        this.settings = { ...DEFAULT_VR_PASSTHROUGH_SETTINGS };
        this.onLive({ ...this.settings });
        this.markDirty();
        return {
          type: "setPassthroughSettings",
          settings: { ...this.settings },
        };
      }
      default:
        return null;
    }
  }

  // ── Slider drag (mirrors VRHandyPanel's stroke slider) ─────────────────────
  // Press grabs a slider and jumps it to the press point; drag streams live
  // uniform updates; release emits one setPassthroughSettings for persistence.

  activate(uv: THREE.Vector2): VRControlAction | null {
    const region = this.regionAt(uv);
    const def = region
      ? SLIDERS.find((s) => `pt:${s.key}` === region.id) ?? null
      : null;
    if (def) {
      this.dragging = def;
      this.applyDrag(uv);
      return null;
    }
    this.dragging = null;
    return region ? this.handleSelect(region) : null;
  }

  pointerMove(uv: THREE.Vector2): void {
    if (this.dragging) this.applyDrag(uv);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  pointerUp(_uv: THREE.Vector2): VRControlAction | null {
    if (!this.dragging) return null;
    this.dragging = null;
    return { type: "setPassthroughSettings", settings: { ...this.settings } };
  }

  private applyDrag(uv: THREE.Vector2) {
    const def = this.dragging;
    if (!def) return;
    const x = uv.x * this.cw;
    const frac = Math.min(1, Math.max(0, (x - TRACK_X) / TRACK_W));
    this.settings[def.key] = frac * def.max;
    this.onLive({ ...this.settings });
    this.markDirty();
  }

  // ── Drawing ─────────────────────────────────────────────────────────────────

  protected draw() {
    const { ctx } = this;
    this.panelBackground();
    const s = this.settings;
    const keyCss = `rgb(${Math.round(s.keyR * 255)},${Math.round(
      s.keyG * 255
    )},${Math.round(s.keyB * 255)})`;

    // Title + live key-colour swatch.
    ctx.font = "700 30px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.fillText("Passthrough", PAD, 52);
    this.roundRect(232, 34, 46, 36, 8);
    ctx.fillStyle = keyCss;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.stroke();

    // ON/OFF pill — top right.
    const pillW = 130;
    const pillH = 52;
    const pillX = this.cw - PAD - pillW;
    const pillY = 26;
    const pillHover = this.hoveredId === "ptToggle";
    this.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fillStyle = this.ptOn
      ? "rgba(76,175,80,0.9)"
      : pillHover
      ? "rgba(255,255,255,0.18)"
      : "rgba(255,255,255,0.10)";
    ctx.fill();
    ctx.font = "700 24px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = this.ptOn ? "#06210d" : "rgba(255,255,255,0.85)";
    ctx.fillText(
      this.ptOn ? "ON" : "OFF",
      pillX + pillW / 2,
      pillY + pillH / 2 + 1
    );
    this.regions.push({
      id: "ptToggle",
      x: pillX,
      y: pillY,
      w: pillW,
      h: pillH,
    });

    // "(A)" pill — embedded alpha-mask mode (DeoVR parity), left of ON/OFF.
    const aW = 60;
    const aX = pillX - 14 - aW;
    const aHover = this.hoveredId === "ptAlphaMask";
    this.roundRect(aX, pillY, aW, pillH, pillH / 2);
    ctx.fillStyle = this.alphaMaskOn
      ? ACCENT
      : aHover
      ? "rgba(255,255,255,0.18)"
      : "rgba(255,255,255,0.10)";
    ctx.fill();
    ctx.font = "700 26px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = this.alphaMaskOn ? "#06121f" : "rgba(255,255,255,0.85)";
    ctx.fillText("A", aX + aW / 2, pillY + pillH / 2 + 1);
    this.regions.push({ id: "ptAlphaMask", x: aX, y: pillY, w: aW, h: pillH });

    // Sample / Reset buttons.
    const btnY = 112;
    const btnH = 56;
    const gap = 16;
    const half = (this.cw - PAD * 2 - gap) / 2;
    this.drawButton("ptSample", "Sample from video", PAD, btnY, half, btnH);
    this.drawButton("ptReset", "Reset", PAD + half + gap, btnY, half, btnH);

    // Mode hint under the buttons.
    ctx.font = "400 18px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText(
      this.alphaMaskOn
        ? "Using the video's embedded alpha mask — Edge softness tunes its boundary"
        : "Chroma key mode — sliders tune what gets keyed out",
      PAD,
      btnY + btnH + 26
    );

    // Sliders — each dims when the OTHER alpha source is active (chroma
    // sliders dim under the embedded mask and vice versa for Edge softness).
    for (let i = 0; i < SLIDERS.length; i++) {
      const def = SLIDERS[i];
      const dimmed = this.alphaMaskOn
        ? def.mode === "chroma"
        : def.mode === "mask";
      ctx.globalAlpha = dimmed ? 0.35 : 1;
      this.drawSlider(def, SLIDERS_Y + i * SLIDER_H);
    }
    ctx.globalAlpha = 1;
  }

  private drawButton(
    id: string,
    label: string,
    x: number,
    y: number,
    w: number,
    h: number
  ) {
    const { ctx } = this;
    const hovered = this.hoveredId === id;
    this.roundRect(x, y, w, h, 12);
    ctx.fillStyle = hovered
      ? "rgba(255,255,255,0.18)"
      : "rgba(255,255,255,0.08)";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.stroke();
    ctx.font = "600 22px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText(this.fitText(label, w - 24), x + w / 2, y + h / 2 + 1);
    this.regions.push({ id, x, y, w, h });
  }

  private drawSlider(def: ISliderDef, y: number) {
    const { ctx } = this;
    const s = this.settings;
    const value = s[def.key];
    const frac = value / def.max;

    // Label (left) + value read-out (right).
    ctx.font = "600 22px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(def.label, PAD, y + 14);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText(def.format(value), this.cw - PAD, y + 14);

    // Track with an accent fill up to the handle.
    const ty = y + 52;
    this.roundRect(TRACK_X, ty - TRACK_H / 2, TRACK_W, TRACK_H, TRACK_H / 2);
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fill();
    if (frac > 0.01) {
      this.roundRect(
        TRACK_X,
        ty - TRACK_H / 2,
        TRACK_W * frac,
        TRACK_H,
        TRACK_H / 2
      );
      ctx.fillStyle = ACCENT;
      ctx.fill();
    }

    // Handle.
    const hx = TRACK_X + frac * TRACK_W;
    const active = this.dragging === def || this.hoveredId === `pt:${def.key}`;
    ctx.beginPath();
    ctx.arc(hx, ty, HANDLE_R, 0, Math.PI * 2);
    ctx.fillStyle = active ? "#ffffff" : "rgba(235,235,235,0.92)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = active ? ACCENT : "rgba(0,0,0,0.35)";
    ctx.stroke();

    // Generous grab band around the track.
    this.regions.push({
      id: `pt:${def.key}`,
      x: TRACK_X - 8,
      y: ty - 30,
      w: TRACK_W + 16,
      h: 60,
    });
  }
}

export default VRPassthroughPanel;
