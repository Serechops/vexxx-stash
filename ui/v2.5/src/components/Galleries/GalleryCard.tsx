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
import { useHistory } from "react-router-dom";
import { PatchComponent } from "src/patch";

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

interface IGalleryCardProps {
  gallery: GQL.SlimGalleryDataFragment;
  cardWidth?: number;
  selecting?: boolean;
  selected?: boolean | undefined;
  zoomIndex?: number;
  onSelectedChanged?: (selected: boolean, shiftKey: boolean) => void;
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

    return (
      <GalleryPreview
        gallery={props.gallery}
        onScrubberClick={(i) => {
          history.push(`/galleries/${props.gallery.id}/images/${i}`);
        }}
      />
    );
  }
);

export const GalleryCard = PatchComponent(
  "GalleryCard",
  (props: IGalleryCardProps) => {
    return (
      <Box
        className="gallery-card"
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
