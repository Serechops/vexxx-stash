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

export interface IPerformerCardProps {
  performer: GQL.PerformerDataFragment;
  cardWidth?: number;
  ageFromDate?: string;
  selecting?: boolean;
  selected?: boolean;
  zoomIndex?: number;
  onSelectedChanged?: (selected: boolean, shiftKey: boolean) => void;
  extraCriteria?: IPerformerCardExtraCriteria;
  link?: string;
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
      ageFromDate,
      link
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
    }

    const LinkWrapper: React.FC = ({ children }) => {
      if (selecting) {
        return (
          <div
            onClick={(e) => {
              e.preventDefault();
            }}
            style={{ display: 'block', height: '100%', width: '100%' }}
          >
            {children}
          </div>
        );
      }

      if (link) {
        return (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'none', color: 'inherit', display: 'block', height: '100%', width: '100%' }}
          >
            {children}
          </a>
        );
      }

      return (
        <Link
          to={`/performers/${performer.id}`}
          style={{ textDecoration: 'none', color: 'inherit', display: 'block', height: '100%', width: '100%' }}
        >
          {children}
        </Link>
      );
    };

    return (
      <Box
        className={cx("performer-card", "vexxx-performer-card", { "selected": selected })}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handleCardClick}
        style={{ width: cardWidth ? cardWidth : undefined }}
      >
        <LinkWrapper>
          {/* Media Container: Full Bleed */}
          <Box className="performer-card-media">
            <Box
              component="img"
              loading="lazy"
              alt={performer.name ?? ""}
              src={performer.image_path ?? ""}
            />
          </Box>

          {/* Top Section: Rating & Favorite */}
          <Box className="performer-card-top">
            <Box className="performer-card-rating">
              {performer.rating100 && (
                <RatingBanner rating={performer.rating100} />
              )}
            </Box>
            <Box className="performer-card-favorite">
              <FavoriteIcon
                favorite={performer.favorite}
                onToggleFavorite={onToggleFavorite}
                size="1x"
                className={cx("favorite-icon", "transition-colors", "drop-shadow-md", { "is-favorite": performer.favorite })}
              />
            </Box>
          </Box>

          {/* Selecting Checkbox */}
          {selecting && (
            <Box className="performer-card-checkbox">
              <input
                type="checkbox"
                checked={selected}
                readOnly
              />
            </Box>
          )}

          {/* Gradient Overlay & Content */}
          <Box className="performer-card-overlay">
            <Box className="performer-card-info">
              <Box className="performer-card-name-row">
                <Typography
                  variant="subtitle1"
                  className="performer-card-name"
                >
                  {performer.name}
                </Typography>
                {performer.country && (
                  <CountryFlag country={performer.country} className="opacity-90 w-4 h-auto shadow-sm" />
                )}
              </Box>

              <Box className="performer-card-meta">
                {age !== 0 && <span>{age} years</span>}
                {performer.scene_count > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                    <div className="performer-card-meta-separator"></div>
                    {performer.scene_count} scenes
                  </span>
                )}
              </Box>
            </Box>

            {/* Expanded Content (Slide Up) */}
            <Box className={cx("performer-card-slide", { visible: isHovered })}>
              <Box className="performer-card-extra">
                {performer.image_count > 0 && (
                  <span>{performer.image_count} images</span>
                )}
                {performer.gallery_count > 0 && (
                  <span>{performer.gallery_count} galleries</span>
                )}
              </Box>
            </Box>
          </Box>
        </LinkWrapper>
      </Box>
    );
  }
);
