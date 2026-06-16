/**
 * VRThumbnails — parses a WebVTT thumbnail track (the same `scene.paths.vtt`
 * sprite-sheet format the 2D player's vtt-thumbnails plugin consumes) and
 * resolves a sprite crop for any timestamp, so the immersive player can float a
 * preview above the scrubber while seeking.
 *
 * Reuses the `videojs-vtt.js` parser that already ships with the app — no new
 * dependency. The crop is returned as a `CanvasImageSource` + source rect ready
 * for `ctx.drawImage(...)`.
 */
import { WebVTT } from "videojs-vtt.js";

export interface IThumbnailCrop {
  image: CanvasImageSource;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

interface IThumbCue {
  start: number;
  end: number;
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// `sprite.jpg#xywh=x,y,w,h` — image URL + sprite rectangle (media fragment).
const XYWH = /^([^#]*)#xywh=(\d+),(\d+),(\d+),(\d+)/i;

export class VRThumbnails {
  private cues: IThumbCue[] = [];
  private images = new Map<string, HTMLImageElement>();
  private ready = false;

  async load(vttUrl: string): Promise<void> {
    const res = await fetch(vttUrl);
    if (!res.ok) return;
    const text = await res.text();
    const base = new URL(vttUrl, window.location.href).href;
    const cues = this.parse(text, base);

    for (const c of cues) {
      if (!this.images.has(c.url)) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = c.url;
        this.images.set(c.url, img);
      }
    }
    this.cues = cues.sort((a, b) => a.start - b.start);
    this.ready = true;
  }

  /** Sprite crop for the given time, or null if unavailable / not yet loaded. */
  getAt(time: number): IThumbnailCrop | null {
    if (!this.ready || !this.cues.length) return null;
    const cue = this.find(time);
    if (!cue) return null;
    const img = this.images.get(cue.url);
    if (!img || !img.complete || img.naturalWidth === 0) return null;
    return { image: img, sx: cue.x, sy: cue.y, sw: cue.w, sh: cue.h };
  }

  private find(time: number): IThumbCue | null {
    for (const c of this.cues) {
      if (time >= c.start && time < c.end) return c;
    }
    // Clamp to the last cue past the end, else the first.
    const last = this.cues[this.cues.length - 1];
    return time >= last.end ? last : this.cues[0];
  }

  private parse(text: string, base: string): IThumbCue[] {
    const out: IThumbCue[] = [];
    const parser = new WebVTT.Parser(window, WebVTT.StringDecoder());
    parser.oncue = (cue: VTTCue) => {
      const m = cue.text.trim().match(XYWH);
      if (!m) return;
      let url = m[1].trim();
      try {
        url = new URL(url, base).href;
      } catch {
        // leave as-is if it can't be resolved
      }
      out.push({
        start: cue.startTime,
        end: cue.endTime,
        url,
        x: parseInt(m[2], 10),
        y: parseInt(m[3], 10),
        w: parseInt(m[4], 10),
        h: parseInt(m[5], 10),
      });
    };
    parser.parse(text);
    parser.flush();
    return out;
  }

  dispose() {
    this.images.clear();
    this.cues = [];
    this.ready = false;
  }
}
