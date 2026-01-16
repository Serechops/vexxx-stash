import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as GQL from "src/core/generated-graphql";
import { SceneQueue } from "src/models/sceneQueue";
import Gallery, {
  GalleryI,
  PhotoProps,
  RenderImageProps,
} from "react-photo-gallery";
import { useConfigurationContext } from "src/hooks/Config";
import { objectTitle } from "src/core/files";
import { Link, useHistory } from "react-router-dom";
import { TruncatedText } from "../Shared/TruncatedText";
import TextUtils from "src/utils/text";
import { useIntl } from "react-intl";
import cx from "classnames";

interface IScenePhoto {
  scene: GQL.SlimSceneDataFragment;
  link: string;
  onError?: (photo: PhotoProps<IScenePhoto>) => void;
}

interface IExtraProps {
  maxHeight: number;
}

export const SceneWallItem: React.FC<
  RenderImageProps<IScenePhoto> & IExtraProps
> = (props: RenderImageProps<IScenePhoto> & IExtraProps) => {
  const intl = useIntl();

  const { configuration } = useConfigurationContext();
  const playSound = configuration?.interface.soundOnPreview ?? false;
  const showTitle = configuration?.interface.wallShowTitle ?? false;

  const height = Math.min(props.maxHeight, props.photo.height);
  const zoomFactor = height / props.photo.height;
  const width = props.photo.width * zoomFactor;

  const [active, setActive] = useState(false);

  type style = Record<string, string | number | undefined>;
  var divStyle: style = {
    margin: props.margin,
    display: "block",
  };

  if (props.direction === "column") {
    divStyle.position = "absolute";
    divStyle.left = props.left;
    divStyle.top = props.top;
  }

  var handleClick = function handleClick(event: React.MouseEvent) {
    if (props.onClick) {
      props.onClick(event, { index: props.index });
    }
  };

  const video = props.photo.src.includes("preview");
  const ImagePreview = video ? "video" : "img";

  const { scene } = props.photo;
  const title = objectTitle(scene);
  const performerNames = scene.performers.map((p) => p.name);
  const performers =
    performerNames.length >= 2
      ? [...performerNames.slice(0, -2), performerNames.slice(-2).join(" & ")]
      : performerNames;

  return (
    <div
      className={cx("wall-item", { "show-title": showTitle })}
      role="button"
      style={{
        ...divStyle,
        width,
        height,
      }}
    >
      <ImagePreview
        loading="lazy"
        loop={video}
        muted={!video || !playSound || !active}
        autoPlay={video}
        playsInline={video}
        key={props.photo.key}
        src={props.photo.src}
        width={width}
        height={height}
        alt={props.photo.alt}
        onMouseEnter={() => setActive(true)}
        onMouseLeave={() => setActive(false)}
        onClick={handleClick}
        onError={() => {
          props.photo.onError?.(props.photo);
        }}
      />
      <div className="lineargradient">
        <footer className="wall-item-footer">
          <Link to={props.photo.link} onClick={(e) => e.stopPropagation()}>
            {title && (
              <TruncatedText
                text={title}
                lineCount={1}
                className="wall-item-title"
              />
            )}
            <TruncatedText text={performers.join(", ")} />
            <div>
              {scene.date && TextUtils.formatFuzzyDate(intl, scene.date)}
            </div>
          </Link>
        </footer>
      </div>
    </div>
  );
};

function getDimensions(s: GQL.SlimSceneDataFragment) {
  const defaults = { width: 1280, height: 720 };

  if (!s.files.length) return defaults;

  return {
    width: s.files[0].width || defaults.width,
    height: s.files[0].height || defaults.height,
  };
}

interface ISceneWallProps {
  scenes: GQL.SlimSceneDataFragment[];
  sceneQueue?: SceneQueue;
  zoomIndex: number;
}

// HACK: typescript doesn't allow Gallery to accept a parameter for some reason
const SceneGallery = Gallery as unknown as GalleryI<IScenePhoto>;



const SceneWall: React.FC<ISceneWallProps> = ({
  scenes,
  sceneQueue,
  zoomIndex,
}) => {
  const history = useHistory();

  const containerRef = React.useRef<HTMLDivElement>(null);

  const margin = 3;
  const direction = "row";

  const [erroredImgs, setErroredImgs] = useState<string[]>([]);

  const handleError = useCallback((photo: PhotoProps<IScenePhoto>) => {
    setErroredImgs((prev) => [...prev, photo.src]);
  }, []);

  useEffect(() => {
    setErroredImgs([]);
  }, [scenes]);

  const photos: PhotoProps<IScenePhoto>[] = useMemo(() => {
    return scenes.map((s, index) => {
      const { width, height } = getDimensions(s);

      return {
        scene: s,
        src:
          s.paths.preview && !erroredImgs.includes(s.paths.preview)
            ? s.paths.preview!
            : s.paths.screenshot!,
        link: sceneQueue
          ? sceneQueue.makeLink(s.id, { sceneIndex: index })
          : `/scenes/${s.id}`,
        width,
        height,
        tabIndex: index,
        key: s.id,
        loading: "lazy",
        alt: objectTitle(s),
        onError: handleError,
      };
    });
  }, [scenes, sceneQueue, erroredImgs, handleError]);

  const onClick = useCallback(
    (event, { index }) => {
      history.push(photos[index].link);
    },
    [history, photos]
  );



  const targetRowHeight = useCallback(
    (containerWidth: number) => {
      const desiredColumns = Math.max(2, 6 - zoomIndex);
      // specific logic for small screens if needed, otherwise:
      if (containerWidth < 576) {
        // Fallback for mobile, maybe just 1 or 2 columns?
        // Let's stick to the requested logic but ensure reasonable min height.
        // Actually, on mobile 6 columns is tiny.
        // The original logic had breakpoints.
        // If the user wants 6->2, they probably mean on desktop.
        // Let's keep a safeguard or just apply the math.
        // 16:9 aspect ratio assumed (1.777)
        return containerWidth / desiredColumns / 1.777;
      }

      return containerWidth / desiredColumns / 1.777;
    },
    [zoomIndex]
  );

  // set the max height as a factor of the targetRowHeight
  // this allows some images to be taller than the target row height
  // but prevents images from becoming too tall when there is a small number of items
  const maxHeightFactor = 1.3;

  const renderImage = useCallback(
    (props: RenderImageProps<IScenePhoto>) => {
      return (
        <SceneWallItem
          {...props}
          maxHeight={
            targetRowHeight(containerRef.current?.offsetWidth ?? 0) *
            maxHeightFactor
          }
        />
      );
    },
    [targetRowHeight]
  );

  return (
    <div className={`scene-wall`} ref={containerRef}>
      {photos.length ? (
        <SceneGallery
          photos={photos}
          renderImage={renderImage}
          onClick={onClick}
          margin={margin}
          direction={direction}
          targetRowHeight={targetRowHeight}
        />
      ) : null}
    </div>
  );
};

interface ISceneWallPanelProps {
  scenes: GQL.SlimSceneDataFragment[];
  sceneQueue?: SceneQueue;
  zoomIndex: number;
}

export const SceneWallPanel: React.FC<ISceneWallPanelProps> = ({
  scenes,
  sceneQueue,
  zoomIndex,
}) => {
  return (
    <SceneWall scenes={scenes} sceneQueue={sceneQueue} zoomIndex={zoomIndex} />
  );
};
