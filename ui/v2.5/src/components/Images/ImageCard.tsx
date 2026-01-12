import React, { MouseEvent, useMemo } from "react";
import { Button, ButtonGroup } from "react-bootstrap";
import cx from "classnames";
import * as GQL from "src/core/generated-graphql";
import { Icon } from "src/components/Shared/Icon";
import { GalleryLink, TagLink } from "src/components/Shared/TagLink";
import { HoverPopover } from "src/components/Shared/HoverPopover";
import { PerformerPopoverButton } from "src/components/Shared/PerformerPopoverButton";
import { GridCard } from "src/components/Shared/GridCard/GridCard";
import { RatingBanner } from "src/components/Shared/RatingBanner";
import {
  faBox,
  faImages,
  faSearch,
  faTag,
} from "@fortawesome/free-solid-svg-icons";
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
            <Icon icon={faTag} />
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
            <Icon icon={faImages} />
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
              <Icon icon={faBox} />
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
      <GridCard
        className={cx(
          `image-card group zoom-${props.zoomIndex} [&_.card-section]:hidden !rounded-xl overflow-hidden shadow-md hover:shadow-xl !border-none !bg-gray-900 !p-0 hover:!scale-100 !transition-none`,
          orientationClass
        )}
        url={`/images/${props.image.id}`}
        width={props.cardWidth}
        title={undefined}
        linkClassName="image-card-link"
        image={
          <>
            <div
              className={cx("image-card-preview w-full", { portrait: isPortrait })}
            >
              <ImagePreview
                loop={video}
                autoPlay={video}
                playsInline={video}
                className="image-card-preview-image object-cover w-full h-auto block"
                alt={props.image.title ?? ""}
                src={source}
              />
              {props.onPreview ? (
                <div className="preview-button">
                  <Button onClick={props.onPreview}>
                    <Icon icon={faSearch} />
                  </Button>
                </div>
              ) : undefined}
            </div>
          </>
        }
        details={undefined}
        overlays={
          <div className="absolute inset-0 flex flex-col justify-between p-2 pointer-events-none">
            {/* Top Section */}
            <div className="flex justify-between items-start pointer-events-auto">
              <div className="flex gap-1">
                <RatingBanner rating={props.image.rating100} />
              </div>
              <StudioOverlay studio={props.image.studio} />
            </div>

            {/* Bottom Section */}
            <div className="mt-auto pointer-events-auto relative">
              {/* Gradient Background */}
              <div className="absolute inset-x-[-8px] bottom-[-8px] pt-20 bg-gradient-to-t from-black via-black/80 to-transparent -z-10" />

              <div className="flex flex-col gap-0.5 text-white pb-0">
                <div className="font-bold text-md leading-tight truncate drop-shadow-sm">
                  {imageTitle(props.image)}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-300 font-medium">
                  <span>{props.image.date}</span>
                </div>
              </div>
            </div>
          </div>
        }
        popovers={undefined}
        selected={props.selected}
        selecting={props.selecting}
        onSelectedChanged={props.onSelectedChanged}
        thumbnailSectionClassName="h-full w-full relative !p-0 !m-0"
      />
    );
  }
);
