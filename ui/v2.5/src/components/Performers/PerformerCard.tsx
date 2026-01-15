import React from "react";
import { Link } from "react-router-dom";
import { useIntl } from "react-intl";
import * as GQL from "src/core/generated-graphql";
import NavUtils from "src/utils/navigation";
import TextUtils from "src/utils/text";
import { GridCard } from "../Shared/GridCard/GridCard";
import { CountryFlag } from "../Shared/CountryFlag";
import { HoverPopover } from "../Shared/HoverPopover";
import { Icon } from "../Shared/Icon";
import cx from "classnames";
import { TagLink } from "../Shared/TagLink";
// Button, ButtonGroup removed
import {
  ModifierCriterion,
  CriterionValue,
} from "src/models/list-filter/criteria/criterion";
import { PopoverCountButton } from "../Shared/PopoverCountButton";
import GenderIcon from "./GenderIcon";
import { faLink, faTag } from "@fortawesome/free-solid-svg-icons";
import { faInstagram, faTwitter } from "@fortawesome/free-brands-svg-icons";
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
      <div className="absolute inset-0 flex flex-col justify-between p-2 pointer-events-none">
        {/* Top Section: Favorite & Rating */}
        <div className="flex justify-between items-start pointer-events-auto">
          <div className="flex gap-1">
            {performer.rating100 && (
              <div className="text-xs px-1.5 py-0.5 rounded bg-black/50 backdrop-blur-sm">
                <RatingBanner rating={performer.rating100} />
              </div>
            )}
          </div>
          <FavoriteIcon
            favorite={performer.favorite}
            onToggleFavorite={onToggleFavorite}
            size="1x"
            className={cx("transition-colors drop-shadow-md", { "text-red-500": performer.favorite, "text-white/50 hover:text-white": !performer.favorite })}
          />
        </div>

        {/* Bottom Section: Meta Overlay */}
        <div className="mt-auto pointer-events-auto">
          {/* Gradient Background is handled by parent or this container? 
                Better to have a separate gradient layer so text doesn't need bg. 
                I will add a gradient div to the Image component or here.
                Let's add a gradient div BEHIND this text but inside the overlay container.
            */}
          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black via-black/80 to-transparent -z-10" />

          <div className="flex flex-col gap-0.5 text-white pb-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg leading-tight truncate drop-shadow-sm">{performer.name}</span>
              {performer.country && (
                <CountryFlag country={performer.country} className="opacity-90 w-4 h-auto shadow-sm" />
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-300 font-medium">
              {age !== 0 && <span>{age} years</span>}
              {performer.scene_count > 0 && (
                <>
                  <span className="w-1 h-1 bg-gray-500 rounded-full" />
                  <span>{performer.scene_count} scenes</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
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
      <div className="w-full h-full bg-gray-900 relative group overflow-hidden">
        {/* Enforce 2/3 Aspect Ratio Container independently if needed, though GridCard handles width */}
        <div className="relative w-full pb-[150%]">
          <div className="absolute inset-0">
            <img
              loading="lazy"
              className="w-full h-full object-cover transition-transform duration-700"
              alt={performer.name ?? ""}
              src={performer.image_path ?? ""}
            />
          </div>
        </div>

        {/* Hover Highlight Overlay */}
        <div className="absolute inset-0 bg-white/0 group-hover:bg-white/5 transition-colors duration-300 pointer-events-none" />
      </div>
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
      <GridCard
        className={`performer-card group zoom-${zoomIndex} [&_.card-section]:hidden !rounded-xl overflow-hidden shadow-md hover:shadow-xl !border-none !bg-gray-900 !p-0 hover:!scale-100 !transition-none`}
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
    );
  }
);
