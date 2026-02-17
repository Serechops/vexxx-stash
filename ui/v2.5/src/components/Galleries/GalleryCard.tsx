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
      sx={{
        alignItems: 'center',
        aspectRatio: '4 / 3',
        bgcolor: 'black',
        display: 'flex',
        height: '100%',
        justifyContent: 'center',
        position: 'relative',
        width: '100%',
      }}
    >
      {!!imgSrc && (
        <Box
          component="img"
          loading="lazy"
          alt={gallery.title ?? ""}
          src={imgSrc}
          sx={{
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center',
            width: '100%',
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
        sx={{
          bgcolor: '#212529',
          borderRadius: '12px',
          height: '100%',
          overflow: 'hidden',
          position: 'relative',
          transition: 'all 0.3s ease',
          width: '100%',
          '&:hover': {
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
            transform: 'scale(1.02)',
            zIndex: 20,
            '& .overlay-content': {
              background: 'linear-gradient(to top, rgba(0, 0, 0, 0.95) 20%, rgba(0, 0, 0, 0.7) 60%, transparent 100%)',
            },
          },
          ...(selected && { boxShadow: '0 0 0 3px #52525b' }),
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handleCardClick}
        style={{ width: cardWidth ? cardWidth : "100%" }}
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
            sx={{
              alignItems: 'center',
              aspectRatio: '4 / 3',
              bgcolor: 'black',
              display: 'flex',
              height: '100%',
              justifyContent: 'center',
              position: 'relative',
              width: '100%',
            }}
          >
            {!!imgSrc && (
              <Box
                component="img"
                loading="lazy"
                alt={gallery.title ?? ""}
                src={imgSrc}
                sx={{
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'center',
                  width: '100%',
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
              <Box sx={{ inset: 0, position: 'absolute', zIndex: 15 }}>
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
          <Box
            sx={{
              alignItems: 'flex-start',
              display: 'flex',
              justifyContent: 'space-between',
              left: 0,
              p: '0.5rem',
              pointerEvents: 'none',
              position: 'absolute',
              right: 0,
              top: 0,
              zIndex: 16,
            }}
          >
            <Box sx={{ display: 'flex', gap: '0.5rem', pointerEvents: 'auto' }}>
              <RatingBanner rating={gallery.rating100} />
            </Box>
            <Box sx={{ display: 'flex', gap: '0.5rem', pointerEvents: 'auto' }}>
              <StudioOverlay studio={gallery.studio} />
            </Box>
          </Box>

          {/* Selecting Checkbox */}
          {(selecting || isHovered) && (
            <Box sx={{ left: '0.5rem', position: 'absolute', top: '0.5rem', zIndex: 30 }}>
              <input
                type="checkbox"
                checked={selected}
                readOnly
                onClick={(e) => {
                  if (onSelectedChanged) {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelectedChanged(!selected, e.shiftKey);
                  }
                }}
                style={{ cursor: "pointer", height: "1.25rem", width: "1.25rem" }}
              />
            </Box>
          )}

          {/* Gradient Overlay & Content */}
          <Box
            className="overlay-content"
            sx={{
              background: 'linear-gradient(to top, rgba(0, 0, 0, 0.9) 0%, rgba(0, 0, 0, 0.4) 70%, transparent 100%)',
              bottom: 0,
              color: '#fff',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              left: 0,
              p: '12px',
              pointerEvents: 'none',
              position: 'absolute',
              right: 0,
              transition: 'background 0.3s ease',
            }}
          >
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              <Typography
                variant="subtitle1"
                sx={{
                  fontSize: '1rem',
                  fontWeight: 700,
                  lineHeight: 1.2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  textShadow: '0 2px 4px rgba(0, 0, 0, 0.8)',
                  whiteSpace: 'nowrap',
                }}
              >
                {galleryTitle(gallery)}
              </Typography>

              <Box
                sx={{
                  alignItems: 'center',
                  color: 'rgba(255, 255, 255, 0.8)',
                  display: 'flex',
                  fontSize: '0.8rem',
                  gap: '0.5rem',
                }}
              >
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
              sx={{
                maxHeight: isHovered ? '100px' : 0,
                opacity: isHovered ? 1 : 0,
                overflow: 'hidden',
                transition: 'all 0.3s ease-in-out',
                ...(isHovered && { mt: '8px' }),
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
                        alignItems: 'center',
                        backdropFilter: 'blur(4px)',
                        background: 'rgba(255, 255, 255, 0.2)',
                        borderRadius: '12px',
                        display: 'flex',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        gap: '4px',
                        p: '2px 8px',
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
