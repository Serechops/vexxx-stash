import React, { useState } from "react";
import * as GQL from "src/core/generated-graphql";
import { GridCard } from "../Shared/GridCard/GridCard";
import { Box, Typography } from "@mui/material";
import { HoverPopover } from "../Shared/HoverPopover";
import { Icon } from "../Shared/Icon";
import { SceneLink, TagLink } from "../Shared/TagLink";
import { TruncatedText } from "../Shared/TruncatedText";
import { PerformerPopoverButton } from "../Shared/PerformerPopoverButton";
import { PopoverCountButton } from "../Shared/PopoverCountButton";
import NavUtils from "src/utils/navigation";
import { RatingBanner } from "../Shared/RatingBanner";
import { faBox, faPlayCircle, faTag } from "@fortawesome/free-solid-svg-icons";
import { galleryTitle } from "src/core/galleries";
import { StudioOverlay } from "../Shared/GridCard/StudioOverlay";
import { GalleryPreviewScrubber } from "./GalleryPreviewScrubber";
import cx from "classnames";
import { useHistory } from "react-router-dom";
import { PatchComponent } from "src/patch";

interface IGalleryPreviewProps {
  gallery: GQL.SlimGalleryDataFragment;
  onScrubberClick?: (index: number) => void;
  onOrientationDetected?: (isLandscape: boolean) => void;
}

export const GalleryPreview: React.FC<IGalleryPreviewProps> = ({
  gallery,
  onScrubberClick,
  onOrientationDetected,
}) => {
  const [imgSrc, setImgSrc] = useState<string | undefined>(
    gallery.paths.cover ?? undefined
  );
  const [aspectRatio, setAspectRatio] = useState<number | undefined>(undefined);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;

    // Set aspect ratio from the cover image (or first loaded image if ratio is unset)
    if (!aspectRatio && img.naturalWidth && img.naturalHeight) {
      setAspectRatio(img.naturalWidth / img.naturalHeight);
    }

    if (onOrientationDetected && img.naturalWidth && img.naturalHeight) {
      onOrientationDetected(img.naturalWidth > img.naturalHeight);
    }
  };

  return (
    <Box
      className="gallery-card-cover"
      sx={{
        position: "relative",
        overflow: "hidden",
        width: "100%",
        height: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        ...(aspectRatio ? { aspectRatio: `${aspectRatio}` } : {})
      }}
    >
      {!!imgSrc && (
        <Box
          component="img"
          loading="lazy"
          className="gallery-card-image"
          alt={gallery.title ?? ""}
          src={imgSrc}
          onLoad={handleImageLoad}
          sx={{
            height: "100%",
            width: "100%",
            objectFit: "contain",
            objectPosition: "top",
            ...(aspectRatio ? { position: "absolute", top: 0, left: 0 } : {})
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

interface IGalleryCardProps {
  gallery: GQL.SlimGalleryDataFragment;
  cardWidth?: number;
  selecting?: boolean;
  selected?: boolean | undefined;
  zoomIndex?: number;
  onSelectedChanged?: (selected: boolean, shiftKey: boolean) => void;
  onOrientationDetected?: (galleryId: string, isLandscape: boolean) => void;
  isLandscape?: boolean;
  isMasonry?: boolean;
}

const GalleryCardPopovers = PatchComponent(
  "GalleryCard.Popovers",
  (props: IGalleryCardProps) => {
    // Hidden for cleaner aesthetic as per user request
    return null;
  }
);

const GalleryCardDetails = () => null;

const GalleryCardOverlays = PatchComponent(
  "GalleryCard.Overlays",
  (props: IGalleryCardProps) => {
    return (
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "between",
          p: 1,
          pointerEvents: "none",
          zIndex: 1
        }}
      >
        {/* Top Section: Rating & Studio */}
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", pointerEvents: "auto" }}>
          <Box sx={{ display: "flex", gap: 0.5 }}>
            <RatingBanner rating={props.gallery.rating100} />
          </Box>
          <StudioOverlay studio={props.gallery.studio} />
        </Box>

        {/* Bottom Section: Meta Overlay */}
        <Box sx={{ mt: "auto", pointerEvents: "auto", position: "relative" }}>
          {/* Gradient Background */}
          <Box
            sx={{
              position: "absolute",
              insetX: "-8px",
              bottom: "-8px",
              pt: 10,
              backgroundImage: "linear-gradient(to top, rgba(0,0,0,1), rgba(0,0,0,0.8) 40%, transparent)",
              zIndex: -1,
              left: "-8px",
              right: "-8px"
            }}
          />

          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, color: "#fff" }}>
            <Typography
              variant="subtitle1"
              sx={{
                fontWeight: "bold",
                lineHeight: "1.2",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                textShadow: "0 1px 2px rgba(0,0,0,0.5)"
              }}
            >
              {galleryTitle(props.gallery)}
            </Typography>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: "0.75rem", color: "grey.400", fontWeight: "medium" }}>
              <Typography variant="caption" sx={{ color: "inherit" }}>{props.gallery.date}</Typography>
              {props.gallery.image_count > 0 && (
                <>
                  <Box sx={{ width: 4, height: 4, bgcolor: "grey.600", borderRadius: "50%" }} />
                  <Typography variant="caption" sx={{ color: "inherit" }}>{props.gallery.image_count} images</Typography>
                </>
              )}
            </Box>
          </Box>
        </Box>
      </Box>
    );
  }
);

const GalleryCardImage = PatchComponent(
  "GalleryCard.Image",
  (props: IGalleryCardProps) => {
    const history = useHistory();

    const handleOrientationDetected = (isLandscape: boolean) => {
      if (props.onOrientationDetected) {
        props.onOrientationDetected(props.gallery.id, isLandscape);
      }
    };

    return (
      <GalleryPreview
        gallery={props.gallery}
        onScrubberClick={(i) => {
          history.push(`/galleries/${props.gallery.id}/images/${i}`);
        }}
        onOrientationDetected={handleOrientationDetected}
      />
    );
  }
);

export const GalleryCard = PatchComponent(
  "GalleryCard",
  (props: IGalleryCardProps) => {
    const orientationClass = props.isLandscape === true
      ? "gallery-card-landscape"
      : props.isLandscape === false
        ? "gallery-card-portrait"
        : "";

    return (
      <Box
        className={cx(
          "gallery-card",
          orientationClass
        )}
        sx={{
          "& .card-section": { display: "none" },
          borderRadius: "12px",
          overflow: "hidden",
          boxShadow: 1,
          "&:hover": {
            boxShadow: 3
          },
          border: "none",
          bgcolor: "grey.900",
          p: 0,
          transition: "none",
          "&.gallery-card-landscape": {
            gridColumn: { md: "span 2" }
          },
          "&.gallery-card-portrait": {
            gridColumn: "span 1"
          }
        }}
      >
        <GridCard
          url={`/galleries/${props.gallery.id}`}
          width={props.cardWidth}
          title={undefined}
          image={<GalleryCardImage {...props} />}
          overlays={<GalleryCardOverlays {...props} />}
          details={undefined}
          popovers={undefined}
          selected={props.selected}
          selecting={props.selecting}
          onSelectedChanged={props.onSelectedChanged}
          thumbnailSectionClassName="h-full w-full relative !p-0 !m-0"
        />
      </Box>
    );
  }
);
