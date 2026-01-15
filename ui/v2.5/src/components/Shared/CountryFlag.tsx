import React from "react";
import { useIntl } from "react-intl";
import { getCountryByISO } from "src/utils/country";
import { Tooltip } from "@mui/material";

interface ICountryFlag {
  country?: string | null;
  className?: string;
  includeName?: boolean;
  includeOverlay?: boolean;
}

export const CountryFlag: React.FC<ICountryFlag> = ({
  className,
  country: isoCountry,
  includeName,
  includeOverlay,
}) => {
  const { locale } = useIntl();

  const country = getCountryByISO(isoCountry, locale);

  if (!isoCountry || !country) return <></>;

  return (
    <>
      {includeName ? country : ""}
      {includeOverlay ? (
        <Tooltip title={country}>
          <span
            className={`${className ?? ""} fi fi-${isoCountry.toLowerCase()}`}
          />
        </Tooltip>
      ) : (
        <span
          className={`${className ?? ""} fi fi-${isoCountry.toLowerCase()}`}
        />
      )}
    </>
  );
};
