import React from "react";
import { FormattedMessage } from "react-intl";
import {
  convertToRatingFormat,
  defaultRatingSystemOptions,
  RatingStarPrecision,
  RatingSystemType,
} from "src/utils/rating";
import { useConfigurationContext } from "src/hooks/Config";
import { PatchComponent } from "src/patch";

interface IProps {
  rating?: number | null;
}

const RatingBannerComponent: React.FC<IProps> = ({ rating }) => {
  const { configuration: config } = useConfigurationContext();
  const ratingSystemOptions =
    config?.ui.ratingSystemOptions ?? defaultRatingSystemOptions;
  const isLegacy =
    ratingSystemOptions.type === RatingSystemType.Stars &&
    ratingSystemOptions.starPrecision === RatingStarPrecision.Full;

  const convertedRating = convertToRatingFormat(
    rating ?? undefined,
    ratingSystemOptions
  );

  return rating ? (
    <div
      className={
        isLegacy
          ? `stash-rating-banner rating-banner rating-${convertedRating}`
          : `stash-rating-banner rating-banner rating-100-${Math.trunc(rating / 5)}`
      }
    >
      <FormattedMessage id="rating" />: {convertedRating}
    </div>
  ) : (
    <></>
  );
};

// Wrapped in PatchComponent so it registers into the plugin-api `components`
// map (like SceneCard / TagLink), letting plugins reuse the host's rating
// display via PluginApi.components.RatingBanner. Transparent passthrough —
// existing in-app usages are unaffected.
export const RatingBanner = PatchComponent("RatingBanner", RatingBannerComponent);
