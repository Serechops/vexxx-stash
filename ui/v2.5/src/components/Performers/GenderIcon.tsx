import React from "react";
import { Box } from "@mui/material";
import {
  faVenus,
  faTransgenderAlt,
  faMars,
} from "@fortawesome/free-solid-svg-icons";
import * as GQL from "src/core/generated-graphql";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useIntl } from "react-intl";

interface IIconProps {
  gender?: GQL.Maybe<GQL.GenderEnum>;
  className?: string;
}

const GenderIcon: React.FC<IIconProps> = ({ gender, className }) => {
  const intl = useIntl();
  if (gender) {
    const icon =
      gender === GQL.GenderEnum.Male
        ? faMars
        : gender === GQL.GenderEnum.Female
          ? faVenus
          : faTransgenderAlt;
    const color =
      gender === GQL.GenderEnum.Male
        ? "#89cff0"
        : gender === GQL.GenderEnum.Female
          ? "#f38cac"
          : "#c8a2c8";

    return (
      <Box
        component="span"
        className={className}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          color: color,
          verticalAlign: "middle"
        }}
      >
        <FontAwesomeIcon
          title={intl.formatMessage({ id: "gender_types." + gender })}
          icon={icon}
        />
      </Box>
    );
  }
  return null;
};

export default GenderIcon;
