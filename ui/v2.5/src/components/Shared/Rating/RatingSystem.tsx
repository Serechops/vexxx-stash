import { useConfigurationContext } from "src/hooks/Config";
import {
  defaultRatingStarPrecision,
  defaultRatingSystemOptions,
  RatingSystemType,
} from "src/utils/rating";
import { RatingBar } from "./RatingBar";
import { PatchComponent } from "src/patch";

export interface IRatingSystemProps {
  value: number | null | undefined;
  onSetRating?: (value: number | null) => void;
  disabled?: boolean;
  valueRequired?: boolean;
  // if true, requires a click first to edit the rating
  clickToRate?: boolean;
  // true if we should indicate that this is a rating
  withoutContext?: boolean;
  // compact mode for inline use
  compact?: boolean;
}

export const RatingSystem = PatchComponent(
  "RatingSystem",
  (props: IRatingSystemProps) => {
    const { configuration: config } = useConfigurationContext();
    const ratingSystemOptions =
      config?.ui.ratingSystemOptions ?? defaultRatingSystemOptions;

    return (
      <RatingBar
        value={props.value ?? null}
        onSetRating={props.onSetRating}
        disabled={props.disabled}
        ratingSystemType={ratingSystemOptions.type}
        precision={
          ratingSystemOptions.starPrecision ?? defaultRatingStarPrecision
        }
        compact={props.compact}
      />
    );
  }
);
