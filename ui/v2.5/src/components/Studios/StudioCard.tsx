import { Link } from "react-router-dom";
import { Box, Button, ButtonGroup, Tooltip, Typography } from "@mui/material";
import * as GQL from "src/core/generated-graphql";
import NavUtils from "src/utils/navigation";
import { GridCard } from "src/components/Shared/GridCard/GridCard";
import { PatchComponent } from "src/patch";
import { HoverPopover } from "../Shared/HoverPopover";
import { TagLink } from "../Shared/TagLink";
import { FormattedMessage, useIntl } from "react-intl";
import { PopoverCountButton } from "../Shared/PopoverCountButton";
import { RatingBanner } from "../Shared/RatingBanner";
import { FavoriteIcon } from "../Shared/FavoriteIcon";
import { useStudioUpdate } from "src/core/StashService";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import InventoryIcon from "@mui/icons-material/Inventory";
import { OCounterButton } from "../Shared/CountButton";

interface IProps {
  studio: GQL.StudioDataFragment;
  hideParent?: boolean;
  selecting?: boolean;
  selected?: boolean;
  zoomIndex: number;
  onSelectedChanged?: (selected: boolean, shiftKey: boolean) => void;
}

function maybeRenderParent(
  studio: GQL.StudioDataFragment,
  hideParent?: boolean
) {
  if (!hideParent && studio.parent_studio) {
    return (
      <Box sx={{ fontSize: '0.875rem', mt: '0.25rem' }}>
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
      <Box sx={{ fontSize: '0.875rem', mt: '0.25rem' }}>
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
    hideParent,
    selecting,
    selected,
    zoomIndex,
    onSelectedChanged,
  }) => {
    const intl = useIntl();
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
          url={`/studios/${studio.id}/scenes`}
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
          url={`/studios/${studio.id}/images`}
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
          url={`/studios/${studio.id}/galleries`}
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
          url={`/studios/${studio.id}/groups`}
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
          url={`/studios/${studio.id}/performers`}
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
              color: '#fafafa',
              minWidth: 0,
              px: 1,
              '& span': { ml: 0.5 },
            }}
          >
            <LocalOfferIcon fontSize="small" />
            <span>{studio.tags.length}</span>
          </Button>
        </HoverPopover>
      );
    }

    function maybeRenderOCounter() {
      if (!studio.o_counter) return;

      return <OCounterButton value={studio.o_counter} />;
    }

    function maybeRenderOrganized() {
      if (!studio.organized) return;

      return (
        <Tooltip title={intl.formatMessage({ id: "organized" })}>
          <Button
            variant="text"
            size="small"
            sx={{
              minWidth: "auto",
              color: "#664c3f",
              "&:hover": { backgroundColor: "rgba(138, 155, 168, 0.15)" },
            }}
            disableRipple
          >
            <InventoryIcon fontSize="small" />
          </Button>
        </Tooltip>
      );
    }

    function maybeRenderPopoverButtonGroup() {
      return (
        <>
          <hr />
          <ButtonGroup
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              mb: '10px',
              '& .fa-icon': { mr: '7px' },
            }}
          >
            <PopoverCountButton
              className="scene-count"
              type="scene"
              count={studio.scene_count}
              url={`/studios/${studio.id}/scenes`}
              showZero={true}
            />
            <PopoverCountButton
              className="group-count"
              type="group"
              count={studio.group_count}
              url={`/studios/${studio.id}/groups`}
              showZero={true}
            />
            <PopoverCountButton
              className="image-count"
              type="image"
              count={studio.image_count}
              url={`/studios/${studio.id}/images`}
              showZero={true}
            />
            <PopoverCountButton
              className="gallery-count"
              type="gallery"
              count={studio.gallery_count}
              url={`/studios/${studio.id}/galleries`}
              showZero={true}
            />
            <PopoverCountButton
              className="performer-count"
              type="performer"
              count={studio.performer_count}
              url={`/studios/${studio.id}/performers`}
              showZero={true}
            />
            {maybeRenderTagPopoverButton()}
            {maybeRenderOCounter()}
            {maybeRenderOrganized()}
          </ButtonGroup>
        </>
      );
    }

    return (
      <Box
        sx={{
          '&:hover': { '& .MuiIconButton-root': { opacity: '1 !important' } },
        }}
      >
        <GridCard
          className="hover:!scale-100 !transition-none"
          url={`/studios/${studio.id}`}
          title={studio.name}
          linkClassName="studio-card-header"
          image={
            <Box sx={{ paddingBottom: '50%', position: 'relative', width: '100%' }}>
              <Box sx={{ alignItems: 'center', display: 'flex', inset: 0, justifyContent: 'center', p: '0.5rem', position: 'absolute' }}>
                <Box
                  component="img"
                  loading="lazy"
                  alt={studio.name}
                  src={studio.image_path ?? ""}
                  sx={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }}
                />
              </Box>
            </Box>
          }
          details={
            <Box sx={{ minHeight: '3.5rem' }}>
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
              sx={{
                p: 0,
                position: 'absolute',
                right: '5px',
                top: '10px',
                zIndex: 1,
              }}
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
