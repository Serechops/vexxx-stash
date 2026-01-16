import React from "react";
import { Box, Typography } from "@mui/material";
import { Link } from "react-router-dom";
import { useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import NavUtils from "src/utils/navigation";
import TextUtils from "src/utils/text";
import { GridCard } from "../Shared/GridCard/GridCard";
import { CountryFlag } from "../Shared/CountryFlag";
import { HoverPopover } from "../Shared/HoverPopover";
import cx from "classnames";
import { TagLink } from "../Shared/TagLink";
// Button, ButtonGroup removed
import {
  ModifierCriterion,
  CriterionValue,
} from "src/models/list-filter/criteria/criterion";
import { PopoverCountButton } from "../Shared/PopoverCountButton";
import GenderIcon from "./GenderIcon";
import LinkIcon from "@mui/icons-material/Link";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import { RatingBanner } from "../Shared/RatingBanner";
import { usePerformerUpdate } from "src/core/StashService";
import { ILabeledId } from "src/models/list-filter/types";
import { FavoriteIcon } from "../Shared/FavoriteIcon";
import { PatchComponent } from "src/patch";
import { ExternalLinksButton } from "../Shared/ExternalLinksButton";
import { useConfigurationContext } from "src/hooks/Config";
import { OCounterButton } from "../Shared/CountButton";

export interface IPerformerCardExtraCriteria {
  scenes?: ModifierCriterion<CriterionValue>[];
  images?: ModifierCriterion<CriterionValue>[];
  galleries?: ModifierCriterion<CriterionValue>[];
  groups?: ModifierCriterion<CriterionValue>[];
  performer?: ILabeledId;
}

interface IPerformerCardProps {
  performer: GQL.PerformerDataFragment;
  cardWidth?: number;
  ageFromDate?: string;
  selecting?: boolean;
  selected?: boolean;
  zoomIndex?: number;
  onSelectedChanged?: (selected: boolean, shiftKey: boolean) => void;
  extraCriteria?: IPerformerCardExtraCriteria;
}

const PerformerCardPopovers: React.FC<IPerformerCardProps> = PatchComponent(
  "PerformerCard.Popovers",
  ({ performer, extraCriteria }) => {
    // Keep popovers for hover extra info if needed, or integrate them?
    // User asked for "compact meta overlay". Popovers usually appear ON HOVER below or inside.
    // Let's keep existing popover count buttons but maybe style them small?
    // Actually, popovers usually sit outside the card flow or at the bottom.
    // In GridCard, {props.popovers} is rendered LAST.
    // If we want a clean card, maybe we hide them or make them very subtle.
    // Let's return null for now to declutter, OR keep them if the user likes utility.
    // User said "subtle compact meta overlay along the very bottom".
    // I will include the critical counts in the overlay if possible, or just keeping them hidden for clean look.
    // Let's keep them but ensure they don't break layout.

    // Actually most modern designs hide these counts until hover or click.
    // I'll keep the logic but wrap it to be unobtrusive.
    function maybeRenderCounts() {
      // ... existing logic simplified ...
      if (!performer.scene_count && !performer.image_count) return null;

      return (
        <div className="flex gap-2 text-xs text-gray-300 mt-1">
          {performer.scene_count && <span>{performer.scene_count} scenes</span>}
          {performer.image_count && <span>{performer.image_count} images</span>}
        </div>
      )
    }
    return null; // DISABLING Popovers for now to achieve the requested clean look.
  }
);

const PerformerCardOverlays: React.FC<IPerformerCardProps> = PatchComponent(
  "PerformerCard.Overlays",
  ({ performer, ageFromDate }) => {
    const { configuration } = useConfigurationContext();
    const uiConfig = configuration?.ui;
    const [updatePerformer] = usePerformerUpdate();
    const intl = useIntl();

    function onToggleFavorite(v: boolean) {
      if (performer.id) {
        updatePerformer({
          variables: {
            input: {
              id: performer.id,
              favorite: v,
            },
          },
        });
      }
    }

    const age = TextUtils.age(
      performer.birthdate,
      ageFromDate ?? performer.death_date
    );

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
        {/* Top Section: Favorite & Rating */}
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", pointerEvents: "auto" }}>
          <Box sx={{ display: "flex", gap: 0.5 }}>
            {performer.rating100 && (
              <Box sx={{ fontSize: "0.75rem", px: 0.75, py: 0.25, borderRadius: "4px", bgcolor: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}>
                <RatingBanner rating={performer.rating100} />
              </Box>
            )}
          </Box>
          <FavoriteIcon
            favorite={performer.favorite}
            onToggleFavorite={onToggleFavorite}
            size="1x"
            className={cx("transition-colors drop-shadow-md", { "text-red-500": performer.favorite, "text-white/50 hover:text-white": !performer.favorite })}
          />
        </Box>

        {/* Bottom Section: Meta Overlay */}
        <Box sx={{ mt: "auto", pointerEvents: "auto", position: "relative" }}>
          {/* Gradient Background */}
          <Box
            sx={{
              position: "absolute",
              insetX: "-8px",
              bottom: "-8px",
              height: "66%",
              backgroundImage: "linear-gradient(to top, rgba(0,0,0,1), rgba(0,0,0,0.8) 40%, transparent)",
              zIndex: -1,
              left: "-8px",
              right: "-8px"
            }}
          />

          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, color: "#fff", pb: 0.5 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography
                variant="subtitle1"
                sx={{
                  fontWeight: "bold",
                  fontSize: "1.125rem",
                  lineHeight: "1.2",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  textShadow: "0 1px 2px rgba(0,0,0,0.5)"
                }}
              >
                {performer.name}
              </Typography>
              {performer.country && (
                <CountryFlag country={performer.country} className="opacity-90 w-4 h-auto shadow-sm" />
              )}
            </Box>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: "0.75rem", color: "grey.400", fontWeight: "medium" }}>
              {age !== 0 && <Typography variant="caption" sx={{ color: "inherit" }}>{age} years</Typography>}
              {performer.scene_count > 0 && (
                <>
                  <Box sx={{ width: 4, height: 4, bgcolor: "grey.600", borderRadius: "50%" }} />
                  <Typography variant="caption" sx={{ color: "inherit" }}>{performer.scene_count} scenes</Typography>
                </>
              )}
            </Box>
          </Box>
        </Box>
      </Box>
    );
  }
);

// We merge Title and Details into Overlays, so these can be null/noop
const PerformerCardDetails = () => null;
const PerformerCardTitle = () => null;

const PerformerCardImage: React.FC<IPerformerCardProps> = PatchComponent(
  "PerformerCard.Image",
  ({ performer }) => {
    return (
      <Box
        sx={{
          width: "100%",
          height: "100%",
          bgcolor: "grey.900",
          position: "relative",
          overflow: "hidden",
          "&:hover img": {
            transform: "scale(1.05)"
          }
        }}
      >
        <Box sx={{ position: "relative", width: "100%", pb: "150%" }}>
          <Box sx={{ position: "absolute", inset: 0 }}>
            <Box
              component="img"
              loading="lazy"
              alt={performer.name ?? ""}
              src={performer.image_path ?? ""}
              sx={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: "top",
                transition: "transform 0.7s"
              }}
            />
          </Box>
        </Box>

        {/* Hover Highlight Overlay */}
        <Box
          className="hover-highlight"
          sx={{
            position: "absolute",
            inset: 0,
            bgcolor: "rgba(255, 255, 255, 0)",
            transition: "background-color 0.3s",
            pointerEvents: "none",
            "&:hover": {
              bgcolor: "rgba(255, 255, 255, 0.05)"
            }
          }}
        />
      </Box>
    );
  }
);

export const PerformerCard: React.FC<IPerformerCardProps> = PatchComponent(
  "PerformerCard",
  (props) => {
    const {
      performer,
      cardWidth,
      selecting,
      selected,
      onSelectedChanged,
      zoomIndex,
    } = props;

    return (
      <Box
        className={`performer-card zoom-${zoomIndex}`}
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
          width: cardWidth
        }}
      >
        <GridCard
          url={`/performers/${performer.id}`}
          width={cardWidth}
          title={undefined}
          image={<PerformerCardImage {...props} />}
          overlays={<PerformerCardOverlays {...props} />}
          details={undefined}
          popovers={undefined}
          selected={selected}
          selecting={selecting}
          onSelectedChanged={onSelectedChanged}
          thumbnailSectionClassName="h-full w-full relative !p-0 !m-0"
        />
      </Box>
    );
  }
);
