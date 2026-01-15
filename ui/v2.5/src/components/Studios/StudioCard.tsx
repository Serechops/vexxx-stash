import { Link } from "react-router-dom";
import { Box, Button, ButtonGroup, Typography } from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import NavUtils from "src/utils/navigation";
import { GridCard } from "src/components/Shared/GridCard/GridCard";
import { PatchComponent } from "src/patch";
import { HoverPopover } from "../Shared/HoverPopover";
import { Icon } from "../Shared/Icon";
import { TagLink } from "../Shared/TagLink";
import { FormattedMessage } from "react-intl";
import { PopoverCountButton } from "../Shared/PopoverCountButton";
import { RatingBanner } from "../Shared/RatingBanner";
import { FavoriteIcon } from "../Shared/FavoriteIcon";
import { useStudioUpdate } from "src/core/StashService";
import { faTag } from "@fortawesome/free-solid-svg-icons";
import { OCounterButton } from "../Shared/CountButton";

interface IProps {
  studio: GQL.StudioDataFragment;
  cardWidth?: number;
  hideParent?: boolean;
  selecting?: boolean;
  selected?: boolean;
  zoomIndex?: number;
  onSelectedChanged?: (selected: boolean, shiftKey: boolean) => void;
}

function maybeRenderParent(
  studio: GQL.StudioDataFragment,
  hideParent?: boolean
) {
  if (!hideParent && studio.parent_studio) {
    return (
      <Box sx={{ mt: 0.5, fontSize: "0.875rem" }}>
        <FormattedMessage
          id="part_of"
          values={{
            parent: (
              <Link to={`/studios/${studio.parent_studio.id}`}>
                {studio.parent_studio.name}
              </Link>
            ),
          }}
        />
      </Box>
    );
  }
}

function maybeRenderChildren(studio: GQL.StudioDataFragment) {
  if (studio.child_studios.length > 0) {
    return (
      <Box sx={{ mt: 0.5, fontSize: "0.875rem" }}>
        <FormattedMessage
          id="parent_of"
          values={{
            children: (
              <Link to={NavUtils.makeChildStudiosUrl(studio)}>
                {studio.child_studios.length}&nbsp;
                <FormattedMessage
                  id="countables.studios"
                  values={{ count: studio.child_studios.length }}
                />
              </Link>
            ),
          }}
        />
      </Box>
    );
  }
}

export const StudioCard: React.FC<IProps> = PatchComponent(
  "StudioCard",
  ({
    studio,
    cardWidth,
    hideParent,
    selecting,
    selected,
    zoomIndex,
    onSelectedChanged,
  }) => {
    const [updateStudio] = useStudioUpdate();

    function onToggleFavorite(v: boolean) {
      if (studio.id) {
        updateStudio({
          variables: {
            input: {
              id: studio.id,
              favorite: v,
            },
          },
        });
      }
    }

    function maybeRenderScenesPopoverButton() {
      if (!studio.scene_count) return;

      return (
        <PopoverCountButton
          className="scene-count"
          type="scene"
          count={studio.scene_count}
          url={NavUtils.makeStudioScenesUrl(studio)}
        />
      );
    }

    function maybeRenderImagesPopoverButton() {
      if (!studio.image_count) return;

      return (
        <PopoverCountButton
          className="image-count"
          type="image"
          count={studio.image_count}
          url={NavUtils.makeStudioImagesUrl(studio)}
        />
      );
    }

    function maybeRenderGalleriesPopoverButton() {
      if (!studio.gallery_count) return;

      return (
        <PopoverCountButton
          className="gallery-count"
          type="gallery"
          count={studio.gallery_count}
          url={NavUtils.makeStudioGalleriesUrl(studio)}
        />
      );
    }

    function maybeRenderGroupsPopoverButton() {
      if (!studio.group_count) return;

      return (
        <PopoverCountButton
          className="group-count"
          type="group"
          count={studio.group_count}
          url={NavUtils.makeStudioGroupsUrl(studio)}
        />
      );
    }

    function maybeRenderPerformersPopoverButton() {
      if (!studio.performer_count) return;

      return (
        <PopoverCountButton
          className="performer-count"
          type="performer"
          count={studio.performer_count}
          url={NavUtils.makeStudioPerformersUrl(studio)}
        />
      );
    }

    function maybeRenderTagPopoverButton() {
      if (studio.tags.length <= 0) return;

      const popoverContent = studio.tags.map((tag) => (
        <TagLink key={tag.id} linkType="studio" tag={tag} />
      ));

      return (
        <HoverPopover placement="bottom" content={popoverContent}>
          <Button
            variant="text"
            size="small"
            sx={{
              minWidth: 0,
              px: 1,
              color: "text.primary",
              "& span": {
                ml: 0.5
              }
            }}
          >
            <Icon icon={faTag} />
            <span>{studio.tags.length}</span>
          </Button>
        </HoverPopover>
      );
    }

    function maybeRenderOCounter() {
      if (!studio.o_counter) return;

      return <OCounterButton value={studio.o_counter} />;
    }

    function maybeRenderPopoverButtonGroup() {
      if (
        studio.scene_count ||
        studio.image_count ||
        studio.gallery_count ||
        studio.group_count ||
        studio.performer_count ||
        studio.o_counter ||
        studio.tags.length > 0
      ) {
        return (
          <>
            <hr />
            <ButtonGroup className="card-popovers">
              {maybeRenderScenesPopoverButton()}
              {maybeRenderGroupsPopoverButton()}
              {maybeRenderImagesPopoverButton()}
              {maybeRenderGalleriesPopoverButton()}
              {maybeRenderPerformersPopoverButton()}
              {maybeRenderTagPopoverButton()}
              {maybeRenderOCounter()}
            </ButtonGroup>
          </>
        );
      }
    }

    return (
      <Box
        className={`studio-card zoom-${zoomIndex}`}
        sx={{
          "& .favorite-button": {
            position: "absolute",
            top: 10,
            right: 5,
            p: 0,
            zIndex: 1,
            "&.not-favorite": {
              opacity: 0,
              transition: "opacity 0.2s"
            }
          },
          "&:hover .favorite-button.not-favorite": {
            opacity: 1
          }
        }}
      >
        <GridCard
          className="hover:!scale-100 !transition-none"
          url={`/studios/${studio.id}`}
          width={cardWidth}
          title={studio.name}
          linkClassName="studio-card-header"
          image={
            <Box sx={{ position: "relative", width: "100%", pb: "50%" }}>
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  p: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Box
                  component="img"
                  loading="lazy"
                  alt={studio.name}
                  src={studio.image_path ?? ""}
                  sx={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    objectFit: "contain",
                  }}
                />
              </Box>
            </Box>
          }
          details={
            <Box sx={{ minHeight: "3.5rem" }}>
              {maybeRenderParent(studio, hideParent)}
              {maybeRenderChildren(studio)}
              <Box sx={{ mt: 1 }}>
                <RatingBanner rating={studio.rating100} />
              </Box>
            </Box>
          }
          overlays={
            <FavoriteIcon
              favorite={studio.favorite}
              onToggleFavorite={(v) => onToggleFavorite(v)}
              size="2x"
              className="favorite-button"
            />
          }
          popovers={maybeRenderPopoverButtonGroup()}
          selected={selected}
          selecting={selecting}
          onSelectedChanged={onSelectedChanged}
        />
      </Box>
    );
  }
);
