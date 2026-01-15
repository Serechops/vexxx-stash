import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  ButtonGroup,
  Menu,
  MenuItem,
  Popover,
  TextField,
  Box,
  IconButton,
} from "@mui/material";
import { FormattedMessage, FormattedNumber, useIntl } from "react-intl";
import useFocus from "src/utils/focus";
import { Icon } from "../Shared/Icon";
import cx from "classnames";
import { faCheck, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { useStopWheelScroll } from "src/utils/form";
import { PatchComponent } from "src/patch";

type PlacementType = "top" | "bottom" | "left" | "right";

const PageCount: React.FC<{
  totalPages: number;
  currentPage: number;
  onChangePage: (page: number) => void;
  pagePopupPlacement?: PlacementType;
}> = ({
  totalPages,
  currentPage,
  onChangePage,
  pagePopupPlacement = "bottom",
}) => {
    const intl = useIntl();
    const currentPageCtrl = useRef<HTMLButtonElement>(null);
    const [pageInput, pageFocus] = useFocus();
    const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
    const [popoverAnchor, setPopoverAnchor] = useState<HTMLButtonElement | null>(null);

    useEffect(() => {
      if (popoverAnchor) {
        // delaying the focus to the next execution loop so that rendering takes place first and stops the page from resetting.
        setTimeout(() => {
          pageFocus();
        }, 0);
      }
    }, [popoverAnchor, pageFocus]);

    useStopWheelScroll(pageInput);

    const pageOptions = useMemo(() => {
      const maxPagesToShow = 1000;
      const min = Math.max(1, currentPage - maxPagesToShow / 2);
      const max = Math.min(min + maxPagesToShow, totalPages);
      const pages = [];
      for (let i = min; i <= max; i++) {
        pages.push(i);
      }
      return pages;
    }, [totalPages, currentPage]);

    function onCustomChangePage() {
      const newPage = Number.parseInt(pageInput.current?.value ?? "0");
      if (newPage) {
        onChangePage(newPage);
      }
      setPopoverAnchor(null);
    }

    const handleMenuOpen = (event: React.MouseEvent<HTMLButtonElement>) => {
      setAnchorEl(event.currentTarget);
    };

    const handleMenuClose = () => {
      setAnchorEl(null);
    };

    return (
      <div className="page-count-container">
        <ButtonGroup size="small">
          <Button
            variant="outlined"
            color="secondary"
            className="page-count !bg-card hover:!bg-secondary !text-foreground"
            ref={currentPageCtrl}
            onClick={(e) => setPopoverAnchor(e.currentTarget)}
          >
            <FormattedMessage
              id="pagination.current_total"
              values={{
                current: intl.formatNumber(currentPage),
                total: intl.formatNumber(totalPages),
              }}
            />
          </Button>
          <Button
            variant="outlined"
            color="secondary"
            className="page-count-dropdown !bg-card hover:!bg-secondary !text-foreground"
            onClick={handleMenuOpen}
            size="small"
          >
            <Icon size="xs" icon={faChevronDown} />
          </Button>
        </ButtonGroup>
        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleMenuClose}
        >
          {pageOptions.map((s) => (
            <MenuItem
              key={s}
              selected={s === currentPage}
              onClick={() => {
                onChangePage(s);
                handleMenuClose();
              }}
            >
              {s}
            </MenuItem>
          ))}
        </Menu>
        <Popover
          open={Boolean(popoverAnchor)}
          anchorEl={popoverAnchor}
          onClose={() => setPopoverAnchor(null)}
          anchorOrigin={{
            vertical: pagePopupPlacement === "top" ? "top" : "bottom",
            horizontal: "left",
          }}
        >
          <Box sx={{ p: 1, display: 'flex', gap: 1 }}>
            {/* can't use NumberField because of the ref */}
            <TextField
              type="number"
              inputProps={{ min: 1, max: totalPages }}
              className="text-input"
              inputRef={pageInput}
              defaultValue={currentPage}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") {
                  onCustomChangePage();
                  e.preventDefault();
                }
              }}
              onFocus={(e: React.FocusEvent<HTMLInputElement>) =>
                e.target.select()
              }
              size="small"
            />
            <IconButton color="primary" onClick={() => onCustomChangePage()} size="small">
              <Icon icon={faCheck} />
            </IconButton>
          </Box>
        </Popover>
      </div>
    );
  };

interface IPaginationProps {
  itemsPerPage: number;
  currentPage: number;
  totalItems: number;
  metadataByline?: React.ReactNode;
  onChangePage: (page: number) => void;
  pagePopupPlacement?: PlacementType;
}

interface IPaginationIndexProps {
  loading?: boolean;
  itemsPerPage: number;
  currentPage: number;
  totalItems: number;
  metadataByline?: React.ReactNode;
}

const minPagesForCompact = 4;

export const Pagination: React.FC<IPaginationProps> = PatchComponent(
  "Pagination",
  ({
    itemsPerPage,
    currentPage,
    totalItems,
    onChangePage,
    pagePopupPlacement,
  }) => {
    const intl = useIntl();
    const totalPages = useMemo(
      () => Math.ceil(totalItems / itemsPerPage),
      [totalItems, itemsPerPage]
    );

    const pageButtons = useMemo(() => {
      if (totalPages >= minPagesForCompact)
        return (
          <PageCount
            totalPages={totalPages}
            currentPage={currentPage}
            onChangePage={onChangePage}
            pagePopupPlacement={pagePopupPlacement}
          />
        );

      const pages = [...Array(totalPages).keys()].map((i) => i + 1);

      return pages.map((page: number) => (
        <Button
          variant={currentPage === page ? "contained" : "outlined"}
          color={currentPage === page ? "primary" : "secondary"}
          className={cx(
            "hover:!bg-secondary !text-foreground border-none font-bold",
            currentPage === page
              ? "!bg-primary !text-white !opacity-100 !bg-opacity-100 shadow-md transform scale-110 z-10"
              : "!bg-card !opacity-90"
          )}
          key={page}
          onClick={() => onChangePage(page)}
          size="small"
        >
          <FormattedNumber value={page} />
        </Button>
      ));
    }, [totalPages, currentPage, onChangePage, pagePopupPlacement]);

    if (totalPages <= 1) return <div />;

    return (
      <ButtonGroup className="pagination w-fit mx-auto" size="small">
        <Button
          variant="outlined"
          color="secondary"
          className="!bg-card hover:!bg-secondary !text-foreground"
          disabled={currentPage === 1}
          onClick={() => onChangePage(1)}
          title={intl.formatMessage({ id: "pagination.first" })}
        >
          <span>«</span>
        </Button>
        <Button
          variant="outlined"
          color="secondary"
          className="!bg-card hover:!bg-secondary !text-foreground"
          disabled={currentPage === 1}
          onClick={() => onChangePage(currentPage - 1)}
          title={intl.formatMessage({ id: "pagination.previous" })}
        >
          &lt;
        </Button>
        {pageButtons}
        <Button
          variant="outlined"
          color="secondary"
          className="!bg-card hover:!bg-secondary !text-foreground"
          disabled={currentPage === totalPages}
          onClick={() => onChangePage(currentPage + 1)}
          title={intl.formatMessage({ id: "pagination.next" })}
        >
          &gt;
        </Button>
        <Button
          variant="outlined"
          color="secondary"
          className="!bg-card hover:!bg-secondary !text-foreground"
          disabled={currentPage === totalPages}
          onClick={() => onChangePage(totalPages)}
          title={intl.formatMessage({ id: "pagination.last" })}
        >
          <span>»</span>
        </Button>
      </ButtonGroup>
    );
  }
);

export const PaginationIndex: React.FC<IPaginationIndexProps> = PatchComponent(
  "PaginationIndex",
  ({ loading, itemsPerPage, currentPage, totalItems, metadataByline }) => {
    const intl = useIntl();

    if (loading) return null;

    // Build the pagination index string
    const firstItemCount: number = Math.min(
      (currentPage - 1) * itemsPerPage + 1,
      totalItems
    );
    const lastItemCount: number = Math.min(
      firstItemCount + (itemsPerPage - 1),
      totalItems
    );
    const indexText: string = `${intl.formatNumber(
      firstItemCount
    )}-${intl.formatNumber(lastItemCount)} of ${intl.formatNumber(totalItems)}`;

    return (
      <span className="filter-container text-muted paginationIndex center-text">
        {indexText}
        <br />
        {metadataByline}
      </span>
    );
  }
);
