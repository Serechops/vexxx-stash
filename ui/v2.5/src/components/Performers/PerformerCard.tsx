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

export const PerformerCard: React.FC<IPerformerCardProps> = PatchComponent(
  "PerformerCard",
  (props: IPerformerCardProps) => {
    const {
      performer,
      cardWidth,
      selecting,
      selected,
      onSelectedChanged,
      ageFromDate
    } = props;

    const [isHovered, setIsHovered] = React.useState(false);
    const [updatePerformer] = usePerformerUpdate();

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

    const handleCardClick = (e: React.MouseEvent) => {
      if (selecting && onSelectedChanged) {
        onSelectedChanged(!selected, e.shiftKey);
        e.preventDefault();
      }
    };

    return (
      <Box
        className={cx("performer-card", { "selected": selected })}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handleCardClick}
        sx={{
          position: "relative",
          borderRadius: "12px",
          overflow: "hidden",
          backgroundColor: "grey.900",
          transition: "all 0.3s ease",
          height: "100%",
          width: cardWidth ? cardWidth : "100%",
          "&:hover": {
            transform: "scale(1.02)",
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
            zIndex: 20,
            "& .overlay-content": {
              background: "linear-gradient(to top, rgba(0, 0, 0, 0.95) 20%, rgba(0, 0, 0, 0.7) 60%, transparent 100%)",
            }
          },
          "&.selected": {
            boxShadow: (theme) => `0 0 0 3px ${theme.palette.primary.main}`,
          }
        }}
      >
        <Link
          to={selecting ? "#" : `/performers/${performer.id}`}
          onClick={(e) => {
            if (selecting) {
              e.preventDefault();
            }
          }}
          style={{ textDecoration: 'none', color: 'inherit', display: 'block', height: '100%', width: '100%' }}
        >
          {/* Media Container: Full Bleed */}
          <Box
            className="overlay-media"
            sx={{
              position: "relative",
              width: "100%",
              height: "100%",
              aspectRatio: "2/3", // Performers are usually portrait.
              bgcolor: "black",
            }}
          >
            <Box
              component="img"
              loading="lazy"
              alt={performer.name ?? ""}
              src={performer.image_path ?? ""}
              sx={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: "top", // Face usually at top
                transition: "transform 0.7s"
              }}
            />
          </Box>

          {/* Top Section: Rating & Favorite */}
          <Box sx={{ position: "absolute", top: 0, left: 0, right: 0, p: 1, display: "flex", justifyContent: "space-between", alignItems: "flex-start", zIndex: 16, pointerEvents: "none" }}>
            <Box sx={{ display: "flex", gap: 0.5, pointerEvents: "auto" }}>
              {performer.rating100 && (
                <RatingBanner rating={performer.rating100} />
              )}
            </Box>
            <Box sx={{ pointerEvents: "auto" }}>
              <FavoriteIcon
                favorite={performer.favorite}
                onToggleFavorite={onToggleFavorite}
                size="1x"
                className="transition-colors drop-shadow-md"
                sx={{
                  color: performer.favorite
                    ? "#ff5252 !important"
                    : "rgba(255, 255, 255, 0.5)",
                  "&:hover": {
                    color: performer.favorite ? "#ff1744 !important" : "#ffffff",
                  },
                }}
              />
            </Box>
          </Box>

          {/* Selecting Checkbox */}
          {selecting && (
            <Box sx={{ position: "absolute", top: "0.5rem", left: "0.5rem", zIndex: 30 }}>
              <input
                type="checkbox"
                checked={selected}
                readOnly
                style={{ cursor: "pointer", height: "1.25rem", width: "1.25rem" }}
              />
            </Box>
          )}


          {/* Gradient Overlay & Content */}
          <Box
            className="overlay-content"
            sx={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              background: "linear-gradient(to top, rgba(0, 0, 0, 0.9) 0%, rgba(0, 0, 0, 0.4) 70%, transparent 100%)",
              padding: "12px",
              color: "#fff",
              transition: "background 0.3s ease",
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              pointerEvents: "none"
            }}
          >
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography
                  variant="subtitle1"
                  sx={{
                    fontWeight: 700,
                    lineHeight: 1.2,
                    textShadow: "0 2px 4px rgba(0, 0, 0, 0.8)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: "1.1rem"
                  }}
                >
                  {performer.name}
                </Typography>
                {performer.country && (
                  <CountryFlag country={performer.country} className="opacity-90 w-4 h-auto shadow-sm" />
                )}
              </Box>

              <Box sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: "0.8rem", color: "rgba(255,255,255,0.8)" }}>
                {age !== 0 && <span>{age} years</span>}
                {performer.scene_count > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                    <div style={{ width: 4, height: 4, background: "rgba(255,255,255,0.5)", borderRadius: "50%", marginRight: "4px" }}></div>
                    {performer.scene_count} scenes
                  </span>
                )}
              </Box>
            </Box>

            {/* Expanded Content (Slide Up) - More details? */}
            <Box
              className={cx("overlay-slide-content", { visible: isHovered })}
              sx={{
                maxHeight: 0,
                overflow: "hidden",
                opacity: 0,
                transition: "all 0.3s ease-in-out",
                "&.visible": {
                  maxHeight: "100px",
                  opacity: 1,
                  mt: "8px",
                }
              }}
            >
              {/* Extra details like Years Active, Career Length, or just spacers if nothing else */}
              {/* For now, maybe just tag count or image count if significant? */}
              <Box sx={{ display: "flex", gap: 2, fontSize: "0.75rem", color: "rgba(255,255,255,0.7)" }}>
                {performer.image_count > 0 && (
                  <span>{performer.image_count} images</span>
                )}
                {performer.gallery_count > 0 && (
                  <span>{performer.gallery_count} galleries</span>
                )}
              </Box>
            </Box>
          </Box>
        </Link>
      </Box>
    );
  }
);
