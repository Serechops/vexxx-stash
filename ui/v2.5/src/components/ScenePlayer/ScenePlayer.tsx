import React, {
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import videojs, { VideoJsPlayer, VideoJsPlayerOptions } from "video.js";
import useScript from "src/hooks/useScript";
import "videojs-contrib-dash";
import "videojs-mobile-ui";
import "videojs-seek-buttons";
import { UAParser } from "ua-parser-js";
import "./live";
import "./PlaylistButtons";
import "./source-selector";
import "./persist-volume";
import "./autostart-button";
import "./rating-button";
import MarkersPlugin, { type IMarker } from "./markers";
void MarkersPlugin;
import "./vtt-thumbnails";
import "./big-buttons";
import "./track-activity";
import "./vrmode";
import { VRType } from "./vrmode";
import "./media-session";
import "./wake-sentinel";
import cx from "classnames";
import { useIntl } from "react-intl";
import {
  useSceneSaveActivity,
  useSceneIncrementPlayCount,
  useConfigureInterface,
  useSceneUpdate,
} from "src/core/StashService";

import * as GQL from "src/core/generated-graphql";
import { ScenePlayerScrubber } from "./ScenePlayerScrubber";
import { useConfigurationContext } from "src/hooks/Config";
import {
  ConnectionState,
  InteractiveContext,
} from "src/hooks/Interactive/context";
import { SceneInteractiveStatus } from "src/hooks/Interactive/status";
import { InteractiveControls } from "./InteractiveControls";
import { languageMap } from "src/utils/caption";
import { VIDEO_PLAYER_ID } from "./util";
import TextUtils from "src/utils/text";
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  Table,
  TableBody,
  TableRow,
  TableCell,
  IconButton,
} from "@mui/material";
import { Close as CloseIcon } from "@mui/icons-material";

// @ts-ignore
import airplay from "@silvermine/videojs-airplay";
// @ts-ignore
import chromecast from "@silvermine/videojs-chromecast";
import abLoopPlugin from "videojs-abloop";
import ScreenUtils from "src/utils/screen";
import { PatchComponent } from "src/patch";

// register videojs plugins
airplay(videojs);
chromecast(videojs);
abLoopPlugin(window, videojs);

// Extend VideoJsPlayer to support virtual timeline properties
declare module "video.js" {
  interface VideoJsPlayer {
    virtualStart?: number;
    virtualEnd?: number;
  }
}

function handleHotkeys(player: VideoJsPlayer, event: videojs.KeyboardEvent) {
  function seekStep(step: number) {
    const time = player.currentTime() + step;

    // Virtual duration/bounds handling
    const start = player.virtualStart ?? 0;
    const end = player.virtualEnd ?? player.duration();

    if (time < start) {
      player.currentTime(start);
    } else if (time < end) {
      player.currentTime(time);
    } else {
      player.currentTime(end);
    }
  }

  function seekPercent(percent: number) {
    const start = player.virtualStart ?? 0;
    const end = player.virtualEnd ?? player.duration();
    const duration = end - start;

    const time = start + duration * percent;
    player.currentTime(time);
  }

  function seekPercentRelative(percent: number) {
    const start = player.virtualStart ?? 0;
    const end = player.virtualEnd ?? player.duration();
    const duration = end - start;

    const currentTime = player.currentTime();
    const time = currentTime + duration * percent;

    if (time > end) {
      player.currentTime(end);
      return;
    }
    if (time < start) {
      player.currentTime(start);
      return;
    }

    player.currentTime(time);
  }

  function toggleABLooping() {
    const opts = player.abLoopPlugin.getOptions();
    if (!opts.start) {
      opts.start = player.currentTime();
    } else if (!opts.end) {
      opts.end = player.currentTime();
      opts.enabled = true;
    } else {
      opts.start = 0;
      opts.end = 0;
      opts.enabled = false;
    }
    player.abLoopPlugin.setOptions(opts);
  }

  let seekFactor = 10;
  if (event.shiftKey) {
    seekFactor = 5;
  } else if (event.ctrlKey || event.altKey) {
    seekFactor = 60;
  }
  switch (event.which) {
    case 39: // right arrow
      seekStep(seekFactor);
      break;
    case 37: // left arrow
      seekStep(-seekFactor);
      break;
  }

  // toggle player looping with shift+l
  if (event.shiftKey && event.which === 76) {
    player.loop(!player.loop());
    return;
  }

  // speed up/down with > (Shift+.) and < (Shift+,)
  if (event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
    if (event.which === 190 || event.which === 188) {
      const rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
      const current = player.playbackRate();
      const currentIdx = rates.reduce(
        (best, rate, i) =>
          Math.abs(rate - current) < Math.abs(rates[best] - current) ? i : best,
        0
      );
      if (event.which === 190) {
        player.playbackRate(rates[Math.min(currentIdx + 1, rates.length - 1)]);
      } else {
        player.playbackRate(rates[Math.max(currentIdx - 1, 0)]);
      }
      return;
    }
  }

  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return;
  }

  const skipButtons = player.skipButtons();
  if (skipButtons) {
    // handle multimedia keys
    switch (event.key) {
      case "MediaTrackNext":
        if (!skipButtons.onNext) return;
        skipButtons.onNext();
        break;
      case "MediaTrackPrevious":
        if (!skipButtons.onPrevious) return;
        skipButtons.onPrevious();
        break;
      // MediaPlayPause handled by videojs
    }
  }

  switch (event.which) {
    case 32: // space
    case 13: // enter
      if (player.paused()) player.play();
      else player.pause();
      break;
    case 77: // m
      player.muted(!player.muted());
      break;
    case 70: // f
      if (player.isFullscreen()) player.exitFullscreen();
      else player.requestFullscreen();
      break;
    case 76: // l
      toggleABLooping();
      break;
    case 38: // up arrow
      player.volume(player.volume() + 0.1);
      break;
    case 40: // down arrow
      player.volume(player.volume() - 0.1);
      break;
    case 48: // 0
      player.currentTime(0);
      break;
    case 49: // 1
      seekPercent(0.1);
      break;
    case 50: // 2
      seekPercent(0.2);
      break;
    case 51: // 3
      seekPercent(0.3);
      break;
    case 52: // 4
      seekPercent(0.4);
      break;
    case 53: // 5
      seekPercent(0.5);
      break;
    case 54: // 6
      seekPercent(0.6);
      break;
    case 55: // 7
      seekPercent(0.7);
      break;
    case 56: // 8
      seekPercent(0.8);
      break;
    case 57: // 9
      seekPercent(0.9);
      break;
    case 221: // ]
      seekPercentRelative(0.1);
      break;
    case 219: // [
      seekPercentRelative(-0.1);
      break;
  }
}

/** Convert a stored GQL VrMode enum value to the vrmode.ts VRType. */
function vrModeToVRType(mode: GQL.VrMode | null | undefined): VRType | null {
  switch (mode) {
    case GQL.VrMode.Lr180:
      return VRType.LR180;
    case GQL.VrMode.Tb360:
      return VRType.TB360;
    case GQL.VrMode.Mono360:
      return VRType.Mono360;
    default:
      return null;
  }
}

/** Convert a vrmode.ts VRType back to the GQL VrMode enum value (null for Off). */
function vrTypeToGqlMode(type: VRType): GQL.VrMode | null {
  switch (type) {
    case VRType.LR180:
      return GQL.VrMode.Lr180;
    case VRType.TB360:
      return GQL.VrMode.Tb360;
    case VRType.Mono360:
      return GQL.VrMode.Mono360;
    default:
      return null;
  }
}

type MarkerFragment = Pick<GQL.SceneMarker, "title" | "seconds"> & {
  primary_tag: Pick<GQL.Tag, "name"> | null;
  tags: Array<Pick<GQL.Tag, "name">>;
};

function getMarkerTitle(marker: MarkerFragment) {
  if (marker.title) {
    return marker.title;
  }

  let ret = marker.primary_tag?.name ?? "";
  if (marker.tags.length) {
    ret += `, ${marker.tags.map((t) => t.name).join(", ")}`;
  }

  return ret;
}

interface IScenePlayerProps {
  scene: GQL.SceneDataFragment;
  hideScrubberOverride: boolean;
  autoplay?: boolean;
  permitLoop?: boolean;
  initialTimestamp: number;
  sendSetTimestamp: (setTimestamp: (value: number) => void) => void;
  sendGetTimestamp?: (getTimestamp: () => number) => void;
  onComplete: () => void;
  onNext: () => void;
  onPrevious: () => void;
}

export const ScenePlayer: React.FC<IScenePlayerProps> = PatchComponent(
  "ScenePlayer",
  ({
    scene,
    hideScrubberOverride,
    autoplay,
    permitLoop = true,
    initialTimestamp: _initialTimestamp,
    sendSetTimestamp,
    sendGetTimestamp,
    onComplete,
    onNext,
    onPrevious,
  }) => {
    const { configuration } = useConfigurationContext();
    const interfaceConfig = configuration?.interface;
    const uiConfig = configuration?.ui;
    const intl = useIntl();
    const videoRef = useRef<HTMLDivElement>(null);
    const [_player, setPlayer] = useState<VideoJsPlayer>();
    const sceneId = useRef<string>();
    const [sceneSaveActivity] = useSceneSaveActivity();
    const [sceneIncrementPlayCount] = useSceneIncrementPlayCount();
    const [updateInterfaceConfig] = useConfigureInterface();
    const [updateScene] = useSceneUpdate();

    const [time, setTime] = useState(0);
    const [ready, setReady] = useState(false);
    const [userActive, setUserActive] = useState(true);
    const [playerEl, setPlayerEl] = useState<Element | null>(null);

    const {
      interactive: interactiveClient,
      uploadScript,
      currentScript,
      initialised: interactiveInitialised,
      state: interactiveState,
    } = React.useContext(InteractiveContext);

    const [fullscreen, setFullscreen] = useState(false);
    const [showScrubber, setShowScrubber] = useState(false);

    const started = useRef(false);
    const auto = useRef(false);
    const interactiveReady = useRef(false);
    const minimumPlayPercent = uiConfig?.minimumPlayPercent ?? 0;
    const trackActivity = uiConfig?.trackActivity ?? true;
    const countOnStart = uiConfig?.countOnStart ?? false;
    const vrTag = uiConfig?.vrTag ?? undefined;

    useScript(
      "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1",
      uiConfig?.enableChromecast
    );

    const file = useMemo(
      () => (scene.files.length > 0 ? scene.files[0] : undefined),
      [scene]
    );

    const maxLoopDuration = interfaceConfig?.maximumLoopDuration ?? 0;
    const looping = useMemo(
      () =>
        !!file?.duration &&
        permitLoop &&
        maxLoopDuration !== 0 &&
        file.duration < maxLoopDuration,

      [file, permitLoop, maxLoopDuration]
    );

    const isVirtual = (scene.start_point ?? 0) > 0 || !!scene.end_point;
    const virtualSegmentStart = scene.start_point ?? 0;
    const virtualSegmentEnd = isVirtual
      ? (scene.end_point ?? file?.duration ?? 0)
      : 0;
    const virtualDuration = isVirtual ? virtualSegmentEnd - virtualSegmentStart : 0;

    // Derive the currently-playing chapter from sorted marker list
    const activeMarker = useMemo(() => {
      if (!scene.scene_markers.length) return null;
      return (
        [...scene.scene_markers]
          .sort((a, b) => b.seconds - a.seconds)
          .find((m) => time >= m.seconds) ?? null
      );
    }, [time, scene.scene_markers]);

    const getPlayer = useCallback(() => {
      if (!_player) return null;
      if (_player.isDisposed()) return null;
      return _player;
    }, [_player]);

    useEffect(() => {
      if (hideScrubberOverride || fullscreen) {
        setShowScrubber(false);
        return;
      }

      const onResize = () => {
        const show = window.innerHeight >= 450 && !ScreenUtils.isMobile();
        setShowScrubber(show);
      };
      onResize();

      window.addEventListener("resize", onResize);

      return () => window.removeEventListener("resize", onResize);
    }, [hideScrubberOverride, fullscreen]);

    useEffect(() => {
      sendSetTimestamp((value: number) => {
        const player = getPlayer();
        if (player && value >= 0) {
          if (player.hasStarted() && player.paused()) {
            player.currentTime(value);
          } else {
            player.play()?.then(() => {
              player.currentTime(value);
            });
          }
        }
      });
    }, [sendSetTimestamp, getPlayer]);

    useEffect(() => {
      if (!sendGetTimestamp) return;
      sendGetTimestamp(() => getPlayer()?.currentTime() ?? 0);
    }, [sendGetTimestamp, getPlayer]);

    // Initialize VideoJS player
    useEffect(() => {
      const options: VideoJsPlayerOptions = {
        id: VIDEO_PLAYER_ID,
        controls: true,
        controlBar: {
          pictureInPictureToggle: false,
          volumePanel: {
            inline: true,
          },
          chaptersButton: false,
          progressControl: true,
          remainingTimeDisplay: false,
          currentTimeDisplay: !isVirtual,
          durationDisplay: !isVirtual,
        },
        html5: {
          dash: {
            updateSettings: [
              {
                streaming: {
                  buffer: {
                    bufferTimeAtTopQuality: 30,
                    bufferTimeAtTopQualityLongForm: 30,
                  },
                  gaps: {
                    jumpGaps: false,
                    jumpLargeGaps: false,
                  },
                },
              },
            ],
          },
        },
        nativeControlsForTouch: false,
        playbackRates: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
        inactivityTimeout: 700,
        preload: "none",
        playsinline: true,
        techOrder: ["chromecast", "html5"],
        userActions: {
          hotkeys: function (this: VideoJsPlayer, event) {
            handleHotkeys(this, event);
          },
        },
        plugins: {
          airPlay: {
            addButtonToControlBar: uiConfig?.enableChromecast ?? false,
          },
          chromecast: {},
          vttThumbnails: {
            showTimestamp: true,
          },
          markers: {},
          sourceSelector: {},
          persistVolume: {},
          bigButtons: {},
          ...(videojs.getPlugin("seekButtons") ? {
            seekButtons: {
              forward: 10,
              back: 10,
            }
          } : {}),
          skipButtons: {},
          trackActivity: {},
          vrMenu: {},
          autostartButton: {
            enabled: interfaceConfig?.autostartVideo ?? false,
          },
          ratingButton: {
            rating: scene.rating100 ?? null,
            ratingSystemType: configuration?.ui.ratingSystemOptions?.type,
            precision: configuration?.ui.ratingSystemOptions?.starPrecision,
          },
          abLoopPlugin: {
            start: 0,
            end: false,
            enabled: false,
            loopIfBeforeStart: true,
            loopIfAfterEnd: true,
            pauseAfterLooping: false,
            pauseBeforeLooping: false,
            createButtons: uiConfig?.showAbLoopControls ?? false,
          },
          mediaSession: {},
          wakeSentinel: {},
        },
      };

      const videoEl = document.createElement("video-js");
      videoEl.setAttribute("data-vjs-player", "true");
      videoEl.setAttribute("crossorigin", "anonymous");
      videoEl.classList.add("vjs-big-play-centered");
      videoRef.current!.appendChild(videoEl);

      const vjs = videojs(videoEl, options);

      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const settings = (vjs as any).textTrackSettings;
      settings.setValues({
        backgroundColor: "#000",
        backgroundOpacity: "0.5",
      });
      settings.updateDisplay();

      vjs.focus();
      setPlayer(vjs);
      setPlayerEl(vjs.el());

      // Video player destructor
      return () => {
        vjs.dispose();
        videoEl.remove();
        setPlayer(undefined);
        setPlayerEl(null);

        // reset sceneId to force reload sources
        sceneId.current = undefined;
      };
      // empty deps - only init once
      // showAbLoopControls is necessary to re-init the player when the config changes
      // Note: interfaceConfig?.autostartVideo is intentionally excluded to prevent
      // player re-initialization when toggling autostart (which would interrupt playback)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uiConfig?.showAbLoopControls, uiConfig?.enableChromecast, isVirtual]);

    useEffect(() => {
      const player = getPlayer();
      if (!player) return;
      const skipButtons = player.skipButtons();
      skipButtons.setForwardHandler(onNext);
      skipButtons.setBackwardHandler(onPrevious);
    }, [getPlayer, onNext, onPrevious]);

    useEffect(() => {
      if (scene.interactive && interactiveInitialised) {
        interactiveReady.current = false;
        uploadScript(scene.paths.funscript || "").then(() => {
          interactiveReady.current = true;
        });
      }
    }, [
      uploadScript,
      interactiveInitialised,
      scene.interactive,
      scene.paths.funscript,
    ]);

    // play the script if video started before script upload finished
    useEffect(() => {
      if (interactiveState !== ConnectionState.Ready) return;
      const player = getPlayer();
      if (!player || player.paused()) return;
      interactiveClient.ensurePlaying(player.currentTime());
    }, [interactiveState, getPlayer, interactiveClient]);

    useEffect(() => {
      const player = getPlayer();
      if (!player) return;

      const vrMenu = player.vrMenu();

    // Show the VR button when the scene has a stored vr_mode, or when the
    // scene is tagged with the configured VR tag.
    const hasVrMode = !!scene.vr_mode;
    const hasVrTag = vrTag ? scene.tags.some((tag) => vrTag === tag.name) : false;
    const showButton = hasVrMode || hasVrTag;

    vrMenu.setShowButton(showButton);

    // Restore the stored mode (or reset to Off) every time the scene changes.
    // In-session VR mode changes are ephemeral and do not persist to the scene.
    vrMenu.setInitialMode(vrModeToVRType(scene.vr_mode));
  }, [getPlayer, scene, vrTag]);
    useEffect(() => {
      const player = getPlayer();
      if (!player) return;

      function canplay(this: VideoJsPlayer) {
        // if we're seeking before starting, don't set the initial timestamp
        // when starting from the beginning, there is a small delay before the event
        // is triggered, so we can't just check if the time is 0
        if (this.currentTime() >= 0.1) {
          return;
        }
      }

      function playing(this: VideoJsPlayer) {
        // This still runs even if autoplay failed on Safari,
        // only set flag if actually playing
        if (!started.current && !this.paused()) {
          started.current = true;
        }
      }

      function loadstart(this: VideoJsPlayer) {
        setReady(true);
      }

      function fullscreenchange(this: VideoJsPlayer) {
        setFullscreen(this.isFullscreen());
      }

      player.on("canplay", canplay);
      player.on("playing", playing);
      player.on("loadstart", loadstart);
      player.on("fullscreenchange", fullscreenchange);

      return () => {
        player.off("canplay", canplay);
        player.off("playing", playing);
        player.off("loadstart", loadstart);
        player.off("fullscreenchange", fullscreenchange);
      };
    }, [getPlayer]);

    // delay before second play event after a play event to adjust for video player issues
    const DELAY_FOR_SECOND_PLAY_MS = 1000;
    const playingTimer = useRef<number>();

    useEffect(() => {
      const player = getPlayer();
      if (!player) return;

      function playing(this: VideoJsPlayer) {
        if (scene.interactive && interactiveReady.current) {
          interactiveClient.play(this.currentTime());
          // trigger a second script play event to adjust for video player issues
          clearTimeout(playingTimer.current);
          playingTimer.current = setTimeout(() => {
            if (this.paused()) return;
            interactiveClient.play(this.currentTime());
          }, DELAY_FOR_SECOND_PLAY_MS);
        }
      }

      function pause(this: VideoJsPlayer) {
        interactiveClient.pause();
      }

      function timeupdate(this: VideoJsPlayer) {
        if (this.paused()) return;
        const currentTime = this.currentTime();
        setTime(currentTime);

        // Update virtual progress bar display
        if (this.virtualStart !== undefined || this.virtualEnd !== undefined) {
          const vStart = this.virtualStart ?? 0;
          const vEnd = this.virtualEnd ?? this.duration();
          if (vEnd > vStart) {
            const pct =
              Math.min(1, Math.max(0, (currentTime - vStart) / (vEnd - vStart))) * 100;
            this.el().style.setProperty(
              "--vjs-virtual-progress",
              `${pct.toFixed(2)}%`
            );
          }
        }

        if (scene.end_point && currentTime >= scene.end_point) {
          this.pause();
          if (this.loop()) {
            this.currentTime(scene.start_point ?? 0);
            this.play();
          } else {
            this.currentTime(scene.end_point);
          }
        }
      }

      function seeking(this: VideoJsPlayer) {
        const vStart = this.virtualStart;
        const vEnd = this.virtualEnd;
        if (vStart === undefined && vEnd === undefined) return;
        const start = vStart ?? 0;
        const end = vEnd ?? this.duration();
        const current = this.currentTime();
        if (current < start) this.currentTime(start);
        else if (current > end) this.currentTime(end);
      }

      player.on("playing", playing);
      player.on("pause", pause);
      player.on("timeupdate", timeupdate);
      player.on("seeking", seeking);

      return () => {
        player.off("playing", playing);
        player.off("pause", pause);
        player.off("timeupdate", timeupdate);
        player.off("seeking", seeking);
        clearTimeout(playingTimer.current);
      };
    }, [getPlayer, interactiveClient, scene]);

    useEffect(() => {
      const player = getPlayer();
      if (!player) return;

      // don't re-initialise the player unless the scene has changed
      if (!file || scene.id === sceneId.current) return;

      sceneId.current = scene.id;

      setReady(false);

      // reset on new scene
      player.trackActivity().reset();

      // always stop the interactive client on initialisation
      interactiveClient.pause();

      const isSafari = UAParser().browser.name?.includes("Safari");
      const isLandscape = file.height && file.width && file.width > file.height;
      const mobileUiOptions = {
        fullscreen: {
          enterOnRotate: true,
          exitOnRotate: true,
          lockOnRotate: true,
          lockToLandscapeOnEnter: uiConfig?.disableMobileMediaAutoRotateEnabled
            ? false
            : isLandscape,
        },
        touchControls: {
          seekSeconds: 10,
          tapTimeout: 300,
          disableClick: false,
        },
        doubleClickForFullscreen: false,
      };
      if (!isSafari && typeof player.mobileUi === "function") {
        player.mobileUi(mobileUiOptions);
      }

      function isDirect(src: URL) {
        return (
          src.pathname.endsWith("/stream") ||
          src.pathname.endsWith("/stream.mpd") ||
          src.pathname.endsWith("/stream.m3u8")
        );
      }

      const { duration } = file;
      const sourceSelector = player.sourceSelector();
      sourceSelector.setSources(
        scene.sceneStreams
          .filter((stream) => {
            const src = new URL(stream.url);
            const isFileTranscode = !isDirect(src);

            return !(isFileTranscode && isSafari);
          })
          .map((stream) => {
            const src = new URL(stream.url);

            return {
              src: stream.url,
              type: stream.mime_type ?? undefined,
              label: stream.label ?? undefined,
              offset: !isDirect(src),
              duration,
            };
          })
      );

      function getDefaultLanguageCode() {
        let languageCode = window.navigator.language;

        if (languageCode.indexOf("-") !== -1) {
          languageCode = languageCode.split("-")[0];
        }

        if (languageCode.indexOf("_") !== -1) {
          languageCode = languageCode.split("_")[0];
        }

        return languageCode;
      }

      if (scene.captions && scene.captions.length > 0) {
        const languageCode = getDefaultLanguageCode();
        let hasDefault = false;

        for (let caption of scene.captions) {
          const lang = caption.language_code;
          let label = lang;
          if (languageMap.has(lang)) {
            label = languageMap.get(lang)!;
          }

          label = label + " (" + caption.caption_type + ")";
          const setAsDefault = !hasDefault && languageCode == lang;
          if (setAsDefault) {
            hasDefault = true;
          }
          sourceSelector.addTextTrack(
            {
              src: `${scene.paths.caption}?lang=${lang}&type=${caption.caption_type}`,
              kind: "captions",
              srclang: lang,
              label: label,
              default: setAsDefault,
            },
            false
          );
        }
      }

      const alwaysStartFromBeginning =
        uiConfig?.alwaysStartFromBeginning ?? false;
      const resumeTime = scene.resume_time ?? 0;

      let startPosition = _initialTimestamp;

      if (!startPosition) {
        const vStart = scene.start_point ?? 0;
        const vEnd = scene.end_point ?? file.duration;
        const isVirtualScene = vStart > 0 || !!scene.end_point;

        if (isVirtualScene) {
          // For virtual scenes: resume within segment bounds if valid,
          // otherwise fall back to the segment start_point.
          const validResume =
            !alwaysStartFromBeginning &&
            resumeTime > vStart &&
            resumeTime < vEnd;
          startPosition = validResume ? resumeTime : vStart;
        } else if (!alwaysStartFromBeginning && file.duration > resumeTime) {
          startPosition = resumeTime;
        }
      }

      setTime(startPosition);

      player.load();
      player.focus();

      // Check the autostart button plugin for user preference
      const autostartButton = player.autostartButton();
      const buttonEnabled = autostartButton.getEnabled();
      auto.current =
        autoplay ||
        buttonEnabled ||
        (interfaceConfig?.autostartVideo ?? false) ||
        _initialTimestamp > 0;

      player.ready(() => {
        player.vttThumbnails().src(scene.paths.vtt ?? null);

        if (startPosition) {
          player.currentTime(startPosition);
        }
      });

      started.current = false;
    }, [
      getPlayer,
      file,
      scene,
      interactiveClient,
      autoplay,
      interfaceConfig?.autostartVideo,
      uiConfig?.alwaysStartFromBeginning,
      uiConfig?.disableMobileMediaAutoRotateEnabled,
      _initialTimestamp,
    ]);

    useEffect(() => {
      return () => {
        // stop the interactive client on unmount
        interactiveClient.pause();
      };
    }, [interactiveClient]);

    const loadMarkers = useCallback(() => {
      const player = getPlayer();
      if (!player) return;

      const markerData = scene.scene_markers.map((marker) => ({
        title: getMarkerTitle(marker),
        seconds: marker.seconds,
        end_seconds: marker.end_seconds ?? null,
        primaryTag: marker.primary_tag,
      }));

      const markers = player!.markers();

      const uniqueTagNames = markerData
        .map((marker) => marker.primaryTag.name)
        .filter((value, index, self) => self.indexOf(value) === index);

      // Wait for colors
      markers.findColors(uniqueTagNames);

      const showRangeTags =
        !ScreenUtils.isMobile() && (uiConfig?.showRangeMarkers ?? true);
      const timestampMarkers: IMarker[] = [];
      const rangeMarkers: IMarker[] = [];

      if (!showRangeTags) {
        for (const marker of markerData) {
          timestampMarkers.push(marker);
        }
      } else {
        for (const marker of markerData) {
          if (marker.end_seconds === null) {
            timestampMarkers.push(marker);
          } else {
            rangeMarkers.push(marker);
          }
        }
      }

      requestAnimationFrame(() => {
        markers.addDotMarkers(timestampMarkers);
        markers.addRangeMarkers(rangeMarkers);
      });
    }, [getPlayer, scene, uiConfig]);

    useEffect(() => {
      const player = getPlayer();
      if (!player) return;

      if (scene.paths.screenshot) {
        player.poster(scene.paths.screenshot);
      } else {
        player.poster("");
      }

      // Define the event handler outside the useEffect
      const handleLoadMetadata = () => {
        loadMarkers();
      };

      // Ensure markers are added after player is fully ready and sources are loaded
      if (player.readyState() >= 1) {
        loadMarkers();
      } else {
        player.on("loadedmetadata", handleLoadMetadata);
      }

      return () => {
        player.off("loadedmetadata", handleLoadMetadata);
        const markers = player!.markers();
        markers.clearMarkers();
      };
    }, [getPlayer, scene, loadMarkers]);

    useEffect(() => {
      const player = getPlayer();
      if (!player) return;

      async function saveActivity(resumeTime: number, playDuration: number) {
        if (!scene.id) return;

        await sceneSaveActivity({
          variables: {
            id: scene.id,
            playDuration,
            resume_time: resumeTime,
          },
        });
      }

      async function incrementPlayCount() {
        if (!scene.id) return;

        await sceneIncrementPlayCount({
          variables: {
            id: scene.id,
          },
        });
      }

      const activity = player.trackActivity();
      activity.saveActivity = saveActivity;
      activity.incrementPlayCount = incrementPlayCount;
      activity.minimumPlayPercent = minimumPlayPercent;
      activity.countOnStart = countOnStart;
      // Wire virtual segment bounds so percentage calculations are relative
      // to the segment duration, not the full video file duration.
      activity.segmentStart = scene.start_point ?? 0;
      activity.segmentEnd = scene.end_point ?? 0;
      activity.setEnabled(trackActivity);
    }, [
      getPlayer,
      scene.id,
      sceneSaveActivity,
      sceneIncrementPlayCount,
      trackActivity,
      minimumPlayPercent,
      countOnStart,
    ]);

    // Gallery Creator Logic
    const [showGalleryDialog, setShowGalleryDialog] = useState(false);

    // Keyboard shortcut help dialog
    const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

    // Add 'g' and '?' hotkeys via global listener (independent of player focus)
    useEffect(() => {
      const handleKeyDown = (e: globalThis.KeyboardEvent) => {
        // Only trigger if not typing in input
        if (e.defaultPrevented) return;
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

        if (e.key === 'g') {
          setShowGalleryDialog(true);
        }
        if (e.key === '?') {
          setShowShortcutsHelp((v) => !v);
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const getVideoElement = () => {
      const player = getPlayer();
      if (!player) return null;
      return player.tech({ IWillNotUseThisInPlugins: true }).el() as HTMLVideoElement;
    };

    // Sync autostart button with config changes
    useEffect(() => {
      const player = getPlayer();
      if (!player) return;

      async function updateAutoStart(enabled: boolean) {
        await updateInterfaceConfig({
          variables: {
            input: {
              autostartVideo: enabled,
            },
          },
        });
      }

      const autostartButton = player.autostartButton();
      if (autostartButton) {
        autostartButton.syncWithConfig(
          interfaceConfig?.autostartVideo ?? false
        );
        autostartButton.updateAutoStart = updateAutoStart;
      }
    }, [getPlayer, updateInterfaceConfig, interfaceConfig?.autostartVideo]);

    // Setup rating button with scene rating update handler
    useEffect(() => {
      const player = getPlayer();
      if (!player) return;

      const ratingButton = player.ratingButton();
      if (ratingButton) {
        // Set callback for rating updates
        ratingButton.setOnSetRating((value: number | null) => {
          updateScene({
            variables: {
              input: {
                id: scene.id,
                rating100: value,
              },
            },
          });
        });
      }
    }, [getPlayer, updateScene, scene.id]);

    // Sync rating button when scene rating changes
    useEffect(() => {
      const player = getPlayer();
      if (!player) return;

      const ratingButton = player.ratingButton();
      if (ratingButton) {
        ratingButton.updateRating(scene.rating100 ?? null);
      }
    }, [getPlayer, scene.rating100]);

    useEffect(() => {
      const player = getPlayer();
      if (!player) return;

      // Sync virtual bounds
      player.virtualStart = scene.start_point ?? undefined;
      player.virtualEnd = scene.end_point ?? undefined;

      player.loop(looping);
      interactiveClient.setLooping(looping);
    }, [getPlayer, interactiveClient, looping, scene.start_point, scene.end_point]);

    // Add vjs-virtual class and intercept progress bar clicks for virtual scenes
    useEffect(() => {
      const player = getPlayer();
      if (!player) return;

      if (isVirtual) {
        player.addClass("vjs-virtual");

        const progressHolder = player
          .el()
          .querySelector(".vjs-progress-holder") as HTMLElement | null;
        if (!progressHolder) return () => { player.removeClass("vjs-virtual"); };

        const handleProgressSeek = (e: MouseEvent) => {
          const vStart = player.virtualStart ?? 0;
          const vEnd = player.virtualEnd ?? player.duration();
          const rect = progressHolder.getBoundingClientRect();
          const pct = Math.min(
            1,
            Math.max(0, (e.clientX - rect.left) / rect.width)
          );
          e.stopPropagation();
          player.currentTime(vStart + pct * (vEnd - vStart));
        };

        const handleProgressTouchSeek = (e: TouchEvent) => {
          if (!e.touches.length) return;
          const vStart = player.virtualStart ?? 0;
          const vEnd = player.virtualEnd ?? player.duration();
          const rect = progressHolder.getBoundingClientRect();
          const pct = Math.min(
            1,
            Math.max(0, (e.touches[0].clientX - rect.left) / rect.width)
          );
          e.stopPropagation();
          player.currentTime(vStart + pct * (vEnd - vStart));
        };

        progressHolder.addEventListener("mousedown", handleProgressSeek, true);
        progressHolder.addEventListener("touchstart", handleProgressTouchSeek, true);
        return () => {
          progressHolder.removeEventListener(
            "mousedown",
            handleProgressSeek,
            true
          );
          progressHolder.removeEventListener(
            "touchstart",
            handleProgressTouchSeek,
            true
          );
          player.removeClass("vjs-virtual");
        };
      } else {
        player.removeClass("vjs-virtual");
      }
    }, [getPlayer, isVirtual]);

    useEffect(() => {
      const player = getPlayer();
      if (!player || !ready || !auto.current) {
        return;
      }

      // check if we're waiting for the interactive client
      if (
        scene.interactive &&
        interactiveClient.handyKey &&
        currentScript !== scene.paths.funscript
      ) {
        return;
      }

      player.play();
      auto.current = false;
    }, [getPlayer, scene, ready, interactiveClient, currentScript]);

    // Mirror VideoJS user-activity state so the Handy icon hides during playback inactivity
    useEffect(() => {
      const player = getPlayer();
      if (!player) return;
      const onActive = () => setUserActive(true);
      const onInactive = () => setUserActive(false);
      player.on("useractive", onActive);
      player.on("userinactive", onInactive);
      return () => {
        player.off("useractive", onActive);
        player.off("userinactive", onInactive);
      };
    }, [getPlayer]);

    // Attach handler for onComplete event
    useEffect(() => {
      const player = getPlayer();
      if (!player) return;

      player.on("ended", onComplete);

      return () => player.off("ended");
    }, [getPlayer, onComplete]);

    // set up mediaSession plugin
    useEffect(() => {
      const player = getPlayer();
      if (!player) return;

      // set up mediasession plugin
      // get performer names as array
      const performers = scene?.performers.map((p) => p.name).join(", ");
      player
        .mediaSession()
        .setMetadata(
          scene?.title ?? "Stash",
          scene?.studio?.name ?? performers ?? "Stash",
          scene.paths.screenshot || ""
        );
    }, [getPlayer, scene]);

    const pausedBeforeScrubber = useRef(true);

    function onScrubberScroll() {
      const player = getPlayer();
      if (started.current && player) {
        pausedBeforeScrubber.current = player.paused();
        player.pause();
      }
    }

    function onScrubberSeek(seconds: number) {
      const player = getPlayer();
      if (started.current && player) {
        player.currentTime(seconds);
        if (!pausedBeforeScrubber.current) {
          player.play();
        }
      } else {
        setTime(seconds);
      }
    }

    // Override spacebar to always pause/play
    function onKeyDown(this: HTMLDivElement, event: KeyboardEvent) {
      const player = getPlayer();
      if (!player) return;

      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      if (event.key == " ") {
        event.preventDefault();
        event.stopPropagation();
        if (player.paused()) {
          player.play();
        } else {
          player.pause();
        }
      }
    }

    const isPortrait =
      file && file.height && file.width && file.height > file.width;

    return (
      <div
        className={cx("VideoPlayer", {
          portrait: isPortrait,
          "no-file": !file,
        })}
        onKeyDownCapture={onKeyDown}
      >
        <div className="video-wrapper">
          <div ref={videoRef} className="vjs-container" />
          {isVirtual && ready && (
            <div className="virtual-segment-time">
              {TextUtils.secondsToTimestamp(
                Math.max(0, time - virtualSegmentStart)
              )}
              {" / "}
              {TextUtils.secondsToTimestamp(virtualDuration)}
            </div>
          )}
          {ready && activeMarker && (
            <div
              key={activeMarker.id}
              className="chapter-overlay"
            >
              {activeMarker.primary_tag?.name || activeMarker.title}
            </div>
          )}
        </div>

        {playerEl && createPortal(
          <>
            {interactiveState === ConnectionState.Ready && (
              <InteractiveControls
                client={interactiveClient}
                show={scene.interactive && !getPlayer()?.paused()}
                visible={userActive}
              />
            )}
            {import.meta.env.DEV && interactiveState !== ConnectionState.Ready && (
              <InteractiveControls client={interactiveClient} show={false} visible={userActive} />
            )}
          </>,
          playerEl
        )}

        {scene.interactive &&
          (interactiveState !== ConnectionState.Ready ||
            getPlayer()?.paused()) && <SceneInteractiveStatus />}
        {file && showScrubber && (
          <ScenePlayerScrubber
            file={file}
            scene={scene}
            time={time}
            start={scene.start_point ?? 0}
            end={scene.end_point ?? file.duration}
            onSeek={onScrubberSeek}
            onScroll={onScrubberScroll}
          />
        )}

        {/* Keyboard shortcut help dialog (toggled by ?) */}
        <Dialog
          open={showShortcutsHelp}
          onClose={() => setShowShortcutsHelp(false)}
          maxWidth="xs"
          fullWidth
          slotProps={{
            paper: {
              sx: {
                bgcolor: "#18181b",
                backgroundImage: "none",
                border: "1px solid #27272a",
              },
            },
          }}
        >
          <DialogTitle
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: "1px solid #27272a",
              pb: 1.5,
              fontSize: "1rem",
              fontWeight: 600,
            }}
          >
            Keyboard Shortcuts
            <IconButton
              onClick={() => setShowShortcutsHelp(false)}
              size="small"
              sx={{ color: "grey.500", "&:hover": { color: "grey.200" } }}
              aria-label="close"
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </DialogTitle>
          <DialogContent sx={{ pt: 1.5, px: 2 }}>
            <Table size="small">
              <TableBody>
                {[
                  ["Space / Enter", "Play / Pause"],
                  ["→ / ←", "+10s / −10s"],
                  ["Shift+→ / Shift+←", "+5s / −5s"],
                  ["Ctrl+→ / Ctrl+←", "+60s / −60s"],
                  ["] / [", "+10% / −10%"],
                  ["1–9", "Jump to 10%–90%"],
                  ["0", "Jump to start"],
                  ["↑ / ↓", "Volume +10% / −10%"],
                  ["M", "Mute toggle"],
                  ["F", "Fullscreen toggle"],
                  ["L", "A/B loop toggle"],
                  ["Shift+L", "Player loop toggle"],
                  ["> / <", "Speed up / down"],
                  ["G", "Open gallery creator"],
                  ["?", "Show this help"],
                ].map(([key, action]) => (
                  <TableRow
                    key={key}
                    sx={{
                      "&:hover": { bgcolor: "rgba(255, 255, 255, 0.04)" },
                      "&:last-child td": { border: 0 },
                    }}
                  >
                    <TableCell sx={{ border: 0, pr: 2, py: 0.75, width: "1%" }}>
                      <Box
                        component="span"
                        sx={{
                          fontFamily: "monospace",
                          fontSize: "0.75rem",
                          whiteSpace: "nowrap",
                          bgcolor: "#27272a",
                          border: "1px solid #3f3f46",
                          borderRadius: "4px",
                          px: 0.75,
                          py: 0.25,
                          color: "grey.200",
                        }}
                      >
                        {key}
                      </Box>
                    </TableCell>
                    <TableCell
                      sx={{ border: 0, py: 0.75, color: "grey.400", fontSize: "0.875rem" }}
                    >
                      {action}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DialogContent>
        </Dialog>
      </div>
    );
  }
);

export default ScenePlayer;
