import React from "react";
import { Button, Chip } from "@mui/material";
import FilterListIcon from "@mui/icons-material/FilterList";
import { useIntl } from "react-intl";

interface IFilterButtonProps {
  count?: number;
  onClick: () => void;
  title?: string;
}

export const FilterButton: React.FC<IFilterButtonProps> = ({
  count = 0,
  onClick,
  title,
}) => {
  const intl = useIntl();

  if (!title) {
    title = intl.formatMessage({ id: "search_filter.edit_filter" });
  }

  return (
    <Button
      variant="contained"
      color="secondary"
      className="filter-button"
      onClick={onClick}
      title={title}
    >
      <FilterListIcon fontSize="small" />
      {count ? (
        <Chip
          size="small"
          color="info"
          label={count}
          sx={{ ml: 0.5 }}
        />
      ) : undefined}
    </Button>
  );
};
