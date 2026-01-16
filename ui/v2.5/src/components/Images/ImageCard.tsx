import React, { MouseEvent, useMemo } from "react";
import { Button, ButtonGroup, Box, Typography } from "@mui/material";
import cx from "classnames";
import * as GQL from "src/core/generated-graphql";
import { GalleryLink, TagLink } from "src/components/Shared/TagLink";
import { HoverPopover } from "src/components/Shared/HoverPopover";
import { PerformerPopoverButton } from "src/components/Shared/PerformerPopoverButton";
import { GridCard } from "src/components/Shared/GridCard/GridCard";
import { RatingBanner } from "src/components/Shared/RatingBanner";
import InventoryIcon from "@mui/icons-material/Inventory";
import CollectionsIcon from "@mui/icons-material/Collections";
import SearchIcon from "@mui/icons-material/Search";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import { imageTitle } from "src/core/files";
import { PatchComponent } from "src/patch";
import { TruncatedText } from "../Shared/TruncatedText";
import { StudioOverlay } from "../Shared/GridCard/StudioOverlay";
import { OCounterButton } from "../Shared/CountButton";

interface IImageCardProps {
  image: GQL.SlimImageDataFragment;
  cardWidth?: number;
  selecting?: boolean;
  selected?: boolean | undefined;
  zoomIndex: number;
  onSelectedChanged?: (selected: boolean, shiftKey: boolean) => void;
  onPreview?: (ev: MouseEvent) => void;
  onOrientationDetected?: (imageId: string, isLandscape: boolean) => void;
  isLandscape?: boolean;
}

export const ImageCard: React.FC<IImageCardProps> = PatchComponent(
  "ImageCard",
  (props: IImageCardProps) => {
    const file = useMemo(
      () =>
        props.image.visual_files.length > 0
          ? props.image.visual_files[0]
          : undefined,
      [props.image]
    );

    // Determine orientation and notify parent
    const isLandscape = useMemo(() => {
      const width = file?.width ? file.width : 0;
      const height = file?.height ? file.height : 0;
      return width > height;
    }, [file]);

    // Notify parent of orientation on mount/change
    React.useEffect(() => {
      if (props.onOrientationDetected) {
        props.onOrientationDetected(props.image.id, isLandscape);
      }
    }, [props.image.id, isLandscape, props.onOrientationDetected]);

    function maybeRenderTagPopoverButton() {
      if (props.image.tags.length <= 0) return;

      const popoverContent = props.image.tags.map((tag) => (
        <TagLink key={tag.id} tag={tag} linkType="image" />
      ));

      return (
        <HoverPopover
          className="tag-count"
          placement="bottom"
          content={popoverContent}
        >
          <Button className="minimal">
            <LocalOfferIcon fontSize="small" />
            <span>{props.image.tags.length}</span>
          </Button>
        </HoverPopover>
      );
    }

    function maybeRenderPerformerPopoverButton() {
      if (props.image.performers.length <= 0) return;

      return (
        <PerformerPopoverButton
          performers={props.image.performers}
          linkType="image"
        />
      );
    }

    function maybeRenderOCounter() {
      if (props.image.o_counter) {
        return <OCounterButton value={props.image.o_counter} />;
      }
    }

    function maybeRenderGallery() {
      if (props.image.galleries.length <= 0) return;

      const popoverContent = props.image.galleries.map((gallery) => (
        <GalleryLink key={gallery.id} gallery={gallery} />
      ));

      return (
        <HoverPopover
          className="gallery-count"
          placement="bottom"
          content={popoverContent}
        >
          <Button className="minimal">
            <CollectionsIcon fontSize="small" />
            <span>{props.image.galleries.length}</span>
          </Button>
        </HoverPopover>
      );
    }

    function maybeRenderOrganized() {
      if (props.image.organized) {
        return (
          <div className="organized">
            <Button className="minimal">
              <InventoryIcon fontSize="small" />
            </Button>
          </div>
        );
      }
    }

    function maybeRenderPopoverButtonGroup() {
      if (
        props.image.tags.length > 0 ||
        props.image.performers.length > 0 ||
        props.image.o_counter ||
        props.image.galleries.length > 0 ||
        props.image.organized
      ) {
        return (
          <>
            <hr />
            <ButtonGroup className="card-popovers">
              {maybeRenderTagPopoverButton()}
              {maybeRenderPerformerPopoverButton()}
              {maybeRenderOCounter()}
              {maybeRenderGallery()}
              {maybeRenderOrganized()}
            </ButtonGroup>
          </>
        );
      }
    }

    const isPortrait = useMemo(() => !isLandscape, [isLandscape]);

    const orientationClass = props.isLandscape === true
      ? "image-card-landscape"
      : props.isLandscape === false
        ? "image-card-portrait"
        : "";

    const source =
      props.image.paths.preview != ""
        ? props.image.paths.preview ?? ""
        : props.image.paths.thumbnail ?? "";
    const video = source.includes("preview");
    const ImagePreview = video ? "video" : "img";

    return (
      <Box
        className={cx(
          "image-card",
          orientationClass
        )}
        sx={{
          "& .card-section": { display: "none" },
          "&:hover .preview-button": {
            opacity: 1,
          },
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
          "&.image-card-landscape": {
            gridColumn: { md: "span 2" }
          },
          "&.image-card-portrait": {
            gridColumn: "span 1"
          }
        }}
      >
        <GridCard
          url={`/images/${props.image.id}`}
          width={props.cardWidth}
          title={undefined}
          linkClassName="image-card-link"
          image={
            <Box
              className={cx("image-card-preview w-full", { portrait: isPortrait })}
              sx={{
                display: "flex",
                justifyContent: "center",
                mb: "5px",
                position: "relative",
                width: "100%"
              }}
            >
              <Box
                component={ImagePreview}
                {...(video ? { loop: true, autoPlay: true, playsInline: true } : {})}
                className="image-card-preview-image"
                alt={props.image.title ?? ""}
                src={source}
                sx={{
                  height: "100%",
                  objectFit: "contain",
                  objectPosition: "top",
                  width: "100%",
                  display: "block"
                }}
              />
              {props.onPreview ? (
                <Box
                  className="preview-button"
                  sx={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    zIndex: 2,
                    opacity: 0,
                    transition: "opacity 0.2s ease-in-out",
                  }}
                >
                  <Button
                    onClick={props.onPreview}
                    size="small"
                    sx={{
                      minWidth: "auto",
                      p: 1,
                      bgcolor: "rgba(0,0,0,0)",
                      color: "white",
                      "&:hover": {
                        bgcolor: "rgba(0,0,0,0)",
                      },
                    }}
                  >
                    <SearchIcon />
                  </Button>
                </Box>
              ) : undefined}

            </Box>
          }
          details={undefined}
          overlays={
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
              {/* Top Section */}
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", pointerEvents: "auto" }}>
                <Box sx={{ display: "flex", gap: 0.5 }}>
                  <RatingBanner rating={props.image.rating100} />
                </Box>
                <StudioOverlay studio={props.image.studio} />
              </Box>

              {/* Bottom Section */}
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
                    {imageTitle(props.image)}
                  </Typography>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: "0.75rem", color: "grey.400", fontWeight: "medium" }}>
                    <Typography variant="caption" sx={{ color: "inherit" }}>{props.image.date}</Typography>
                  </Box>
                </Box>
              </Box>
            </Box>
          }
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
