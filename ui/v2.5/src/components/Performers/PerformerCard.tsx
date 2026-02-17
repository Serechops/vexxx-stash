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
        className="performer-card"
        sx={{
          bgcolor: '#18181b',
          borderRadius: '12px',
          height: '100%',
          overflow: 'hidden',
          position: 'relative',
          transition: 'all 0.3s ease',
          width: '100%',
          '&:hover': {
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
            transform: 'scale(1.02)',
            zIndex: 20,
            '& .performer-card-overlay-inner': {
              background: 'linear-gradient(to top, rgba(0, 0, 0, 0.95) 20%, rgba(0, 0, 0, 0.7) 60%, transparent 100%)',
            },
          },
          ...(selected && { boxShadow: '0 0 0 3px #52525b' }),
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={handleCardClick}
        style={{ width: cardWidth ? cardWidth : undefined }}
      >
        <LinkWrapper>
          {/* Media Container: Full Bleed */}
          <Box
            sx={{
              aspectRatio: '2 / 3',
              bgcolor: 'black',
              height: '100%',
              position: 'relative',
              width: '100%',
              '& img': {
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'top',
                transition: 'transform 0.7s',
                width: '100%',
              },
            }}
          >
            <Box
              component="img"
              loading="lazy"
              alt={performer.name ?? ""}
              src={performer.image_path ?? ""}
            />
          </Box>

          {/* Top Section: Rating & Favorite */}
          <Box
            sx={{
              alignItems: 'flex-start',
              display: 'flex',
              justifyContent: 'space-between',
              left: 0,
              p: '0.5rem',
              pointerEvents: 'none',
              position: 'absolute',
              right: 0,
              top: 0,
              zIndex: 16,
            }}
          >
            <Box sx={{ display: 'flex', gap: '0.25rem', pointerEvents: 'auto' }}>
              {performer.rating100 && (
                <RatingBanner rating={performer.rating100} />
              )}
            </Box>
            <Box
              sx={{
                pointerEvents: 'auto',
                '& .favorite-icon': {
                  color: 'rgba(255, 255, 255, 0.5)',
                  transition: 'color 0.2s',
                  '&.is-favorite': {
                    color: '#ff5252 !important',
                    '&:hover': { color: '#ff1744 !important' },
                  },
                  '&:hover': { color: '#ffffff' },
                },
              }}
            >
              <FavoriteIcon
                favorite={performer.favorite}
                onToggleFavorite={onToggleFavorite}
                size="1x"
                className="favorite-icon transition-colors drop-shadow-md"
              sx={{
                ...(performer.favorite && { color: '#ff5252 !important' }),
              }}
              />
            </Box>
          </Box>

          {/* Selecting Checkbox */}
          {selecting && (
            <Box sx={{ left: '0.5rem', position: 'absolute', top: '0.5rem', zIndex: 30, '& input': { cursor: 'pointer', height: '1.25rem', width: '1.25rem' } }}>
              <input
                type="checkbox"
                checked={selected}
                readOnly
              />
            </Box>
          )}

          {/* Gradient Overlay & Content */}
          <Box
            className="performer-card-overlay-inner"
            sx={{
              background: 'linear-gradient(to top, rgba(0, 0, 0, 0.9) 0%, rgba(0, 0, 0, 0.4) 70%, transparent 100%)',
              bottom: 0,
              color: '#fff',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              left: 0,
              p: '12px',
              pointerEvents: 'none',
              position: 'absolute',
              right: 0,
              transition: 'background 0.3s ease',
            }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <Box sx={{ alignItems: 'center', display: 'flex', gap: '0.5rem' }}>
                <Typography
                  variant="subtitle1"
                  sx={{
                    color: '#fff',
                    fontSize: '1.1rem',
                    fontWeight: 700,
                    lineHeight: 1.2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    textShadow: '0 2px 4px rgba(0, 0, 0, 0.8)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {performer.name}
                </Typography>
                {performer.country && (
                  <CountryFlag country={performer.country} className="opacity-90 w-4 h-auto shadow-sm" />
                )}
              </Box>

              <Box sx={{ alignItems: 'center', color: 'rgba(255, 255, 255, 0.8)', display: 'flex', fontSize: '0.8rem', gap: '0.5rem' }}>
                {age !== 0 && <span>{age} years</span>}
                {performer.scene_count > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                    <div style={{ background: 'rgba(255, 255, 255, 0.5)', borderRadius: '50%', height: 4, marginRight: 4, width: 4 }}></div>
                    {performer.scene_count} scenes
                  </span>
                )}
              </Box>
            </Box>

            {/* Expanded Content (Slide Up) */}
            <Box
              sx={{
                maxHeight: isHovered ? '100px' : 0,
                opacity: isHovered ? 1 : 0,
                overflow: 'hidden',
                transition: 'all 0.3s ease-in-out',
                ...(isHovered && { mt: '8px' }),
              }}
            >
              <Box sx={{ color: 'rgba(255, 255, 255, 0.7)', display: 'flex', fontSize: '0.75rem', gap: '1rem' }}>
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
