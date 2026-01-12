import { Button, ButtonGroup, OverlayTrigger, Tooltip } from "react-bootstrap";
import React, { useState } from "react";
import * as GQL from "src/core/generated-graphql";
import { GridCard } from "../Shared/GridCard/GridCard";
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
    <div
      className={cx("gallery-card-cover")}
      style={aspectRatio ? { aspectRatio: `${aspectRatio}` } : undefined}
    >
      {!!imgSrc && (
        <img
          loading="lazy"
          className="gallery-card-image"
          alt={gallery.title ?? ""}
          src={imgSrc}
          onLoad={handleImageLoad}
          style={aspectRatio ? { position: "absolute", width: "100%", height: "100%", top: 0, left: 0 } : undefined}
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
    </div>
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
      <div className="absolute inset-0 flex flex-col justify-between p-2 pointer-events-none">
        {/* Top Section: Rating & Studio */}
        <div className="flex justify-between items-start pointer-events-auto">
          <div className="flex gap-1">
            <RatingBanner rating={props.gallery.rating100} />
          </div>
          <StudioOverlay studio={props.gallery.studio} />
        </div>

        {/* Bottom Section: Meta Overlay */}
        <div className="mt-auto pointer-events-auto relative">
          {/* Gradient Background */}
          <div className="absolute inset-x-[-8px] bottom-[-8px] pt-20 bg-gradient-to-t from-black via-black/80 to-transparent -z-10" />

          <div className="flex flex-col gap-0.5 text-white pb-0">
            <div className="font-bold text-md leading-tight truncate drop-shadow-sm">
              {galleryTitle(props.gallery)}
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-300 font-medium">
              <span>{props.gallery.date}</span>
              {props.gallery.image_count > 0 && (
                <>
                  <span className="w-1 h-1 bg-gray-500 rounded-full" />
                  <span>{props.gallery.image_count} images</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
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
      <GridCard
        className={cx(
          `gallery-card group zoom-${props.zoomIndex} [&_.card-section]:hidden !rounded-xl overflow-hidden shadow-md hover:shadow-xl !border-none !bg-gray-900 !p-0 hover:!scale-100 !transition-none`,
          orientationClass
        )}
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
    );
  }
);
