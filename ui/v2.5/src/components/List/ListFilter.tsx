import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Mousetrap from "mousetrap";
import { SortDirectionEnum } from "src/core/generated-graphql";
import {
  Button,
  ButtonGroup,
  Menu,
  MenuItem,
  FormControl,
  Select,
  Tooltip,
  Popover,
  Box,
  TextField,
  InputAdornment,
  IconButton,
} from "@mui/material";

import { ListFilterModel } from "src/models/list-filter/filter";
import useFocus from "src/utils/focus";
import { useIntl } from "react-intl";
import ArrowDropUpIcon from "@mui/icons-material/ArrowDropUp";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import CheckIcon from "@mui/icons-material/Check";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import { useDebounce } from "src/hooks/debounce";
import { ClearableInput } from "../Shared/ClearableInput";
import { useStopWheelScroll } from "src/utils/form";
import { ISortByOption } from "src/models/list-filter/filter-options";
import { useConfigurationContext } from "src/hooks/Config";

export function useDebouncedSearchInput(
  filter: ListFilterModel,
  setFilter: (filter: ListFilterModel) => void
) {
  const callback = useCallback(
    (value: string) => {
      const newFilter = filter.clone();
      newFilter.searchTerm = value;
      newFilter.currentPage = 1;
      setFilter(newFilter);
    },
    [filter, setFilter]
  );

  const onClear = useCallback(() => callback(""), [callback]);

  const searchCallback = useDebounce(callback, 500);

  return { searchCallback, onClear };
}

export const SearchTermInput: React.FC<{
  filter: ListFilterModel;
  onFilterUpdate: (newFilter: ListFilterModel) => void;
  focus?: ReturnType<typeof useFocus>;
}> = ({ filter, onFilterUpdate, focus: providedFocus }) => {
  const intl = useIntl();
  const [localInput, setLocalInput] = useState(filter.searchTerm);

  const localFocus = useFocus();
  const focus = providedFocus ?? localFocus;
  const [, setQueryFocus] = focus;

  useEffect(() => {
    setLocalInput(filter.searchTerm);
  }, [filter.searchTerm]);

  const { searchCallback, onClear } = useDebouncedSearchInput(
    filter,
    onFilterUpdate
  );

  useEffect(() => {
    Mousetrap.bind("/", (e) => {
      setQueryFocus();
      e.preventDefault();
    });

    return () => {
      Mousetrap.unbind("/");
    };
  });

  function onSetQuery(value: string) {
    setLocalInput(value);

    if (!value) {
      onClear();
    }

    searchCallback(value);
  }

  return (
    <ClearableInput
      className="search-term-input"
      focus={focus}
      value={localInput}
      setValue={onSetQuery}
      placeholder={`${intl.formatMessage({ id: "actions.search" })}…`}
    />
  );
};

const PAGE_SIZE_OPTIONS = ["20", "40", "60", "120", "250", "500", "1000"];

export const PageSizeSelector: React.FC<{
  pageSize: number;
  setPageSize: (pageSize: number) => void;
}> = ({ pageSize, setPageSize }) => {
  const intl = useIntl();

  const perPageSelect = useRef(null);
  const [perPageInput, perPageFocus] = useFocus();
  const [customPageSizeShowing, setCustomPageSizeShowing] = useState(false);

  useEffect(() => {
    if (customPageSizeShowing) {
      perPageFocus();
    }
  }, [customPageSizeShowing, perPageFocus]);

  useStopWheelScroll(perPageInput);

  const pageSizeOptions = useMemo(() => {
    const ret = PAGE_SIZE_OPTIONS.map((o) => {
      return {
        label: o,
        value: o,
      };
    });
    const currentPerPage = pageSize.toString();
    if (!ret.find((o) => o.value === currentPerPage)) {
      ret.push({ label: currentPerPage, value: currentPerPage });
      ret.sort((a, b) => parseInt(a.value, 10) - parseInt(b.value, 10));
    }

    ret.push({
      label: `${intl.formatMessage({ id: "custom" })}...`,
      value: "custom",
    });

    return ret;
  }, [intl, pageSize]);

  function onChangePageSize(val: string) {
    if (val === "custom") {
      // added timeout since Firefox seems to trigger the rootClose immediately
      // without it
      setTimeout(() => setCustomPageSizeShowing(true), 0);
      return;
    }

    setCustomPageSizeShowing(false);

    let pp = parseInt(val, 10);
    if (Number.isNaN(pp) || pp <= 0) {
      return;
    }

    setPageSize(pp);
  }

  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);

  return (
    <div className="page-size-selector">
      <FormControl size="small">
        <Select
          ref={perPageSelect}
          onChange={(e) => onChangePageSize(e.target.value as string)}
          value={pageSize.toString()}
          variant="outlined"
          size="small"
        >
          {pageSizeOptions.map((s) => (
            <MenuItem value={s.value} key={s.value}>
              {s.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Popover
        open={customPageSizeShowing}
        anchorEl={perPageSelect.current}
        onClose={() => setCustomPageSizeShowing(false)}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
      >
        <Box p={1} display="flex" alignItems="center" gap={1}>
          <TextField
            type="number"
            inputProps={{ min: 1 }}
            size="small"
            inputRef={perPageInput}
            onKeyPress={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") {
                onChangePageSize(
                  (perPageInput.current as HTMLInputElement)?.value ?? ""
                );
                e.preventDefault();
              }
            }}
          />
          <Button
            variant="contained"
            color="primary"
            size="small"
            onClick={() =>
              onChangePageSize(
                (perPageInput.current as HTMLInputElement)?.value ?? ""
              )
            }
          >
            <CheckIcon fontSize="small" />
          </Button>
        </Box>
      </Popover>
    </div>
  );
};

export const SortBySelect: React.FC<{
  className?: string;
  sortBy: string | undefined;
  sortDirection: SortDirectionEnum;
  options: ISortByOption[];
  onChangeSortBy: (eventKey: string | null) => void;
  onChangeSortDirection: () => void;
  onReshuffleRandomSort: () => void;
}> = ({
  className,
  sortBy,
  sortDirection,
  options,
  onChangeSortBy,
  onChangeSortDirection,
  onReshuffleRandomSort,
}) => {
    const intl = useIntl();
    const { configuration } = useConfigurationContext();
    const { sfwContentMode } = configuration.interface;

    const currentSortBy = options.find((o) => o.value === sortBy);
    const currentSortByMessageID = currentSortBy
      ? !sfwContentMode
        ? currentSortBy.messageID
        : currentSortBy.sfwMessageID ?? currentSortBy.messageID
      : "";

    const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
    const open = Boolean(anchorEl);

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
      setAnchorEl(null);
    };

    const handleMenuItemClick = (value: string) => {
      onChangeSortBy(value);
      handleClose();
    };

    function renderSortByOptions() {
      return options
        .map((o) => {
          const messageID = !sfwContentMode
            ? o.messageID
            : o.sfwMessageID ?? o.messageID;
          return {
            message: intl.formatMessage({ id: messageID }),
            value: o.value,
          };
        })
        .sort((a, b) => a.message.localeCompare(b.message))
        .map((option) => (
          <MenuItem
            key={option.value}
            onClick={() => handleMenuItemClick(option.value)}
          >
            {option.message}
          </MenuItem>
        ));
    }

    return (
      <ButtonGroup className={`${className ?? ""} sort-by-select`} size="small">
        <Button
          variant="contained"
          color="secondary"
          onClick={handleClick}
        >
          {currentSortBy
            ? intl.formatMessage({ id: currentSortByMessageID })
            : ""}
        </Button>
        <Menu
          anchorEl={anchorEl}
          open={open}
          onClose={handleClose}
          disableScrollLock
        >
          {renderSortByOptions()}
        </Menu>
        <Tooltip
          title={
            sortDirection === SortDirectionEnum.Asc
              ? intl.formatMessage({ id: "ascending" })
              : intl.formatMessage({ id: "descending" })
          }
        >
          <Button variant="contained" color="secondary" onClick={onChangeSortDirection}>
            {sortDirection === SortDirectionEnum.Asc ? (
              <ArrowDropUpIcon />
            ) : (
              <ArrowDropDownIcon />
            )}
          </Button>
        </Tooltip>
        {sortBy === "random" && (
          <Tooltip title={intl.formatMessage({ id: "actions.reshuffle" })}>
            <Button variant="contained" color="secondary" onClick={onReshuffleRandomSort}>
              <ShuffleIcon fontSize="small" />
            </Button>
          </Tooltip>
        )}
      </ButtonGroup>
    );
  };
