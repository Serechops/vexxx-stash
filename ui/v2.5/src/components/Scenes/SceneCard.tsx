import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import { useHistory } from "react-router-dom";
import cx from "classnames";
import * as GQL from "src/core/generated-graphql";
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
import { StashDBCard } from "./StashDBCard";
import { OverlayCard } from "./OverlayCard";
import { useInterfaceLocalForage } from "src/hooks/LocalForage";
import InventoryIcon from "@mui/icons-material/Inventory";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import MovieIcon from "@mui/icons-material/Movie";
import ImageIcon from "@mui/icons-material/Image";
import InfoIcon from "@mui/icons-material/Info";
import PlaceIcon from "@mui/icons-material/Place";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
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
  playOnHover?: boolean;
}

export const ScenePreview: React.FC<IScenePreviewProps> = ({
  image,
  video,
  isPortrait,
  soundActive,
  vttPath,
  onScrubberClick,
  playOnHover = false,
}) => {
  const videoEl = useRef<HTMLVideoElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (playOnHover) return; // Skip IntersectionObserver if using hover
    
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.intersectionRatio > 0)
          // Catch is necessary due to DOMException if user hovers before clicking on page
          videoEl.current?.play()?.catch(() => { });
        else videoEl.current?.pause();
      });
    });

    if (videoEl.current) observer.observe(videoEl.current);
  }, [playOnHover]);

  useEffect(() => {
    if (videoEl?.current?.volume)
      videoEl.current.volume = soundActive ? 0.05 : 0;
  }, [soundActive]);

  useEffect(() => {
    if (!playOnHover) return;
    
    if (isHovered) {
      videoEl.current?.play()?.catch(() => { });
    } else {
      videoEl.current?.pause();
    }
  }, [isHovered, playOnHover]);

  const handleMouseEnter = () => {
    if (playOnHover) setIsHovered(true);
  };

  const handleMouseLeave = () => {
    if (playOnHover) setIsHovered(false);
  };

  return (
    <Box
      sx={{
        aspectRatio: "16/9",
        display: "flex",
        justifyContent: "center",
        mb: "5px",
        position: "relative",
        ...(isPortrait && {
          "& .scene-card-preview-image, & .scene-card-preview-video": {
            objectFit: "contain",
          },
        }),
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Box
        component="img"
        sx={{
          height: "100%",
          objectFit: "cover",
          objectPosition: "top",
          width: "100%",
        }}
        className="scene-card-preview-image"
        loading="lazy"
        src={image}
        alt=""
      />
      <Box
        component="video"
        disableRemotePlayback
        playsInline
        muted={!soundActive}
        sx={{
          height: "100%",
          objectFit: "cover",
          objectPosition: "top",
          width: "100%",
          position: "absolute",
          top: playOnHover ? (isHovered ? 0 : "-9999px") : "-9999px",
          transition: "top 0s",
          transitionDelay: "0s",
          // The hover logic to show video is in styles.scss (top: 0 on hover)
          // For playOnHover mode, we control visibility via state
        }}
        className="scene-card-preview-video"
        loop
        preload="none"
        ref={videoEl}
        src={video}
      />
      <PreviewScrubber vttPath={vttPath} onClick={onScrubberClick} />
    </Box>
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
  // Extensions for non-standard use (e.g. Scraped Cards)
  link?: string;
  extraActions?: React.ReactNode;
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

// Renamed original SceneCard to FlipCard
const FlipCard = PatchComponent(
  "FlipCard",
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
      <Box
        className="scene-card-flip-container group"
        sx={{
          perspective: "1000px",
          position: "relative",
          height: "100%",
          width: "100%",
        }}
      >
        <Box
          className={cx("scene-card-inner", isFlipped ? "flipped" : "")}
          sx={{
            position: "relative",
            width: "100%",
            height: "100%",
            transition: "transform 0.5s",
            transformStyle: "preserve-3d",
            backgroundColor: "background.paper", // $card-bg
            borderRadius: "8px",
            boxShadow: 1,
            border: "none",
            "&.flipped": {
              transform: "rotateY(180deg)",
            }
          }}
        >
          {/* FRONT FACE */}
          <Box
            className="scene-card-front"
            sx={{
              position: "relative",
              width: "100%",
              height: "100%",
              backfaceVisibility: "hidden",
              top: 0,
              left: 0,
            }}
          >
            <Box
              sx={{
                height: "100%",
                backgroundColor: "background.paper",
                borderRadius: "8px",
                overflow: "hidden",
                transition: "none",
                "&.selected": {
                  boxShadow: (theme: any) => `0 0 0 2px ${theme.palette.primary.main}`,
                }
              }}
              className={cx(
                "scene-card",
                "vexxx-scene-card",
                props.selected ? "selected" : ""
              )}
            >
              <GridCard
                url={sceneLink}
                title={null}
                width={props.width}
                linkClassName="block relative aspect-video"
                thumbnailSectionClassName="w-full h-full"
                image={<SceneCardImage {...props} />}
                overlays={
                  <>
                    {props.extraActions && (
                      <Box sx={{ position: "absolute", top: "0.5rem", left: "0.5rem", zIndex: 20 }} onClick={e => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}>
                        {props.extraActions}
                      </Box>
                    )}
                    {/* Info Button for Flip - Top Right */}
                    <Box sx={{ position: "absolute", top: "0.5rem", right: "0.5rem", zIndex: 20, opacity: 0, ".group:hover &": { opacity: 1 }, transition: "opacity 0.2s" }}>
                      <Box
                        component="button"
                        sx={{
                          p: 0.75,
                          borderRadius: "9999px",
                          bgcolor: "rgba(0, 0, 0, 0.6)",
                          color: "#fff",
                          backdropFilter: "blur(4px)",
                          border: "none",
                          cursor: "pointer",
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setIsFlipped(true);
                        }}
                        title="View Details"
                      >
                        <InfoIcon fontSize="small" />
                        <Box component="span" sx={{ position: "absolute", width: "1px", height: "1px", p: 0, m: "-1px", overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>Info</Box>
                      </Box>
                    </Box>
                  </>
                }
                details={
                  <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.5, height: "100%", backgroundColor: "background.paper", color: "text.primary" }}>
                    {/* Header: Studio Logo, Date, and Badges Row */}
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.75rem", color: "text.secondary", fontWeight: 500, height: "2rem" }}>
                      {/* Studio Logo (Left) */}
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        {props.scene.studio?.image_path ? (
                          <Box
                            component="div"
                            title={props.scene.studio.name ?? "Studio"}
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              history.push(`/studios/${props.scene.studio?.id}`);
                            }}
                            sx={{ cursor: "pointer", opacity: 0.8, "&:hover": { opacity: 1 }, transition: "opacity 0.2s" }}
                          >
                            <Box component="img" src={props.scene.studio.image_path} alt="Studio" sx={{ height: "1.5rem", width: "auto", objectFit: "contain" }} />
                          </Box>
                        ) : (
                          props.scene.studio && <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{props.scene.studio.name}</Box>
                        )}
                        {/* Fallback Date if no studio or next to it */}
                        {!props.scene.studio?.image_path && <span>{props.scene.date}</span>}
                      </Box>

                      {/* Specs Badges (Right) */}
                      <Box sx={{ display: "flex", gap: "0.375rem" }}>
                        {resolution && <Box component="span" sx={{ px: "0.375rem", py: "0.125rem", fontSize: "10px", fontWeight: "bold", backgroundColor: "rgba(138, 155, 168, 0.25)", border: "1px solid rgba(138, 155, 168, 0.25)", borderRadius: "4px" }}>{resolution}</Box>}
                        {duration && <Box component="span" sx={{ px: "0.375rem", py: "0.125rem", fontSize: "10px", fontWeight: "bold", backgroundColor: "rgba(138, 155, 168, 0.25)", border: "1px solid rgba(138, 155, 168, 0.25)", borderRadius: "4px" }}>{duration}</Box>}
                      </Box>
                    </Box>

                    {/* Title */}
                    <Box sx={{ fontWeight: 600, fontSize: "1rem", lineHeight: 1.25, color: "text.primary", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", "&:hover": { color: "primary.main" }, transition: "color 0.2s" }}>
                      {objectTitle(props.scene)}
                    </Box>

                    {/* Date if Studio Image present (Secondary meta row) */}
                    {props.scene.studio?.image_path && (
                      <Box sx={{ fontSize: "0.75rem", color: "text.secondary", fontWeight: 500 }}>
                        {props.scene.date}
                      </Box>
                    )}

                    {/* Rating Only (Performers moved to back) */}
                    <Box sx={{ flexGrow: 1, display: "flex", justifyContent: "flex-end", alignItems: "flex-end" }}>
                      {props.scene.rating100 !== null && props.scene.rating100 !== undefined && (
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, fontSize: "0.875rem", fontWeight: "bold", color: "warning.main" }}>
                          <span>★</span>
                          <span>{Math.round(props.scene.rating100 / 20 * 10) / 10}</span>
                        </Box>
                      )}
                    </Box>
                  </Box>
                }
                selected={props.selected}
                selecting={props.selecting}
                onSelectedChanged={props.onSelectedChanged}
                objectId={props.scene.id}
              />
            </Box>
          </Box>

          {/* BACK FACE */}
          <Box
            className="scene-card-back"
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
            sx={{
              position: "absolute",
              width: "100%",
              height: "100%",
              backfaceVisibility: "hidden",
              transform: "rotateY(180deg)",
              top: 0,
              left: 0,
              backgroundColor: "background.paper",
              borderRadius: "8px",
              overflow: "hidden",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              boxShadow: 3,
              display: "flex",
              flexDirection: "column",
              p: 2,
              cursor: "default",
            }}
          >
            {/* Back Header: Return Button */}
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 1, flexShrink: 0 }}>
              <Typography variant="caption" sx={{ fontWeight: "bold", color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.05rem" }}>Details</Typography>
              <Box
                component="button"
                sx={{
                  p: 0.75,
                  borderRadius: "9999px",
                  bgcolor: "transparent",
                  color: "inherit",
                  border: "none",
                  cursor: "pointer",
                  "&:hover": { bgcolor: "action.hover" },
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  e.nativeEvent.stopImmediatePropagation();
                  setIsFlipped(false);
                }}
                title="Back to Preview"
              >
                <ContentCopyIcon fontSize="small" />
                <Box component="span" sx={{ fontWeight: "bold", fontSize: "1.125rem", lineHeight: 1, ml: 0.5 }}>✕</Box>
              </Box>
            </Box>

            {/* Description (Fixed/Limited Height) */}
            <Box sx={{ mb: 1.5, flexShrink: 0, maxHeight: "40%", overflowY: "auto", overscrollBehavior: "contain", pr: 0.5 }}>
              <Typography variant="body2" sx={{ lineHeight: 1.6, whiteSpace: "pre-wrap", fontWeight: 500 }}>
                {props.scene.details || <Box component="span" sx={{ color: "text.secondary", fontStyle: "italic" }}>No description available.</Box>}
              </Typography>
            </Box>

            {/* Performers (Moved from Front) */}
            <Box sx={{ mb: 1.5, flexShrink: 0 }}>
              <Typography variant="caption" sx={{ display: "block", fontWeight: "bold", color: "text.secondary", textTransform: "uppercase", mb: 1 }}>Performers</Typography>
              <Box sx={{ display: "flex", ml: 0.5 }}>
                {props.scene.performers.slice(0, 5).map((p, i) => (
                  <Box
                    key={p.id}
                    title={p.name}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.nativeEvent.stopImmediatePropagation(); // Prevent flip
                      history.push(`/performers/${p.id}`);
                    }}
                    sx={{
                      display: "inline-flex",
                      height: "3.5rem",
                      width: "3.5rem",
                      borderRadius: "50%",
                      border: (theme) => `2px solid ${theme.palette.background.paper}`,
                      backgroundColor: "secondary.main",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                      boxShadow: 2,
                      cursor: "pointer",
                      "&:hover": { transform: "scale(1.1)", zIndex: 10 },
                      transition: "transform 0.2s",
                      ml: i === 0 ? 0 : "-0.75rem"
                    }}
                  >
                    {p.image_path ? (
                      <Box component="img" src={p.image_path} alt={p.name} sx={{ height: "100%", width: "100%", objectFit: "cover" }} />
                    ) : (
                      <Typography variant="caption" sx={{ fontWeight: "bold", color: "text.secondary", textTransform: "uppercase" }}>{p.name.charAt(0)}</Typography>
                    )}
                  </Box>
                ))}
                {props.scene.performers.length > 5 && (
                  <Box sx={{ display: "flex", alignItems: "center", justifyItems: "center", height: "3.5rem", width: "3.5rem", borderRadius: "50%", border: (theme) => `2px solid ${theme.palette.background.paper}`, backgroundColor: "action.selected", fontSize: "0.75rem", fontWeight: "bold", zIndex: 10, ml: "-0.75rem" }}>
                    +{props.scene.performers.length - 5}
                  </Box>
                )}
                {props.scene.performers.length === 0 && <Typography variant="caption" sx={{ color: "text.secondary", fontStyle: "italic" }}>No performers</Typography>}
              </Box>
            </Box>

            {/* Tags (Scrollable, takes remaining space) */}
            <Box sx={{ flexGrow: 1, overflowY: "auto", borderTop: (theme) => `1px solid ${theme.palette.divider}`, pt: 1.5, overscrollBehavior: "contain" }}>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "flex-start" }}>
                <Typography variant="caption" sx={{ width: "100%", fontWeight: "bold", color: "text.secondary", textTransform: "uppercase", mb: 0.5 }}>Tags</Typography>
                {props.scene.tags.map(tag => (
                  <Box key={tag.id} component="span" sx={{ px: 1, py: 0.5, backgroundColor: "secondary.main", "&:hover": { backgroundColor: "rgba(138, 155, 168, 0.2)", color: "primary.main" }, color: "text.primary", fontSize: "10px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.025rem", borderRadius: "2px", transition: "all 0.2s" }}>
                    {tag.name}
                  </Box>
                ))}
                {props.scene.tags.length === 0 && <Typography variant="caption" sx={{ color: "text.secondary" }}>No tags</Typography>}
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>
    );
  }
);

// New SceneCard Factory Component
export const SceneCard = PatchComponent(
  "SceneCard",
  (props: ISceneCardProps) => {
    const [interfaceLocalForage] = useInterfaceLocalForage();

    // cast to any because we haven't added the field to the GQL type yet, 
    // but localForage is loosely typed or we are extending it.
    // Actually useInterfaceLocalForage returns typed data. We might need to extend the type or key access.
    // However, interfaceLocalForage data is any-ish regarding custom fields if not strictly typed in GQL.
    // Let's assume we can access it or use a default.
    // The "sceneCardTheme" is not in GQL, so we rely on localForage behaving or falling back.

    // @ts-ignore
    const theme = interfaceLocalForage.data?.sceneCardTheme || "overlay";

    if (theme === "flip") {
      return <FlipCard {...props} />;
    }

    if (theme === "stashdb") {
      return <StashDBCard {...props} />;
    }

    return <OverlayCard {...props} />;
  }
);

