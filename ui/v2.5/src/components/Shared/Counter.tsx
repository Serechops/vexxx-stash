import React from "react";
import { Chip } from "@mui/material";
import { FormattedNumber, useIntl } from "react-intl";
import TextUtils from "src/utils/text";

interface IProps {
  abbreviateCounter?: boolean;
  count: number;
  hideZero?: boolean;
  hideOne?: boolean;
}

export const Counter: React.FC<IProps> = ({
  abbreviateCounter = false,
  count,
  hideZero = false,
  hideOne = false,
}) => {
  const intl = useIntl();

  if (hideZero && count === 0) return null;
  if (hideOne && count === 1) return null;

  if (abbreviateCounter) {
    const formatted = TextUtils.abbreviateCounter(count);
    return (
      <Chip
        className="left-spacing"
        size="small"
        color="secondary"
        data-value={intl.formatNumber(count)}
        label={
          <>
            <FormattedNumber
              value={formatted.size}
              maximumFractionDigits={formatted.digits}
            />
            {formatted.unit}
          </>
        }
      />
    );
  } else {
    return (
      <Chip
        className="left-spacing"
        size="small"
        color="secondary"
        data-value={intl.formatNumber(count)}
        label={intl.formatNumber(count)}
      />
    );
  }
};
