import React, { useMemo, useState } from "react";
import { Box, Checkbox as MuiCheckbox } from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import NavUtils from "src/utils/navigation";
import TextUtils from "src/utils/text";
import { useConfigurationContext } from "src/hooks/Config";
import { markerTitle } from "src/core/markers";
import { Link } from "react-router-dom";
import { objectTitle } from "src/core/files";
import { PatchComponent } from "src/patch";
import { HoverVideoPreview } from "./HoverVideoPreview";
import cx from "classnames";

interface ISceneMarkerCardProps {
  marker: GQL.SceneMarkerDataFragment;
  cardWidth?: number;
  previewHeight?: number;
  index?: number;
  compact?: boolean;
  selecting?: boolean;
  selected?: boolean | undefined;
  zoomIndex?: number;
  onSelectedChanged?: (selected: boolean, shiftKey: boolean) => void;
}

export const SceneMarkerCard = PatchComponent(
  "SceneMarkerCard",
  (props: ISceneMarkerCardProps) => {
    const { marker } = props;
    const { configuration } = useConfigurationContext();
    const [isHovered, setIsHovered] = useState(false);

    const file = useMemo(
      () => (marker.scene.files.length > 0 ? marker.scene.files[0] : undefined),
      [marker.scene]
    );

    const isPortrait = useMemo(() => {
      const w = file?.width ?? 0;
      const h = file?.height ?? 0;
      return h > w;
    }, [file]);

    const title = markerTitle({ ...marker, primary_tag: marker.primary_tag ?? null });
    const timestamp = TextUtils.formatTimestampRange(
      marker.seconds,
      marker.end_seconds ?? undefined
    );
    const duration = marker.end_seconds
      ? TextUtils.secondsToTimestamp(marker.end_seconds - marker.seconds)
      : null;

    const allTags = [
      ...(marker.primary_tag ? [marker.primary_tag] : []),
      ...marker.tags,
    ];

    function onSelectChange(e: React.MouseEvent) {
      e.stopPropagation();
      props.onSelectedChanged?.(!props.selected, e.shiftKey);
    }

    const handleCardClick = (e: React.MouseEvent) => {
      if (props.selecting) {
        onSelectChange(e);
        e.preventDefault();
      }
    };

    return (
      <Box
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handleCardClick}
        sx={{
          position: "relative",
          borderRadius: "8px",
          overflow: "hidden",
          backgroundColor: "#000",
          transition: "all 0.3s ease",
          height: "100%",
          width: props.cardWidth ? props.cardWidth : "100%",
          "&:hover": {
            transform: "scale(1.02)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
            zIndex: 20,
            "& .marker-overlay-content": {
              background:
                "linear-gradient(to top, rgba(0,0,0,0.95) 20%, rgba(0,0,0,0.7) 60%, transparent 100%)",
            },
          },
          "&.selected": {
            boxShadow: (theme: any) => `0 0 0 3px ${theme.palette.primary.main}`,
          },
        }}
        className={cx("scene-marker-card", { selected: props.selected })}
      >
        <Link
          to={props.selecting ? "#" : NavUtils.makeSceneMarkerUrl(marker)}
          style={{ textDecoration: "none", color: "inherit" }}
          onClick={(e) => props.selecting && e.preventDefault()}
        >
          {/* Media */}
          <Box
            sx={{
              position: "relative",
              width: "100%",
              aspectRatio: "16/9",
              "& .scene-card-preview-image": {
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transition: "opacity 0.3s",
                "&.hidden": { opacity: 0 },
              },
              "& .scene-card-preview-video": {
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                "&.hidden": { display: "none" },
              },
            }}
          >
            <HoverVideoPreview
              image={marker.screenshot ?? undefined}
              video={marker.stream ?? undefined}
              isHovered={isHovered}
              soundActive={configuration?.interface?.soundOnPreview ?? false}
              isPortrait={isPortrait}
              vrMode={marker.scene.vr_mode}
            />
            {duration && (
              <Box
                sx={{
                  position: "absolute",
                  bottom: "0.5rem",
                  right: "0.5rem",
                  fontSize: "0.75rem",
                  fontWeight: 400,
                  color: "#fff",
                  backgroundColor: "rgba(0,0,0,0.6)",
                  px: 0.5,
                  borderRadius: "2px",
                  zIndex: 5,
                  letterSpacing: "-0.03rem",
                  textShadow: "0 0 3px #000",
                }}
              >
                {duration}
              </Box>
            )}
          </Box>

          {/* Gradient overlay */}
          <Box
            className="marker-overlay-content"
            sx={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              background:
                "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.4) 70%, transparent 100%)",
              padding: "12px",
              color: "#fff",
              transition: "background 0.3s ease",
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
            }}
          >
            {/* Marker title + timestamp */}
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                mb: "2px",
              }}
            >
              <Box
                sx={{
                  fontSize: "1rem",
                  fontWeight: 700,
                  textShadow: "0 2px 4px rgba(0,0,0,0.8)",
                  lineHeight: 1.2,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  mr: "8px",
                }}
              >
                {title || timestamp}
              </Box>
              {title && (
                <Box
                  sx={{
                    fontSize: "0.8rem",
                    color: "rgba(255,255,255,0.7)",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {timestamp}
                </Box>
              )}
            </Box>

            {/* Scene link */}
            <Box
              sx={{
                fontSize: "0.8rem",
                color: "rgba(255,255,255,0.7)",
                mb: "4px",
                display: "-webkit-box",
                WebkitLineClamp: 1,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <Link
                to={NavUtils.makeSceneMarkersSceneUrl(marker.scene)}
                style={{ color: "rgba(255,255,255,0.7)", textDecoration: "none" }}
                onClick={(e) => e.stopPropagation()}
              >
                {objectTitle(marker.scene)}
              </Link>
            </Box>

            {/* Slide-up on hover: performers + tags */}
            <Box
              className={cx("marker-slide-content", { visible: isHovered })}
              sx={{
                maxHeight: 0,
                overflow: "hidden",
                opacity: 0,
                transition: "all 0.3s ease-in-out",
                "&.visible": {
                  maxHeight: "100px",
                  opacity: 1,
                  mt: "6px",
                },
              }}
            >
              {marker.scene.performers.length > 0 && (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: "4px", mb: "4px" }}>
                  {marker.scene.performers.slice(0, 4).map((p) => (
                    <Box
                      component="span"
                      key={p.id}
                      sx={{
                        background: "rgba(255,255,255,0.2)",
                        backdropFilter: "blur(4px)",
                        padding: "2px 8px 2px 4px",
                        borderRadius: "12px",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        "& img": {
                          width: "16px",
                          height: "16px",
                          borderRadius: "50%",
                          objectFit: "cover",
                        },
                      }}
                    >
                      {p.image_path && <img src={p.image_path} alt="" />}
                      {p.name}
                    </Box>
                  ))}
                </Box>
              )}
              {allTags.length > 0 && (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {allTags.slice(0, 5).map((t) => (
                    <Box
                      component="span"
                      key={t.id}
                      sx={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.6)" }}
                    >
                      #{t.name}
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          </Box>
        </Link>

        {/* Selection checkbox */}
        {props.onSelectedChanged && (
          <Box
            sx={{
              position: "absolute",
              top: "0.5rem",
              left: "0.5rem",
              zIndex: 30,
              opacity: props.selecting || props.selected ? 1 : 0,
              transition: "opacity 0.2s ease",
              ".scene-marker-card:hover &": { opacity: 1 },
            }}
          >
            <MuiCheckbox
              className="card-check mousetrap"
              checked={props.selected ?? false}
              onChange={() => props.onSelectedChanged!(!props.selected, false)}
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => e.stopPropagation()}
              size="small"
              sx={{
                color: "grey.400",
                bgcolor: "rgba(24,24,27,0.8)",
                backdropFilter: "blur(4px)",
                borderRadius: 1,
                p: 0.5,
                "&.Mui-checked": { color: "primary.main" },
                "&:hover": { bgcolor: "rgba(24,24,27,0.95)" },
              }}
            />
          </Box>
        )}
      </Box>
    );
  }
);
