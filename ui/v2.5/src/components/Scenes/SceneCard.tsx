import React, { useEffect, useMemo, useRef } from "react";
import { Button, ButtonGroup, OverlayTrigger, Tooltip } from "react-bootstrap";
import { useHistory } from "react-router-dom";
import cx from "classnames";
import * as GQL from "src/core/generated-graphql";
import { Icon } from "../Shared/Icon";
import { GalleryLink, TagLink, SceneMarkerLink } from "../Shared/TagLink";
import { HoverPopover } from "../Shared/HoverPopover";
import { TruncatedText } from "../Shared/TruncatedText";
import NavUtils from "src/utils/navigation";
import TextUtils from "src/utils/text";
import { SceneQueue } from "src/models/sceneQueue";
import { useConfigurationContext } from "src/hooks/Config";
import { PerformerPopoverButton } from "../Shared/PerformerPopoverButton";
import { GridCard } from "../Shared/GridCard/GridCard";
import { RatingBanner } from "../Shared/RatingBanner";
import { FormattedMessage } from "react-intl";
import {
  faBox,
  faCopy,
  faFilm,
  faImages,
  faInfoCircle,
  faMapMarkerAlt,
  faTag,
} from "@fortawesome/free-solid-svg-icons";
import { objectPath, objectTitle } from "src/core/files";
import { PreviewScrubber } from "./PreviewScrubber";
import { PatchComponent } from "src/patch";
import { StudioOverlay } from "../Shared/GridCard/StudioOverlay";
import { GroupTag } from "../Groups/GroupTag";
import { FileSize } from "../Shared/FileSize";
import { OCounterButton } from "../Shared/CountButton";

interface IScenePreviewProps {
  isPortrait: boolean;
  image?: string;
  video?: string;
  soundActive: boolean;
  vttPath?: string;
  onScrubberClick?: (timestamp: number) => void;
}

export const ScenePreview: React.FC<IScenePreviewProps> = ({
  image,
  video,
  isPortrait,
  soundActive,
  vttPath,
  onScrubberClick,
}) => {
  const videoEl = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.intersectionRatio > 0)
          // Catch is necessary due to DOMException if user hovers before clicking on page
          videoEl.current?.play()?.catch(() => { });
        else videoEl.current?.pause();
      });
    });

    if (videoEl.current) observer.observe(videoEl.current);
  });

  useEffect(() => {
    if (videoEl?.current?.volume)
      videoEl.current.volume = soundActive ? 0.05 : 0;
  }, [soundActive]);

  return (
    <div className={cx("scene-card-preview", { portrait: isPortrait })}>
      <img
        className="scene-card-preview-image"
        loading="lazy"
        src={image}
        alt=""
      />
      <video
        disableRemotePlayback
        playsInline
        muted={!soundActive}
        className="scene-card-preview-video"
        loop
        preload="none"
        ref={videoEl}
        src={video}
      />
      <PreviewScrubber vttPath={vttPath} onClick={onScrubberClick} />
    </div>
  );
};

interface ISceneCardProps {
  scene: GQL.SlimSceneDataFragment;
  width?: number;
  previewHeight?: number;
  index?: number;
  queue?: SceneQueue;
  compact?: boolean;
  selecting?: boolean;
  selected?: boolean | undefined;
  zoomIndex?: number;
  onSelectedChanged?: (selected: boolean, shiftKey: boolean) => void;
  fromGroupId?: string;
}





const SceneCardImage = PatchComponent(
  "SceneCard.Image",
  (props: ISceneCardProps) => {
    const history = useHistory();
    const { configuration } = useConfigurationContext();
    const cont = configuration?.interface.continuePlaylistDefault ?? false;

    const file = useMemo(
      () => (props.scene.files.length > 0 ? props.scene.files[0] : undefined),
      [props.scene]
    );



    function maybeRenderInteractiveSpeedOverlay() {
      return (
        <div className="scene-interactive-speed-overlay">
          {props.scene.interactive_speed ?? ""}
        </div>
      );
    }

    function onScrubberClick(timestamp: number) {
      const link = props.queue
        ? props.queue.makeLink(props.scene.id, {
          sceneIndex: props.index,
          continue: cont,
          start: timestamp,
        })
        : `/scenes/${props.scene.id}?t=${timestamp}`;

      history.push(link);
    }

    function isPortrait() {
      const width = file?.width ? file.width : 0;
      const height = file?.height ? file.height : 0;
      return height > width;
    }

    return (
      <>
        <ScenePreview
          image={props.scene.paths.screenshot ?? undefined}
          video={props.scene.paths.preview ?? undefined}
          isPortrait={isPortrait()}
          soundActive={configuration?.interface?.soundOnPreview ?? false}
          vttPath={props.scene.paths.vtt ?? undefined}
          onScrubberClick={onScrubberClick}
        />
        {maybeRenderInteractiveSpeedOverlay()}
      </>
    );
  }
);

// Reimplement SceneCard with new logic
// Keeping imports that are still needed

// Reimplement SceneCard with new polish logic

export const SceneCard = PatchComponent(
  "SceneCard",
  (props: ISceneCardProps) => {
    const { configuration } = useConfigurationContext();
    const history = useHistory();
    const [isFlipped, setIsFlipped] = React.useState(false);

    const file = useMemo(
      () => (props.scene.files.length > 0 ? props.scene.files[0] : undefined),
      [props.scene]
    );
    const cont = configuration?.interface.continuePlaylistDefault ?? false;

    const sceneLink = props.queue
      ? props.queue.makeLink(props.scene.id, {
        sceneIndex: props.index,
        continue: cont,
      })
      : `/scenes/${props.scene.id}`;

    // Helper for quick duration formatting
    const duration = file?.duration ? TextUtils.secondsToTimestamp(file.duration) : null;
    const resolution = file?.width && file?.height ? TextUtils.resolution(file.width, file.height) : null;

    return (
      <div className="scene-card-flip-container group perspective-1000 relative h-full w-full">
        <div
          className={cx(
            "scene-card-inner relative w-full h-full transition-transform duration-500 transform-style-3d bg-card rounded-lg shadow-sm border-none",
            isFlipped ? "rotate-y-180" : ""
          )}
        >
          {/* FRONT FACE */}
          <div className="scene-card-front relative w-full h-full backface-hidden top-0 left-0">
            <GridCard
              className={cx(
                "scene-card h-full !bg-card rounded-lg overflow-hidden",
                // Removed hover styling from GridCard itself to rely on container or just keeping it simple
                props.selected ? "ring-2 ring-primary" : ""
              )}
              url={sceneLink}
              title={null}
              width={props.width}
              linkClassName="block relative aspect-video"
              thumbnailSectionClassName="w-full h-full"
              image={<SceneCardImage {...props} />}
              overlays={
                <>
                  {/* Info Button for Flip - Top Right */}
                  <div className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="p-1.5 rounded-full bg-black/60 hover:bg-black/80 text-white backdrop-blur-sm transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setIsFlipped(true);
                      }}
                      title="View Details"
                    >
                      <Icon icon={faInfoCircle} className="h-4 w-4" />
                      <span className="sr-only">Info</span>
                    </button>
                  </div>
                </>
              }
              details={
                <div className="p-4 space-y-3 !bg-card h-full flex flex-col text-card-foreground">
                  {/* Header: Studio Logo, Date, and Badges Row */}
                  <div className="flex justify-between items-center text-xs text-muted-foreground font-medium h-8">
                    {/* Studio Logo (Left) */}
                    <div className="flex items-center gap-2">
                      {props.scene.studio?.image_path ? (
                        <div
                          className="cursor-pointer opacity-80 hover:opacity-100 hover:scale-105 transition-all"
                          title={props.scene.studio.name ?? "Studio"}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            history.push(`/studios/${props.scene.studio?.id}`);
                          }}
                        >
                          <img src={props.scene.studio.image_path} alt="Studio" className="h-6 w-auto object-contain" />
                        </div>
                      ) : (
                        props.scene.studio && <span className="truncate">{props.scene.studio.name}</span>
                      )}
                      {/* Fallback Date if no studio or next to it */}
                      {!props.scene.studio?.image_path && <span>{props.scene.date}</span>}
                    </div>

                    {/* Specs Badges (Right) */}
                    <div className="flex gap-1.5">
                      {resolution && <span className="px-1.5 py-0.5 text-[10px] font-bold bg-secondary/50 border border-border/50 rounded">{resolution}</span>}
                      {duration && <span className="px-1.5 py-0.5 text-[10px] font-bold bg-secondary/50 border border-border/50 rounded">{duration}</span>}
                    </div>
                  </div>

                  {/* Title */}
                  <div className="font-semibold text-base line-clamp-2 leading-tight text-foreground group-hover:text-primary transition-colors">
                    {objectTitle(props.scene)}
                  </div>

                  {/* Date if Studio Image present (Secondary meta row) */}
                  {props.scene.studio?.image_path && (
                    <div className="text-xs text-muted-foreground font-medium">
                      {props.scene.date}
                    </div>
                  )}

                  {/* Rating Only (Performers moved to back) */}
                  <div className="flex justify-end items-end pt-2">
                    {props.scene.rating100 !== null && props.scene.rating100 !== undefined && (
                      <div className="flex items-center gap-1 text-sm font-bold text-yellow-500 mb-2">
                        <span>★</span>
                        <span>{Math.round(props.scene.rating100 / 20 * 10) / 10}</span>
                      </div>
                    )}
                  </div>

                  {/* Tags REMOVED from front face */}
                </div>
              }
              selected={props.selected}
              selecting={props.selecting}
              onSelectedChanged={props.onSelectedChanged}
              // Passthrough props for DnD that GridCard expects
              objectId={props.scene.id}
            />
          </div>

          {/* BACK FACE */}
          <div
            className="scene-card-back absolute w-full h-full backface-hidden rotate-y-180 top-0 left-0 bg-card rounded-lg overflow-hidden border border-border/10 shadow-xl flex flex-col p-4 cursor-default"
            onClick={(e) => {
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
            }}
            onMouseUp={(e) => {
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {/* Back Header: Return Button */}
            <div className="flex justify-between items-start mb-2 flex-shrink-0">
              <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Details</h3>
              <button
                className="p-1.5 rounded-full hover:bg-secondary text-foreground transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setIsFlipped(false);
                }}
                title="Back to Preview"
              >
                <Icon icon={faCopy} className="h-4 w-4 transform rotate-180" />
                <span className="font-bold text-lg leading-none ml-1">✕</span>
              </button>
            </div>

            {/* Description (Fixed/Limited Height) */}
            <div className="mb-3 flex-shrink-0 max-h-[40%] overflow-y-auto scrollbar-thin scrollbar-thumb-secondary scrollbar-track-transparent pr-1 overscroll-contain">
              <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap font-medium">
                {props.scene.details || <span className="text-muted-foreground italic">No description available.</span>}
              </p>
            </div>

            {/* Performers (Moved from Front) */}
            <div className="mb-3 flex-shrink-0">
              <h4 className="w-full text-xs font-bold text-muted-foreground uppercase mb-2">Performers</h4>
              <div className="flex -space-x-3 overflow-hidden pl-1">
                {props.scene.performers.slice(0, 5).map(p => (
                  <div
                    key={p.id}
                    className="inline-block h-12 w-12 rounded-full ring-2 ring-card bg-secondary flex items-center justify-center overflow-hidden shadow-md cursor-pointer hover:scale-110 hover:z-10 transition-transform"
                    title={p.name}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.nativeEvent.stopImmediatePropagation(); // Prevent flip
                      history.push(`/performers/${p.id}`);
                    }}
                  >
                    {p.image_path ? (
                      <img src={p.image_path} alt={p.name} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-xs uppercase font-bold text-muted-foreground">{p.name.charAt(0)}</span>
                    )}
                  </div>
                ))}
                {props.scene.performers.length > 5 && (
                  <div className="flex items-center justify-center h-12 w-12 rounded-full ring-2 ring-card bg-muted text-xs font-bold z-10">
                    +{props.scene.performers.length - 5}
                  </div>
                )}
                {props.scene.performers.length === 0 && <span className="text-sm text-muted-foreground italic">No performers</span>}
              </div>
            </div>

            {/* Tags (Scrollable, takes remaining space) */}
            <div className="flex-grow overflow-y-auto border-t border-border/20 pt-3 scrollbar-thin scrollbar-thumb-secondary scrollbar-track-transparent overscroll-contain">
              <div className="flex flex-wrap gap-1.5 content-start">
                <h4 className="w-full text-xs font-bold text-muted-foreground uppercase mb-1">Tags</h4>
                {props.scene.tags.map(tag => (
                  <span key={tag.id} className="px-2 py-0.5 bg-secondary hover:bg-primary/20 text-secondary-foreground hover:text-primary text-[10px] uppercase font-bold tracking-wide rounded-sm transition-colors cursor-default">
                    {tag.name}
                  </span>
                ))}
                {props.scene.tags.length === 0 && <span className="text-xs text-muted-foreground">No tags</span>}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
);
