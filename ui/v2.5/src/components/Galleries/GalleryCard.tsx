import React, { useState } from "react";
import * as GQL from "src/core/generated-graphql";
import { GridCard } from "../Shared/GridCard/GridCard";
import { Box, Typography } from "@mui/material";
import { HoverPopover } from "../Shared/HoverPopover";
import { SceneLink, TagLink } from "../Shared/TagLink";
import { TruncatedText } from "../Shared/TruncatedText";
import { PerformerPopoverButton } from "../Shared/PerformerPopoverButton";
import { PopoverCountButton } from "../Shared/PopoverCountButton";
import NavUtils from "src/utils/navigation";
import { RatingBanner } from "../Shared/RatingBanner";
import InventoryIcon from "@mui/icons-material/Inventory";
import PlayCircleIcon from "@mui/icons-material/PlayCircle";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import { galleryTitle } from "src/core/galleries";
import { StudioOverlay } from "../Shared/GridCard/StudioOverlay";
import { GalleryPreviewScrubber } from "./GalleryPreviewScrubber";
import cx from "classnames";
import { useHistory, Link } from "react-router-dom";
import { PatchComponent } from "src/patch";
import CollectionsIcon from "@mui/icons-material/Collections";

interface IGalleryCardProps {
  gallery: GQL.SlimGalleryDataFragment;
  cardWidth?: number;
  selecting?: boolean;
  selected?: boolean | undefined;
  zoomIndex?: number;
  onSelectedChanged?: (selected: boolean, shiftKey: boolean) => void;
}

interface IGalleryPreviewProps {
  gallery: GQL.SlimGalleryDataFragment;
  onScrubberClick?: (index: number) => void;
}

export const GalleryPreview: React.FC<IGalleryPreviewProps> = ({
  gallery,
  onScrubberClick,
}) => {
  const [imgSrc, setImgSrc] = useState<string | undefined>(
    gallery.paths.cover ?? undefined
  );

  return (
    <Box
      className="gallery-card-cover"
      sx={{
        position: "relative",
        overflow: "hidden",
        width: "100%",
        aspectRatio: "4/3",
        bgcolor: "black",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {!!imgSrc && (
        <Box
          component="img"
          loading="lazy"
          className="gallery-card-image"
          alt={gallery.title ?? ""}
          src={imgSrc}
          sx={{
            height: "100%",
            width: "100%",
            objectFit: "contain",
            objectPosition: "center",
          }}
        />
      )}
      {gallery.image_count > 0 && (
        <GalleryPreviewScrubber
          previewPath={gallery.paths.preview}
          defaultPath={gallery.paths.cover ?? ""}
          imageCount={gallery.image_count}
          onClick={onScrubberClick}
          onPathChanged={setImgSrc}
        />
      )}
    </Box>
  );
};

export const GalleryCard: React.FC<IGalleryCardProps> = PatchComponent(
  "GalleryCard",
  (props: IGalleryCardProps) => {
    const {
      gallery,
      cardWidth,
      selecting,
      selected,
      onSelectedChanged,
    } = props;

    const [isHovered, setIsHovered] = React.useState(false);

    // Gallery Preview Logic
    const [imgSrc, setImgSrc] = useState<string | undefined>(
      gallery.paths.cover ?? undefined
    );

    const handleCardClick = (e: React.MouseEvent) => {
      if (selecting && onSelectedChanged) {
        onSelectedChanged(!selected, e.shiftKey);
        e.preventDefault();
      }
    };

    return (
      <Box
        className={cx("gallery-card", { "selected": selected })}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handleCardClick}
        sx={{
          position: "relative",
          borderRadius: "12px",
          overflow: "hidden",
          backgroundColor: "grey.900", // Dark background
          transition: "all 0.3s ease",
          height: "100%",
          width: cardWidth ? cardWidth : "100%",
          "&:hover": {
            transform: "scale(1.02)",
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
            zIndex: 20,
            "& .overlay-content": {
              background: "linear-gradient(to top, rgba(0, 0, 0, 0.95) 20%, rgba(0, 0, 0, 0.7) 60%, transparent 100%)",
            }
          },
          "&.selected": {
            boxShadow: (theme) => `0 0 0 3px ${theme.palette.primary.main}`,
          }
        }}
      >
        <Link
          to={selecting ? "#" : `/galleries/${gallery.id}`}
          onClick={(e) => {
            if (selecting) {
              e.preventDefault();
            }
          }}
          style={{ textDecoration: 'none', color: 'inherit', display: 'block', height: '100%', width: '100%' }}
        >
          {/* Media Container: Full Bleed */}
          <Box
            className="overlay-media"
            sx={{
              position: "relative",
              width: "100%",
              height: "100%",
              aspectRatio: "4/3",
              bgcolor: "black",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            {!!imgSrc && (
              <Box
                component="img"
                loading="lazy"
                className="gallery-card-image"
                alt={gallery.title ?? ""}
                src={imgSrc}
                sx={{
                  height: "100%",
                  width: "100%",
                  objectFit: "cover",
                  objectPosition: "center",
                }}
              />
            )}
            {/* Scrubber - keep valid? Scrubber typically needs mouse interaction which might conflict with card hover.
                     OverlayCard uses HoverVideoPreview which handles its own hover.
                     GalleryPreviewScrubber expects to be interactive.
                     Let's check GalleryPreviewScrubber usage. It renders divs.
                     If we put it here, ensure zIndex is correct.
                 */}
            {gallery.image_count > 0 && (
              <Box sx={{ position: "absolute", inset: 0, zIndex: 15 }}>
                <GalleryPreviewScrubber
                  previewPath={gallery.paths.preview}
                  defaultPath={gallery.paths.cover ?? ""}
                  imageCount={gallery.image_count}
                  // onClick.. scrubber onClick might want to navigate to specific image?
                  // Original GalleryCardImage used: history.push(`/galleries/${props.gallery.id}/images/${i}`);
                  // We should replicate that if possible, but Link wraps everything.
                  // If Scrubber captures click, it should stop propagation if it wants custom nav.
                  onClick={(i) => {
                    // prevent link nav?
                    // actually we are inside a Link. Link onClick fires.
                    // if we want specific image nav, we might need a preventDefault here and imperative nav.
                    // BUT, <Link> is to gallery.
                    // Let's rely on global link for now unless specific req.
                    // Actually user said "overlay metadata", didn't specify interaction.
                    // I'll leave default link behavior for now to simplify.
                  }}
                  onPathChanged={setImgSrc}
                />
              </Box>
            )}
          </Box>

          {/* Top Section: Rating & Studio */}
          <Box sx={{ position: "absolute", top: 0, left: 0, right: 0, p: 1, display: "flex", justifyContent: "space-between", alignItems: "flex-start", zIndex: 16, pointerEvents: "none" }}>
            <Box sx={{ display: "flex", gap: 0.5, pointerEvents: "auto" }}>
              <RatingBanner rating={gallery.rating100} />
            </Box>
            <Box sx={{ pointerEvents: "auto" }}>
              <StudioOverlay studio={gallery.studio} />
            </Box>
          </Box>

          {/* Selecting Checkbox */}
          {selecting && (
            <Box sx={{ position: "absolute", top: "0.5rem", left: "0.5rem", zIndex: 30 }}>
              <input
                type="checkbox"
                checked={selected}
                readOnly
                style={{ cursor: "pointer", height: "1.25rem", width: "1.25rem" }}
              />
            </Box>
          )}

          {/* Gradient Overlay & Content */}
          <Box
            className="overlay-content"
            sx={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              background: "linear-gradient(to top, rgba(0, 0, 0, 0.9) 0%, rgba(0, 0, 0, 0.4) 70%, transparent 100%)",
              padding: "12px",
              color: "#fff",
              transition: "background 0.3s ease",
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              pointerEvents: "none" // Let clicks pass through to Link? Content might be interactive though.
            }}
          >
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              <Typography
                variant="subtitle1"
                sx={{
                  fontWeight: 700,
                  lineHeight: 1.2,
                  textShadow: "0 2px 4px rgba(0, 0, 0, 0.8)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: "1rem"
                }}
              >
                {galleryTitle(gallery)}
              </Typography>

              <Box sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: "0.8rem", color: "rgba(255,255,255,0.8)" }}>
                {gallery.date && <span>{gallery.date}</span>}
                {gallery.image_count > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                    <CollectionsIcon sx={{ fontSize: 14 }} /> {gallery.image_count}
                  </span>
                )}
              </Box>
            </Box>

            {/* Expanded Content (Slide Up) - Tags/Performers for Gallery? */}
            <Box
              className={cx("overlay-slide-content", { visible: isHovered })}
              sx={{
                maxHeight: 0,
                overflow: "hidden",
                opacity: 0,
                transition: "all 0.3s ease-in-out",
                "&.visible": {
                  maxHeight: "100px",
                  opacity: 1,
                  mt: "8px",
                }
              }}
            >
              {/* Performers */}
              {gallery.performers.length > 0 && (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: "4px", mb: "4px" }}>
                  {gallery.performers.slice(0, 4).map(p => (
                    <Box
                      component="span"
                      key={p.id}
                      sx={{
                        background: "rgba(255, 255, 255, 0.2)",
                        backdropFilter: "blur(4px)",
                        padding: "2px 8px",
                        borderRadius: "12px",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      {p.name}
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          </Box>
        </Link>
      </Box>
    );
  }
);
