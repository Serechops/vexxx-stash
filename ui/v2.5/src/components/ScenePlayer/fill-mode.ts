/* eslint-disable @typescript-eslint/naming-convention */
import videojs, { VideoJsPlayer } from "video.js";

const COLOR_DEFAULT = "white";
const COLOR_ACTIVE = "%2300adef"; // #00adef, URL-encoded for SVG data URI

function makeSvgUrl(fill: string) {
  return (
    `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' fill='${fill}'%3E` +
    `%3Cpolygon points='22 16 24 16 24 8 16 8 16 10 22 10 22 16'/%3E` +
    `%3Cpolygon points='8 24 16 24 16 22 10 22 10 16 8 16 8 24'/%3E` +
    `%3Cpath d='M26,28H6a2,2,0,0,1-2-2V6A2,2,0,0,1,6,4H26a2,2,0,0,1,2,2V26A2,2,0,0,1,26,28ZM6,6V26H26V6Z'/%3E` +
    `%3C/svg%3E`
  );
}

class FillModeButton extends videojs.getComponent("Button") {
  private active: boolean;
  private imgEl: HTMLImageElement;

  constructor(player: VideoJsPlayer, options: videojs.ComponentOptions & { active?: boolean }) {
    super(player, options);
    this.active = options.active ?? false;

    // Inject an <img> directly into the button — bypasses vjs icon-placeholder CSS conflicts
    this.imgEl = document.createElement("img");
    this.imgEl.style.cssText =
      "width:1.4em;height:1.4em;display:block;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;";
    (this.el() as HTMLElement).style.position = "relative";
    this.el().appendChild(this.imgEl);

    this.updateIcon();
  }

  buildCSSClass() {
    return `vjs-fill-mode-button ${super.buildCSSClass()}`;
  }

  private updateIcon() {
    if (this.active) {
      this.imgEl.src = makeSvgUrl(COLOR_ACTIVE);
      this.controlText(this.localize("Fill mode on (click to letterbox)"));
    } else {
      this.imgEl.src = makeSvgUrl(COLOR_DEFAULT);
      this.controlText(this.localize("Fill mode off (click to fill)"));
    }
  }

  handleClick(event: Event) {
    event.stopPropagation();
    this.active = !this.active;
    this.updateIcon();
    this.trigger("fillmodechanged", { active: this.active });
  }

  public setActive(active: boolean) {
    this.active = active;
    this.updateIcon();
  }
}

class FillModePlugin extends videojs.getPlugin("plugin") {
  private button: FillModeButton;
  private active: boolean;

  constructor(player: VideoJsPlayer) {
    super(player);
    this.active = false;

    this.button = new FillModeButton(player, { active: false });

    player.ready(() => {
      this.ready();
    });
  }

  private ready() {
    const { controlBar } = this.player;
    const fullscreenToggle = controlBar.getChild("fullscreenToggle");
    if (fullscreenToggle) {
      controlBar.addChild(this.button);
      controlBar.el().insertBefore(this.button.el(), fullscreenToggle.el());
    } else {
      controlBar.addChild(this.button);
    }

    this.button.on("fillmodechanged", (_, data: { active: boolean }) => {
      this.setActive(data.active);
    });
  }

  public toggle() {
    this.setActive(!this.active);
  }

  public setActive(active: boolean) {
    this.active = active;
    this.button.setActive(active);
    if (active) {
      this.player.el().classList.add("vjs-fill-mode");
    } else {
      this.player.el().classList.remove("vjs-fill-mode");
    }
  }

  public isActive(): boolean {
    return this.active;
  }
}

videojs.registerComponent("FillModeButton", FillModeButton);
videojs.registerPlugin("fillMode", FillModePlugin);

declare module "video.js" {
  interface VideoJsPlayer {
    fillMode: () => FillModePlugin;
  }
  interface VideoJsPlayerPluginOptions {
    fillMode?: Record<string, never>;
  }
}

export default FillModePlugin;
