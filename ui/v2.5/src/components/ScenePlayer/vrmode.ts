/* eslint-disable @typescript-eslint/naming-convention */
import videojs, { VideoJsPlayer } from "video.js";
import "videojs-vr";
// separate type import, otherwise typescript elides the above import
// and the plugin does not get initialized
import type { ProjectionType, Plugin as VideoJsVRPlugin } from "videojs-vr";

export interface VRMenuOptions {
  /**
   * Whether to show the vr button.
   * @default false
   */
  showButton?: boolean;
}

export enum VRType {
  LR180 = "180 LR",
  TB360 = "360 TB",
  Mono360 = "360 Mono",
  Off = "Off",
}

const vrTypeProjection: Record<VRType, ProjectionType> = {
  [VRType.LR180]: "180_LR",
  [VRType.TB360]: "360_TB",
  [VRType.Mono360]: "360",
  [VRType.Off]: "NONE",
};

function isVrDevice() {
  return navigator.userAgent.match(/oculusbrowser|\svr\s/i);
}

class VRMenuItem extends videojs.getComponent("MenuItem") {
  public type: VRType;
  public isSelected = false;

  constructor(parent: VRMenuButton, type: VRType) {
    const options: videojs.MenuItemOptions = {};
    options.selectable = true;
    options.multiSelectable = false;
    options.label = type;

    super(parent.player(), options);

    this.type = type;

    this.addClass("vjs-source-menu-item");
  }

  selected(selected: boolean): void {
    super.selected(selected);
    this.isSelected = selected;
  }

  handleClick() {
    if (this.isSelected) return;

    this.trigger("selected");
  }
}

class VRMenuButton extends videojs.getComponent("MenuButton") {
  private items: VRMenuItem[] = [];
  private selectedType: VRType = VRType.Off;

  constructor(player: VideoJsPlayer) {
    super(player);
    this.setTypes();
  }

  private onSelected(item: VRMenuItem) {
    this.selectedType = item.type;

    this.items.forEach((i) => {
      i.selected(i.type === this.selectedType);
    });

    this.trigger("typeselected", item.type);
  }

  public setTypes() {
    this.items = Object.values(VRType).map((type) => {
      const item = new VRMenuItem(this, type);

      item.on("selected", () => {
        this.onSelected(item);
      });

      return item;
    });
    this.update();
  }

  /** Update the highlighted menu item without triggering a selection event. */
  public selectType(type: VRType) {
    this.selectedType = type;
    this.items.forEach((i) => {
      i.selected(i.type === this.selectedType);
    });
  }

  createEl() {
    return videojs.dom.createEl("div", {
      className:
        "vjs-vr-selector vjs-menu-button vjs-menu-button-popup vjs-control vjs-button",
    });
  }

  createItems() {
    if (this.items === undefined) return [];

    for (const item of this.items) {
      item.selected(item.type === this.selectedType);
    }

    return this.items;
  }
}

class VRMenuPlugin extends videojs.getPlugin("plugin") {
  private menu: VRMenuButton;
  private showButton: boolean;
  private vr?: VideoJsVRPlugin;
  /**
   * Called when the user selects a VR type from the menu.
   * Receives null when the user selects "Off" (no VR).
   */
  onTypeSelected: ((type: VRType | null) => void) | undefined = undefined;

  // Track the last-applied projection so we can skip redundant init() calls.
  // vr.init() resets the Three.js OrbitControls camera to its default heading,
  // causing the "snap to center" glitch when the effect re-runs for the same scene.
  private _currentProjection: ProjectionType | null = null;

  // Drag-suppression state: while the user is dragging the 360/180 view,
  // mousemove events on the Three.js canvas bubble up to VideoJS and reset
  // its 700 ms inactivity timer, preventing the controls from ever auto-hiding.
  // We intercept those events in the capture phase during a drag and stop propagation.
  private _vrDragCanvas: HTMLCanvasElement | null = null;
  private _vrDragging = false;
  private _onVrMouseDown: (() => void) | null = null;
  private _onDocMouseUp: (() => void) | null = null;
  private _onVrMouseMove: ((e: Event) => void) | null = null;

  constructor(player: VideoJsPlayer, options: VRMenuOptions) {
    super(player);

    this.menu = new VRMenuButton(player);
    this.showButton = options.showButton ?? false;

    if (isVrDevice()) return;

    if (this.player.vr) {
      this.vr = this.player.vr();
      this.vr.on("initialized", () => {
        if (this._currentProjection && this._currentProjection !== "NONE") {
          this._enableVRDragSuppression();
        }
      });
    } else {
      console.warn("videojs-vr plugin not found");
    }

    this.menu.on("typeselected", (_, type: VRType) => {
      this.loadVR(type);
      if (this.onTypeSelected) {
        this.onTypeSelected(type === VRType.Off ? null : type);
      }
    });

    player.on("ready", () => {
      if (this.showButton && this.vr) {
        this.addButton();
      }
    });

    // Clean up document-level listener on player disposal.
    player.on("dispose", () => {
      this._disableVRDragSuppression();
    });
  }

  private loadVR(type: VRType) {
    const projection = vrTypeProjection[type];
    // Skip reinit if the projection hasn't changed. Calling vr.init() resets
    // the Three.js camera to its default orientation (snap to center), so we
    // only call it when the projection actually changes.
    if (projection === this._currentProjection) return;
    this._currentProjection = projection;
    this.vr?.setProjection(projection);
    this.vr?.init();
    if (projection === "NONE") {
      this._disableVRDragSuppression();
    }
  }

  /** Attach capture-phase mousemove suppression to the Three.js VR canvas. */
  private _enableVRDragSuppression() {
    const canvas = this.player.el().querySelector<HTMLCanvasElement>("canvas");
    if (!canvas || canvas === this._vrDragCanvas) return;
    // Clean up any stale listeners from a previous canvas before re-attaching.
    this._disableVRDragSuppression();
    this._vrDragging = false;
    this._onVrMouseDown = () => {
      this._vrDragging = true;
    };
    this._onDocMouseUp = () => {
      this._vrDragging = false;
    };
    this._onVrMouseMove = (e: Event) => {
      // Only suppress during an active drag so normal hover still works.
      if (this._vrDragging) {
        e.stopPropagation();

        // Disable play/pause toggle in videojs-vr CanvasPlayerControls
        const controls = (this.vr as any)?.canvasPlayerControls;
        if (controls) {
          controls.shouldTogglePlay = false;
        }

        if (e instanceof MouseEvent) {
          const clonedEvent = new MouseEvent("mousemove", {
            bubbles: true,
            cancelable: true,
            clientX: e.clientX,
            clientY: e.clientY,
            screenX: e.screenX,
            screenY: e.screenY,
            ctrlKey: e.ctrlKey,
            altKey: e.altKey,
            shiftKey: e.shiftKey,
            metaKey: e.metaKey,
            buttons: e.buttons,
            button: e.button,
          });
          document.dispatchEvent(clonedEvent);
        }
      }
    };
    canvas.addEventListener("mousedown", this._onVrMouseDown);
    document.addEventListener("mouseup", this._onDocMouseUp);
    // Capture phase runs before VideoJS's bubble-phase activity listeners.
    canvas.addEventListener("mousemove", this._onVrMouseMove, true);
    this._vrDragCanvas = canvas;
  }

  /** Remove all drag-suppression listeners. */
  private _disableVRDragSuppression() {
    if (!this._vrDragCanvas) return;
    if (this._onVrMouseDown)
      this._vrDragCanvas.removeEventListener("mousedown", this._onVrMouseDown);
    if (this._onVrMouseMove)
      this._vrDragCanvas.removeEventListener(
        "mousemove",
        this._onVrMouseMove,
        true
      );
    if (this._onDocMouseUp)
      document.removeEventListener("mouseup", this._onDocMouseUp);
    this._vrDragCanvas = null;
    this._onVrMouseDown = null;
    this._onDocMouseUp = null;
    this._onVrMouseMove = null;
    this._vrDragging = false;
  }

  private addButton() {
    const { controlBar } = this.player;
    const fullscreenToggle = controlBar.getChild("fullscreenToggle")!.el();
    controlBar.addChild(this.menu);
    controlBar.el().insertBefore(this.menu.el(), fullscreenToggle);
  }

  private removeButton() {
    const { controlBar } = this.player;
    controlBar.removeChild(this.menu);
  }

  public setShowButton(showButton: boolean) {
    if (isVrDevice()) return;

    if (showButton === this.showButton) return;

    this.showButton = showButton;
    if (showButton) {
      this.addButton();
    } else {
      this.removeButton();
      this.loadVR(VRType.Off);
    }
  }

  /**
   * Set the initial VR mode when a scene loads.
   * Selects the corresponding menu item and applies the VR projection.
   * Pass null to reset to "Off" (no VR projection active).
   */
  public setInitialMode(type: VRType | null) {
    if (isVrDevice()) return;
    const effectiveType = type ?? VRType.Off;
    this.menu.selectType(effectiveType);
    this.loadVR(effectiveType);
  }
}

// Register the plugin with video.js.
videojs.registerComponent("VRMenuButton", VRMenuButton);
videojs.registerPlugin("vrMenu", VRMenuPlugin);

/* eslint-disable @typescript-eslint/naming-convention */
declare module "video.js" {
  interface VideoJsPlayer {
    vrMenu: () => VRMenuPlugin;
  }
  interface VideoJsPlayerPluginOptions {
    vrMenu?: VRMenuOptions;
  }
}

export default VRMenuPlugin;
