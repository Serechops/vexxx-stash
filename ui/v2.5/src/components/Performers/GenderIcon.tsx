import React from "react";
import { Box } from "@mui/material";
import MaleIcon from "@mui/icons-material/Male";
import FemaleIcon from "@mui/icons-material/Female";
import TransgenderIcon from "@mui/icons-material/Transgender";
import * as GQL from "src/core/generated-graphql";
import { useIntl } from "react-intl";

interface IIconProps {
  gender?: GQL.Maybe<GQL.GenderEnum>;
  className?: string;
}

const GenderIcon: React.FC<IIconProps> = ({ gender, className }) => {
  const intl = useIntl();
  if (gender) {
    const color =
      gender === GQL.GenderEnum.Male
        ? "#89cff0"
        : gender === GQL.GenderEnum.Female
          ? "#f38cac"
          : "#c8a2c8";

    const IconComponent =
      gender === GQL.GenderEnum.Male
        ? MaleIcon
        : gender === GQL.GenderEnum.Female
          ? FemaleIcon
          : TransgenderIcon;

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
        <IconComponent
          fontSize="small"
          titleAccess={intl.formatMessage({ id: "gender_types." + gender })}
        />
      </Box>
    );
  }
  return null;
};

export default GenderIcon;
