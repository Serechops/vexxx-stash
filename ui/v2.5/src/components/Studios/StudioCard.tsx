import React, { useEffect, useState } from "react";
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
    const [identifiedCount, setIdentifiedCount] = useState(0);
    const [isPulsing, setIsPulsing] = useState(false);

    useEffect(() => {
      const handleIdentified = (event: Event) => {
        const customEvent = event as CustomEvent<{ sceneId: string; studioId: string }>;
        if (customEvent.detail.studioId === studio.id) {
          setIdentifiedCount((prev) => prev + 1);
          setIsPulsing(true);
          
          // Reset pulsing after 2 seconds
          const pulseTimeout = setTimeout(() => {
            setIsPulsing(false);
          }, 2000);
          
          return () => clearTimeout(pulseTimeout);
        }
      };

      window.addEventListener("studio-scene-identified", handleIdentified);
      return () => {
        window.removeEventListener("studio-scene-identified", handleIdentified);
      };
    }, [studio.id]);

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
      const count = (studio.scene_count ?? 0) + identifiedCount;
      if (!count) return;

      return (
        <PopoverCountButton
          className="scene-count"
          type="scene"
          count={count}
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
              count={(studio.scene_count ?? 0) + identifiedCount}
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
        data-has-stashid={studio.stash_ids?.length > 0 ? "" : undefined}
        sx={{
          '& .favorite-button': {
            opacity: 0,
            transition: 'opacity 0.2s, color 0.2s',
            '&.favorite': {
              opacity: 1,
              color: '#ff5252 !important',
              '&:hover': { color: '#ff1744 !important' },
            },
          },
          '&:hover': { '& .favorite-button': { opacity: 1 } },
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
            <>
              <FavoriteIcon
                favorite={studio.favorite}
                onToggleFavorite={(v) => onToggleFavorite(v)}
                size="2x"
                className="favorite-button"
                sx={{
                  p: 0,
                  position: 'absolute',
                  right: '5px',
                  top: '10px',
                  zIndex: 1,
                  color: 'rgba(255, 255, 255, 0.85)',
                }}
              />
              {identifiedCount > 0 && (
                <Box
                  sx={{
                    position: "absolute",
                    left: "8px",
                    top: "8px",
                    zIndex: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    bgcolor: "rgba(16, 185, 129, 0.85)",
                    backdropFilter: "blur(4px)",
                    color: "#ffffff",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    px: 1.25,
                    py: 0.5,
                    borderRadius: "9999px",
                    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
                    transition: "all 0.3s ease",
                    border: "1px solid rgba(255, 255, 255, 0.2)",
                    animation: isPulsing ? "pulse-scale 1.5s infinite ease-in-out" : "none",
                    "@keyframes pulse-scale": {
                      "0%, 100%": { transform: "scale(1)" },
                      "50%": { transform: "scale(1.05)", bgcolor: "rgba(16, 185, 129, 1)" },
                    }
                  }}
                >
                  <Box
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      bgcolor: "#ffffff",
                      animation: "blink 1s infinite alternate",
                      "@keyframes blink": {
                        "0%": { opacity: 0.4 },
                        "100%": { opacity: 1 },
                      }
                    }}
                  />
                  <span>+{identifiedCount} identified</span>
                </Box>
              )}
            </>
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
