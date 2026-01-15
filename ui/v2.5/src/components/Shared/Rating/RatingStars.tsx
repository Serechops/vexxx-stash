import { useState } from "react";
import { Box, Button } from "@mui/material";
import { Icon } from "../Icon";
import { faStar as fasStar } from "@fortawesome/free-solid-svg-icons";
import { faStar as farStar } from "@fortawesome/free-regular-svg-icons";
import {
  convertFromRatingFormat,
  convertToRatingFormat,
  getRatingPrecision,
  RatingStarPrecision,
  RatingSystemType,
} from "src/utils/rating";
import { useIntl } from "react-intl";
import { PatchComponent } from "src/patch";

export interface IRatingStarsProps {
  value: number | null;
  onSetRating?: (value: number | null) => void;
  disabled?: boolean;
  precision: RatingStarPrecision;
  valueRequired?: boolean;
  orMore?: boolean;
}

export const RatingStars = PatchComponent(
  "RatingStars",
  (props: IRatingStarsProps) => {
    const intl = useIntl();
    const [hoverRating, setHoverRating] = useState<number | undefined>();
    const disabled = props.disabled || !props.onSetRating;

    const rating = convertToRatingFormat(props.value, {
      type: RatingSystemType.Stars,
      starPrecision: props.precision,
    });
    const stars = rating ? Math.floor(rating) : 0;
    // the upscaling was necesary to fix rounding issue present with tenth place precision
    const fraction = rating ? ((rating * 10) % 10) / 10 : 0;

    const max = 5;
    const precision = getRatingPrecision(props.precision);

    function newToggleFraction() {
      if (precision !== 1) {
        if (fraction !== precision) {
          if (fraction == 0) {
            return 1 - precision;
          }

          return fraction - precision;
        }
      }
    }

    function setRating(thisStar: number) {
      if (!props.onSetRating) {
        return;
      }

      let newRating: number | undefined = thisStar;

      // toggle rating fraction if we're clicking on the current rating
      if (
        (stars === thisStar && !fraction) ||
        (stars + 1 === thisStar && fraction)
      ) {
        const f = newToggleFraction();
        if (!f) {
          if (props.valueRequired) {
            if (fraction) {
              newRating = stars + 1;
            } else {
              newRating = stars;
            }
          } else {
            newRating = undefined;
          }
        } else if (fraction) {
          // we're toggling from an existing fraction so use the stars value
          newRating = stars + f;
        } else {
          // we're toggling from a whole value, so decrement from current rating
          newRating = stars - 1 + f;
        }
      }

      // set the hover rating to undefined so that it doesn't immediately clear
      // the stars
      setHoverRating(undefined);

      if (!newRating) {
        props.onSetRating(null);
        return;
      }

      props.onSetRating(
        convertFromRatingFormat(newRating, RatingSystemType.Stars)
      );
    }

    function onMouseOver(thisStar: number) {
      if (!disabled) {
        setHoverRating(thisStar);
      }
    }

    function onMouseOut(thisStar: number) {
      if (!disabled && hoverRating === thisStar) {
        setHoverRating(undefined);
      }
    }



    function getTooltip(thisStar: number, current: RatingFraction | undefined) {
      if (disabled) {
        if (rating) {
          // always return current rating for disabled control
          return rating.toString();
        }

        return undefined;
      }

      // adjust tooltip to use fractions
      if (!current) {
        return intl.formatMessage({ id: "actions.unset" });
      }

      return (current.rating + current.fraction).toString();
    }

    type RatingFraction = {
      rating: number;
      fraction: number;
    };

    function getCurrentSelectedRating(): RatingFraction | undefined {
      let r: number = hoverRating ? hoverRating : stars;
      let f: number | undefined = fraction;

      if (hoverRating) {
        if (hoverRating === stars && precision === 1) {
          if (props.valueRequired) {
            return { rating: r, fraction: 0 };
          }

          // unsetting
          return undefined;
        }
        if (hoverRating === stars + 1 && fraction && fraction === precision) {
          if (props.valueRequired) {
            return { rating: r, fraction: 0 };
          }
          // unsetting
          return undefined;
        }

        if (f && hoverRating === stars + 1) {
          f = newToggleFraction();
          r--;
        } else if (!f && hoverRating === stars) {
          f = newToggleFraction();
          r--;
        } else {
          f = 0;
        }
      }

      return { rating: r, fraction: f ?? 0 };
    }

    const suffix = props.orMore ? "+" : "";

    const renderRatingButton = (thisStar: number) => {
      const ratingFraction = getCurrentSelectedRating();

      // width calculation for partial stars
      const getStarWidth = () => {
        const current = ratingFraction;
        if (!current || thisStar > current.rating + 1) {
          return "0%";
        }
        if (thisStar <= current.rating) {
          return "100%";
        }
        return `${current.fraction * 100}%`;
      }

      const width = getStarWidth();

      return (
        <Button
          disabled={disabled}
          className="minimal"
          onClick={() => setRating(thisStar)}
          variant="text"
          color="secondary"
          onMouseEnter={() => onMouseOver(thisStar)}
          onMouseLeave={() => onMouseOut(thisStar)}
          onFocus={() => onMouseOver(thisStar)}
          onBlur={() => onMouseOut(thisStar)}
          title={getTooltip(thisStar, ratingFraction)}
          key={`star-${thisStar}`}
          sx={{
            fontSize: "inherit",
            marginRight: "1px",
            padding: 0,
            position: "relative",
            minWidth: "auto",
            "&:hover": { backgroundColor: "inherit" },
            "&:disabled": { backgroundColor: "inherit", opacity: "inherit" },
            "& .filled-star": {
              overflow: "hidden",
              position: "absolute",
              width: width,
              left: 0,
              top: 0,
              transition: "width 0.1s ease-in-out", // Smooth transition for visual flair
              zIndex: 2,
              pointerEvents: "none",
            },
            "& .unfilled-star": {
              zIndex: 1,
            },
            "& .fa-icon": {
              // Styles for star icon colors
              // We need to replicate .setting, .set, .unsetting colors
              // But those are on the icon element itself
            }

          }}
        >
          <div className="filled-star">
            <Icon icon={fasStar} className="set" style={{ color: "gold" }} />
          </div>
          <div className="unfilled-star">
            <Icon icon={farStar} style={{ color: hoverRating && hoverRating >= thisStar ? (hoverRating === stars ? "gold" : "gold") : (stars && stars >= thisStar ? "gold" : "inherit") }} />
            {/* Logic for coloring is complex in CSS:
                 .unsetting { color: gold }
                 .setting { color: gold }
                 .set { color: gold }

                 Wait, .unsetting is when hoverRating === stars.
                 .setting is when hoverRating >= thisStar (and not unsetting).
                 .set is when stars >= thisStar.

                 Basically, if it's set or being set/unset, it's gold (for the Unfilled star?? No, filled star is gold).
                 Actually, looking at SCSS:
                 .filled-star has .set.
                 .unfilled-star has .setting, .unsetting, .set.
                 Ah, unsetting means we are about to unset it.
                 Basically, gold color logic.
             */}
          </div>
        </Button>
      );
    };

    const maybeGetStarRatingNumber = () => {
      const ratingFraction = getCurrentSelectedRating();
      if (
        !ratingFraction ||
        (ratingFraction.rating == 0 && ratingFraction.fraction == 0)
      ) {
        return "";
      }

      return ratingFraction.rating + ratingFraction.fraction + suffix;
    };

    const precisionClassName = `rating-stars-precision-${props.precision}`;

    return (
      <Box
        className={`rating-stars ${precisionClassName}`}
        sx={{
          display: "inline-flex",
          verticalAlign: "middle",
          "& .star-rating-number": {
            fontSize: "1rem",
            margin: "auto 0.5rem",
          }
        }}
      >
        {Array.from(Array(max)).map((value, index) =>
          renderRatingButton(index + 1)
        )}
        <span className="star-rating-number">{maybeGetStarRatingNumber()}</span>
      </Box>
    );
  }
);
