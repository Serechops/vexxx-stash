import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  MouseEvent,
  useMemo,
} from "react";
import { Link } from "react-router-dom";
import { Box } from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import TextUtils from "src/utils/text";
import NavUtils from "src/utils/navigation";
import cx from "classnames";
import { SceneQueue } from "src/models/sceneQueue";
import { useConfigurationContext } from "src/hooks/Config";
import { markerTitle } from "src/core/markers";
import { objectTitle } from "src/core/files";

export type WallItemType = keyof WallItemData;

export type WallItemData = {
  scene: GQL.SlimSceneDataFragment;
  sceneMarker: GQL.SceneMarkerDataFragment;
  image: GQL.SlimImageDataFragment;
};

interface IWallItemProps<T extends WallItemType> {
  type: T;
  index?: number;
  data: WallItemData[T];
  sceneQueue?: SceneQueue;
  clickHandler?: (e: MouseEvent, item: WallItemData[T]) => void;
  className: string;
  zoomIndex?: number;
  columns?: number;
}

interface IPreviews {
  video?: string;
  animation?: string;
  image?: string;
}

const Preview: React.FC<{
  previews: IPreviews;
  config?: GQL.ConfigDataFragment;
  active: boolean;
}> = ({ previews, config, active }) => {
  const videoEl = useRef<HTMLVideoElement>(null);
  const [isMissing, setIsMissing] = useState(false);

  const previewType = config?.interface?.wallPlayback;
  const soundOnPreview = config?.interface?.soundOnPreview ?? false;

  useEffect(() => {
    const video = videoEl.current;
    if (!video) return;

    video.muted = !(soundOnPreview && active);
    if (previewType !== "video") {
      if (active) {
        video.play();
      } else {
        video.pause();
      }
    }
  }, [previewType, soundOnPreview, active]);

  const image = (
    <img
      loading="lazy"
      alt=""
      className="wall-item-media"
      src={
        (previewType === "animation" && previews.animation) || previews.image
      }
    />
  );
  const video = (
    <video
      disableRemotePlayback
      playsInline
      src={previews.video}
      poster={previews.image}
      autoPlay={previewType === "video"}
      loop
      muted
      className={cx("wall-item-media", {
        "wall-item-preview": previewType !== "video",
      })}
      onError={(error: React.SyntheticEvent<HTMLVideoElement>) => {
        // Error code 4 indicates media not found or unsupported
        setIsMissing(error.currentTarget.error?.code === 4);
      }}
      ref={videoEl}
    />
  );

  if (isMissing) {
    // show the image if the video preview is unavailable
    if (previews.image) {
      return image;
    }

    return (
      <div className="wall-item-media wall-item-missing">
        Pending preview generation
      </div>
    );
  }

  if (previewType === "video") {
    return video;
  }
  return (
    <>
      {image}
      {video}
    </>
  );
};

export const WallItem = <T extends WallItemType>({
  type,
  index,
  data,
  sceneQueue,
  clickHandler,
  className,
  columns = 5,
}: IWallItemProps<T>) => {
  const [active, setActive] = useState(false);
  const itemEl = useRef<HTMLDivElement>(null);
  const { configuration: config } = useConfigurationContext();
  const showTextContainer = config?.interface.wallShowTitle ?? true;

  const previews = useMemo(() => {
    switch (type) {
      case "scene":
        const scene = data as GQL.SlimSceneDataFragment;
        return {
          video: scene.paths.preview ?? undefined,
          animation: scene.paths.webp ?? undefined,
          image: scene.paths.screenshot ?? undefined,
        };
      case "sceneMarker":
        const sceneMarker = data as GQL.SceneMarkerDataFragment;
        return {
          video: sceneMarker.stream,
          animation: sceneMarker.preview,
          image: sceneMarker.screenshot,
        };
      case "image":
        const image = data as GQL.SlimImageDataFragment;
        return {
          image: image.paths.thumbnail ?? undefined,
        };
      default:
        // this is unreachable, inference fails for some reason
        return type as never;
    }
  }, [type, data]);
  const linkSrc = useMemo(() => {
    switch (type) {
      case "scene":
        const scene = data as GQL.SlimSceneDataFragment;
        return sceneQueue
          ? sceneQueue.makeLink(scene.id, { sceneIndex: index })
          : `/scenes/${scene.id}`;
      case "sceneMarker":
        const sceneMarker = data as GQL.SceneMarkerDataFragment;
        return NavUtils.makeSceneMarkerUrl(sceneMarker);
      case "image":
        const image = data as GQL.SlimImageDataFragment;
        return `/images/${image.id}`;
      default:
        return type;
    }
  }, [type, data, sceneQueue, index]);
  const title = useMemo(() => {
    switch (type) {
      case "scene":
        const scene = data as GQL.SlimSceneDataFragment;
        return objectTitle(scene);
      case "sceneMarker":
        const sceneMarker = data as GQL.SceneMarkerDataFragment;
        const newTitle = markerTitle(sceneMarker);
        const seconds = TextUtils.formatTimestampRange(
          sceneMarker.seconds,
          sceneMarker.end_seconds ?? undefined
        );
        if (newTitle) {
          return `${newTitle} - ${seconds}`;
        } else {
          return seconds;
        }
      case "image":
        return "";
      default:
        return type;
    }
  }, [type, data]);
  const tags = useMemo(() => {
    if (type === "sceneMarker") {
      const sceneMarker = data as GQL.SceneMarkerDataFragment;
      return [sceneMarker.primary_tag, ...sceneMarker.tags];
    }
  }, [type, data]);

  const setInactive = () => setActive(false);
  const toggleActive = useCallback((e: TransitionEvent) => {
    if (e.propertyName === "transform" && e.elapsedTime === 0) {
      // Get the current scale of the wall-item. If it's smaller than 1.1 the item is being scaled up, otherwise down.
      const matrixScale = getComputedStyle(itemEl.current!).transform.match(
        /-?\d+\.?\d+|\d+/g
      )?.[0];
      const scale = Number.parseFloat(matrixScale ?? "2") || 2;
      setActive((value) => scale <= 1.1 && !value);
    }
  }, []);

  useEffect(() => {
    const item = itemEl.current!;
    item.addEventListener("transitioncancel", setInactive);
    item.addEventListener("transitionstart", toggleActive);
    return () => {
      item.removeEventListener("transitioncancel", setInactive);
      item.removeEventListener("transitionstart", toggleActive);
    };
  }, [toggleActive]);

  const onClick = (e: MouseEvent) => {
    clickHandler?.(e, data);
  };

  const renderText = () => {
    if (!showTextContainer) return;

    return (
      <Box
        className="wall-item-text"
        sx={{
          background: "linear-gradient(rgba(255, 255, 255, 0.25), rgba(255, 255, 255, 0.65))",
          bottom: 0,
          color: "#444",
          fontWeight: 700,
          left: 0,
          lineHeight: 1,
          overflow: "hidden",
          padding: "5px",
          position: "absolute",
          textAlign: "center",
          width: "100%",
          zIndex: 2000000,
        }}
      >
        <div>{title}</div>
        {tags?.map((tag) => (
          <Box
            component="span"
            key={tag.id}
            className="wall-tag"
            sx={{
              fontSize: 10,
              fontWeight: 400,
              lineHeight: 1,
              margin: "0 3px",
            }}
          >
            {tag.name}
          </Box>
        ))}
      </Box>
    );
  };

  const widthPct = 100 / columns;
  const heightVw = widthPct * 0.5625;

  return (
    <Box
      className="stash-wall-item"
      sx={{
        height: `${heightVw}vw`,
        lineHeight: 0,
        // maxHeight: 253, // Removed for zoom
        // maxWidth: 450, // Removed for zoom
        overflow: "visible",
        padding: 0,
        transition: "zIndex 0.5s 0.5s",
        width: `${widthPct}%`,
        zIndex: 0,
        position: "relative",

        "@media (max-width: 576px)": {
          height: "inherit",
          maxWidth: "100%",
          minHeight: 210,
          width: "100%",
        },

        "&:hover": {
          zIndex: 2,
          "& .wall-item-container": {
            backgroundColor: "black",
            position: "relative",
            transform: "scale(2)",
            transitionDelay: "0.5s",
            zIndex: 10,
          },
          "& .wall-item-media": {
            transitionDelay: "0.5s",
            transitionDuration: "0.5s",
            zIndex: 10,
          },
          "&::before": {
            opacity: 0.8,
            transitionDelay: "0.5s",
          }
        },

        "&::before": {
          backgroundColor: "black",
          bottom: 0,
          content: '""',
          left: 0,
          opacity: 0,
          pointerEvents: "none",
          position: "fixed",
          right: 0,
          top: 0,
          transition: "opacity 0.5s 0s ease-in-out",
          zIndex: -1,
        }
      }}
    >
      <Box
        className={`wall-item-container ${className}`}
        ref={itemEl}
        sx={{
          backgroundColor: "black",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          position: "relative",
          transition: "all 0.5s 0s",
          width: "100%",
          zIndex: 0,
          "&.transform-origin-top-left": { transformOrigin: "top left" },
          "&.transform-origin-top-right": { transformOrigin: "top right" },
          "&.transform-origin-bottom-left": { transformOrigin: "bottom left" },
          "&.transform-origin-bottom-right": { transformOrigin: "bottom right" },
          "&.transform-origin-left": { transformOrigin: "left" },
          "&.transform-origin-right": { transformOrigin: "right" },
          "&.transform-origin-top": { transformOrigin: "top" },
          "&.transform-origin-bottom": { transformOrigin: "bottom" },
          "&.transform-origin-center": { transformOrigin: "center" },
        }}
      >
        <Link
          onClick={onClick}
          to={linkSrc}
          className="wall-item-anchor"
          style={{ textDecoration: 'none', display: 'block', width: '100%', height: '100%' }}
        >
          <Preview previews={previews} config={config} active={active} />
          {renderText()}
        </Link>
      </Box>
    </Box>
  );
};
